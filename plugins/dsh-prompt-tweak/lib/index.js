// ============================================================================
// dsh-prompt-tweak —— 宿主半侧入口（Cordis 插件）
//
// 职责：在 DSH 内置 WebServer 上注册一条**同源**路由 POST /dsh-prompt-tweak/optimize，
// 收到浏览器半侧发来的草稿文本后，用当前会话默认模型经 ctx.llm.stream() 做一次
// 一次性改写，返回优化后的纯文本。零外部网络出口——只调用宿主已有的 LLM 服务。
//
// 【API 来源·全部实测自 dsh-pet/lib/index.js 与宿主 ui-conversation/ui-chat】
//   - ctx.webServer.register({kind:"prefix",path,handler(req,res)})  ← dsh-pet index.js:5675
//   - ctx.llm.stream(options) 异步 chunk 流                          ← dsh-pet index.js:652,710
//   - BlockAssembler / createUserMessage / createAssistantMessage    ← @deepseek-ai/dsh-llm (pet import L8)
//   - ctx.agentDefaultModel.currentSelection() → {provider,model}    ← dsh-pet index.js:464-467 currentModel()
//   - llm.resolveModelInfo(p,m)?.reasoning.efforts                   ← dsh-pet index.js:439-448 supportsReasoningOff
// 推断项一律注释标注；无生命周期脚本、不碰任何既有文件。
// ============================================================================

import {
	BlockAssembler,
	ReasoningEffortId,
	createUserMessage,
} from "@deepseek-ai/dsh-llm";

const ROUTE = "/dsh-prompt-tweak";
const TIMEOUT_MS = 45000; // 单次改写上限；比 pet 的 30s 略宽，优化指令通常更长

/**
 * 取当前会话默认 provider/model。
 * 来源【实测·dsh-pet index.js:464-467】：ctx.agentDefaultModel.currentSelection()。
 */
