// ============================================================================
// dsh-prompt-tweak —— 浏览器半侧入口（DSH 模块系统按 package.json exports['./client']
// 提供 /plugins/dsh-prompt-tweak/client.js）。
//
// 职责：往聊天输入区工具条 slot 挂一个「✨ 优化」按钮。点击 → 快照当前草稿 →
// fetch 同源 /dsh-prompt-tweak/optimize 拿改写文本 → 原地替换进编辑框且保住撤销栈
// （原生 Ctrl+Z 可复原）→ 按钮短暂变「↶ 撤回」，点它一键复原。空草稿禁用、去抖、
// LLM 失败不动草稿只给轻提示。零外部网络出口（仅同源路由）。
//
// 【API 来源·全部实测】
//   - window.__ModuleLoader__.load({id, factory})            ← dsh-pet client.js:5820 / aquarium:13
//   - factory(require) => {apply, inject, name}              ← dsh-pet client.js:5673-5814
//   - ctx.slots.inject(slot, function*(){ yield ctx.slots.register({name,id,order,inject}, Comp) })
//     slot 实名 "conversation.composer.dock"                  ← ui-chat.js:13313-13328【实测】
//   - 输入框 = Lexical contenteditable，选择器 [data-composer-input][contenteditable="true"]，role=textbox
//                                                            ← ui-conversation.js:18279-18287【实测】
//   - DOM 元素上暴露 editor 实例：el.__lexicalEditor          ← ui-conversation.js:10690,11286【实测】
//   - 「异步文本结果作为独立 undo 操作插入」官方模式           ← ui-conversation.js:14766-14779 insertAsyncText【实测·佐证思路】
//
// 推断项（需重启后冒烟确认）已在注释标「推断」。
// ============================================================================