function currentModel(ctx) {
	try {
		const sel = ctx.agentDefaultModel?.currentSelection?.();
		return sel && typeof sel.provider === "string" && typeof sel.model === "string"
			? { provider: sel.provider, model: sel.model }
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * 该模型是否支持 reasoning "off"（关掉思考链，省时间）。
 * 来源【实测·dsh-pet index.js:439-448】。
 */
async function supportsReasoningOff(ctx, provider, model) {
	const llm = ctx.llm;
	if (!llm || typeof llm.resolveModelInfo !== "function") return false;
	try {
		const info = await llm.resolveModelInfo(provider, model);
		return info?.reasoning?.efforts?.some((e) => e.id === "off") ?? false;
	} catch {
		return false;
	}
}

// ----------------------------------------------------------------------------
// 内嵌提示词：ecc prompt-optimizer 策略 A/C/D 精华（Phase1 意图分类 / Phase4 缺失
// 上下文清单 / Section3「单一可直接粘贴的优化版」/ 同语言进出 / 不改原意不加新需求）。
// 见 skill prompt-optimizer SKILL.md Phase 1、Phase 4、Output Format Section 3-4。
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = [
	"你是提示词优化器（prompt optimizer），只做一件事：把用户贴在输入框里的草稿指令改写成一条更清晰、更可执行的版本。",
	"",
	"工作步骤（内部推理，不要把这些步骤名输出到结果里）：",
	"1. 【复述意图】判断这条指令属于哪类任务：新功能 / 修 bug / 重构 / 调研 / 测试 / 审查 / 文档 / 部署 / 设计。用一句话在心里确认你要做的到底是什么，绝不偏离原意。",
	"2. 【补全上下文】从草稿里已给出的信息出发，补齐让指令可执行的关键要素：目标产物、涉及的文件/模块/技术栈（若草稿提到）、约束条件、验收标准、边界（明确不该做什么）。只能补“显然需要且不与原意冲突”的内容；无法确定的就留白或写成占位，不要凭空编造具体需求。",
	"3. 【定输出格式】按任务类型组织成结构化的中文指令：先一句任务概述，再分点列技术要求/工作流/验收标准/不要做，必要时给出关键命令或步骤序号。",
	"",
	"硬性规则：",
	"- 中文进、中文出；英文进、英文出。跟随草稿的语言，不要翻译。",
	"- 只产出【一个】可直接使用的优化版指令本身——纯净、可整段复制粘贴去执行。",
	"- 不要输出诊断表、评分、多个备选方案、解释性前言或“以下是优化结果”这类套话；不要用 markdown 代码围栏包裹结果。",
	"- 不得改变用户的原始意图，不得擅自新增用户没暗示的需求，也不得替用户把任务直接做了（你不是执行器）。",
	"- 若草稿已经足够清晰完整，就只做极轻微的润色，保持原样为主。",
	"- 长度贴合原稿复杂度：简单请求别硬撑成长篇。",
].join("\n");

/**
 * 调一次 LLM 生成优化文本。返回 {ok, text} 或 {ok:false, reason, message}。
 * 结构照抄 dsh-pet generateWith（index.js:672-715），去掉图片/记忆等多余分支。
 */
async function optimizeOnce(ctx, sel, draftText) {
	const llm = ctx.llm;
	if (!llm || typeof llm.stream !== "function") {
		return { ok: false, reason: "generate-error", message: "LLM 服务不可用" };
	}
	const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
	const options = {
		provider: sel.provider,
		model: sel.model,
		sessionId: "dsh-prompt-tweak",
		messages: [
			createUserMessage({
				content: [{ type: "text", text: draftText }],
				source: { kind: "user" },
			}),
		],
		system: SYSTEM_PROMPT,
		temperature: 1,
		...(supportsOff ? { reasoningEffort: ReasoningEffortId("off") } : {}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	};
	const assembler = new BlockAssembler();
	try {
		for await (const chunk of llm.stream(options)) assembler.push(chunk);
	} catch (e) {
		return {
			ok: false,
			reason: "generate-error",
			message: e instanceof Error ? e.message : String(e),
		};
	}
	// 聚合 text block。来源【实测·dsh-pet index.js:718】：assembler.blocks() 过滤 type==="text" 取 .text。
	const text = assembler.blocks()
		.filter((b) => b.type === "text")
		.map((b) => ("text" in b ? b.text : ""))
		.join("")
		.trim();
	if (!text) return { ok: false, reason: "empty", message: "模型未返回内容" };
	return { ok: true, text };
}

/** 读取请求 JSON body（有上限，防超大负载）。 */
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const c of req) {
		size += c.length;
		if (size > 200_000) throw new Error("payload too large");
		chunks.push(c);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, obj) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(obj));
}

// 宿主入口契约【实测·dsh-pet index.js:3612-3620,5954】：具名导出 {apply,inject,name}，
// apply 参数直接是 ctx（非 api）；inject 声明依赖服务名，未列的服务 ctx 上取不到。
const name = "dsh-prompt-tweak";
const inject = [
	"webServer",        // 注册同源路由            ← pet inject[0]
	"agentDefaultModel",// currentSelection() 取模型 ← pet inject[1]
	"llm",              // ctx.llm.stream()         ← pet inject[3]
];

function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: ROUTE,
		handler: async (req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			const method = req.method ?? "GET";
			// 仅暴露 POST /optimize；其余一律 404，避免误开面
			if (method !== "POST" || url.pathname !== `${ROUTE}/optimize`) {
				sendJson(res, 404, { error: "not found" });
				return;
			}
			try {
				const body = await readJsonBody(req);
				const draft = typeof body.text === "string" ? body.text : "";
				if (!draft.trim()) {
					sendJson(res, 400, { ok: false, reason: "empty-draft", message: "草稿为空" });
					return;
				}
				const sel = currentModel(ctx);
				if (!sel) {
					sendJson(res, 400, { ok: false, reason: "provider-missing", message: "当前对话未配置模型" });
					return;
				}
				const result = await optimizeOnce(ctx, sel, draft);
				sendJson(res, result.ok ? 200 : 502, result);
			} catch (e) {
				sendJson(res, 500, { ok: false, reason: "server-error", message: e instanceof Error ? e.message : String(e) });
			}
		},
	}), "dsh-prompt-tweak: /optimize route");
}

export { apply, inject, name };