window.__ModuleLoader__.load({
	id: "dsh-prompt-tweak",
	factory(require) {
		const react = require("react");
		const { useState, useRef, useCallback, useEffect } = react;
		const { jsx } = require("react/jsx-runtime");

		const ROUTE = "/dsh-prompt-tweak/optimize";
		const DEBOUNCE_MS = 400;       // 连续点击去抖窗口
		const REVERT_WINDOW_MS = 6000; // 「↶ 撤回」按钮停留时长
		const NS = "dsh-prompt-tweak";

		// ---- Lexical / DOM helpers -------------------------------------------

		/** 找到当前可见的活动 composer contenteditable（Lexical 根）。 */
		function findComposerEl() {
			const nodes = document.querySelectorAll('[data-composer-input][contenteditable="true"]');
			for (const el of nodes) if (el.offsetParent !== null) return el;
			return nodes[0] || null;
		}

		/** 读草稿纯文本：直接取渲染出的 innerText（避开 editor.read() 事务里访问 DOM 的时序坑）。 */
		function readDraft(el) {
			if (!el) return "";
			return (el.innerText ?? el.textContent ?? "").replace(/ /g, " ");
		}

		/** 在 contenteditable 内用 Range 全选现有内容。 */
		function selectAllIn(el) {
			try {
				const range = document.createRange();
				range.selectNodeContents(el);
				const sel = window.getSelection();
				sel.removeAllRanges();
				sel.addRange(range);
				return true;
			} catch {
				return false;
			}
		}

		/**
		 * 把整段草稿替换为新文本，尽量进入浏览器/Lexical 撤销栈。
		 * A. 首选 document.execCommand('insertText')：对 contenteditable 会触发原生
		 *    beforeinput，被 Lexical 监听并入自身 history，同时保留浏览器 Ctrl+Z（推断：与用户手输等价）。
		 * B. execCommand 不可用/未生效时，退回 __lexicalEditor.update() 走宿主官方写入通道
		 *    （保证内容正确；此路径是否进浏览器 undo 待冒烟，故仍叠加「↶ 撤回」双保险）。
		 * 返回是否成功替换。
		 */
		function replaceDraft(el, text) {
			el.focus();
			if (!selectAllIn(el)) return false;
			let applied = false;
			try {
				applied = document.execCommand("insertText", false, text);
			} catch {
				applied = false;
			}
			if (applied && readDraft(el).trim() === text.trim()) return true;
			// execCommand 未生效（被拦截或选区丢失）。Lexical 的 $ 助手不挂在实例上、
			// 外部无法安全调用 editor.update 里的 $getRoot/$createTextNode，因此退回
			// 「改 DOM + 派发 input 事件」促使宿主同步（推断：与 aquarium 用 MutationObserver
			// 跟随宿主重渲染同理）。此路径可能不进浏览器 undo，故仍叠加「↶ 撤回」双保险。
			el.textContent = text;
			el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
			return true;
		}

		// ---- 轻量 toast ------------------------------------------------------
		function showToast(msg, isError) {
			const host = document.createElement("div");
			host.textContent = msg;
			Object.assign(host.style, {
				position: "fixed", bottom: "96px", left: "50%", transform: "translateX(-50%)",
				zIndex: "99999", padding: "8px 14px", borderRadius: "8px",
				background: isError ? "#b42318" : "#1f2937", color: "#fff", fontSize: "13px",
				boxShadow: "0 6px 20px rgba(0,0,0,.25)", pointerEvents: "none", opacity: "0",
				transition: "opacity .18s ease", maxWidth: "70vw", whiteSpace: "pre-line",
			});
			document.body.appendChild(host);
			requestAnimationFrame(() => { host.style.opacity = "1"; });
			setTimeout(() => {
				host.style.opacity = "0";
				setTimeout(() => host.remove(), 220);
			}, isError ? 2600 : 1600);
		}

		// ---- 按钮组件 --------------------------------------------------------
		function OptimizeButton() {
			const [busy, setBusy] = useState(false);
			const [snapshot, setSnapshot] = useState(null); // {text, el} 供撤回
			const [hasDraft, setHasDraft] = useState(false); // 空草稿禁用依据
			const lastClickRef = useRef(0);
			const revertTimerRef = useRef(0);

			const clearRevert = () => {
				if (revertTimerRef.current) { clearTimeout(revertTimerRef.current); revertTimerRef.current = 0; }
			};

			// 监听输入变化以维护 hasDraft（用于 disabled）。捕获阶段监听 document input。
			useEffect(() => {
				const sync = () => {
					const el = findComposerEl();
					setHasDraft(!!el && readDraft(el).trim().length > 0);
				};
				sync();
				document.addEventListener("input", sync, true);
				const mo = new MutationObserver(sync);
				const root = document.getElementById("root") || document.body;
				mo.observe(root, { childList: true, subtree: true, characterData: true });
				(window.__dshPromptTweakKeepAlive ||= []).push(mo);
				return () => {
					document.removeEventListener("input", sync, true);
					mo.disconnect();
				};
			}, []);

			const doOptimize = useCallback(async () => {
				const now = Date.now();
				if (now - lastClickRef.current < DEBOUNCE_MS) return; // 去抖
				lastClickRef.current = now;

				const el = findComposerEl();
				if (!el) { showToast("没找到输入框", true); return; }
				const draft = readDraft(el);
				if (!draft.trim()) return; // 空草稿（disabled 已拦，双保险）

				setBusy(true);
				clearRevert();
				try {
					const res = await fetch(ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ text: draft }),
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok || !data.ok || typeof data.text !== "string" || !data.text.trim()) {
						showToast(data.message || "优化失败，草稿未改动", true); // 失败：不动草稿
						return;
					}
					const current = readDraft(el); // 替换前再快照，防期间被改
					const replaced = replaceDraft(el, data.text);
					if (!replaced) { showToast("替换失败", true); return; }
					setSnapshot({ text: current, el });
					clearRevert();
					revertTimerRef.current = setTimeout(() => setSnapshot(null), REVERT_WINDOW_MS);
				} catch (e) {
					showToast("请求出错：" + (e && e.message ? e.message : String(e)), true);
				} finally {
					setBusy(false);
				}
			}, []);

			const doRevert = useCallback(() => {
				if (!snapshot) return;
				const { text, el } = snapshot;
				if (el && document.contains(el)) replaceDraft(el, text);
				clearRevert();
				setSnapshot(null);
			}, [snapshot]);

			const canRevert = !!snapshot;
			const disabled = busy || (!canRevert && !hasDraft);

			return jsx("button", {
				type: "button",
				title: canRevert
					? "撤回到优化前的原文"
					: (hasDraft ? "用当前模型把草稿优化成更清晰的指令（Ctrl+Z 也可撤回）" : "先在输入框写点内容"),
				disabled,
				onMouseDown: (e) => e.preventDefault(), // 抢回焦点前先阻止默认，避免点按钮使 textarea 失焦丢选区
				onClick: canRevert ? doRevert : doOptimize,
				style: {
					display: "inline-flex", alignItems: "center", gap: "4px",
					height: "28px", padding: "0 10px", borderRadius: "8px",
					border: "1px solid rgba(128,128,128,.35)", background: "transparent",
					color: "inherit", font: "inherit", fontSize: "13px", lineHeight: 1,
					cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap",
					opacity: disabled ? 0.45 : 1, userSelect: "none",
				},
				children: canRevert ? "↶ 撤回" : (busy ? "优化中…" : "✨ 优化"),
			});
		}

		// ---- 插件主体 --------------------------------------------------------
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("conversation.composer.dock", function* () {
				yield ctx.slots.register({
					name: "conversation.composer.dock",
					id: "prompt-tweak",
					order: 50,
					locale: NS,
					inject: () => ({}),
				}, OptimizeButton);
			}), "dsh-prompt-tweak: composer dock button");
		}

		return {
			name: NS,
			inject: ["slots"],
			apply,
		};
	},
});
