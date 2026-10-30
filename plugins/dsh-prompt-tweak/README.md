# dsh-prompt-tweak

给 DSH（DeepSeek Harness）聊天输入框加一个「✨ 优化」按钮：点一下，用**当前会话的模型**把你写的草稿指令改写成更清晰的版本，原地替换进输入框。原生 `Ctrl+Z` 可撤回，按钮也会短暂变成「↶ 撤回」供一键复原。

- **零外部网络出口**：浏览器半侧只 fetch 同源宿主路由，宿主半侧只调用 DSH 内置 LLM 服务。不上传任何数据到第三方。
- **零生命周期脚本**：`package.json` 无 `scripts` 字段，npm/pnpm 安装时不执行任何代码。
- **不改宿主核心**：纯官方扩展生态（bundle patch + client plugin），卸载即净退出。

## 效果

```
你写：  "把那个登录的问题修一下"
点「✨ 优化」后变成一条结构化指令（保留你的原意，补齐目标/约束/验收标准），
仍然是草稿状态——你可以继续编辑、或 Ctrl+Z / 点「↶ 撤回」复原。
```

## 安装

前提：DSH 桌面版或 Web 版 profile 已初始化（`~/.dsh/profiles/<profile>`）。

### 方式 A · dsh CLI（推荐）

```bash
dsh plugin --profile desktop add dsh-prompt-tweak
```

（Web profile 把 `desktop` 换成 `web`。）安装后**重启 DSH** 生效。

### 方式 B · 手工挂 bundle（本仓库子目录形态）

1. 把 `plugins/dsh-prompt-tweak/` 放进你的 profile 可达位置，并在 profile 根 `package.json` 的 `dependencies` 中加入该包（本地可用 `file:` 协议指向目录）。
2. 在 `dsh.profile.bundles` 数组追加 `"dsh-prompt-tweak"`。
3. 重启 DSH。插件自带的 `cordis.patch.yml` 会以 `- insert: [{id, name}]` 注入配置树。

> 注意：bundle entry 的 `id` 全局唯一且必须等于包名；`"id:"` 行**不要写行尾注释**（装载预检按该行比对 entryIds，带尾注会导致识别失败）。

## 卸载（净退出三步）

1. 删除 profile 根 `package.json` 中 `dependencies` 与 `dsh.profile.bundles` 里的 `dsh-prompt-tweak` 两处条目；
2. 删除 `node_modules/dsh-prompt-tweak/` 目录；
3. 重启 DSH。

本插件不在别处落盘（无配置文件、无缓存目录、无用户数据），以上三步即完全清除。

## 行为说明

| 场景 | 表现 |
|------|------|
| 输入框为空 | 按钮禁用（灰化），title 提示「先在输入框写点内容」 |
| 点击优化 | 快照原文 → POST 同源 `/dsh-prompt-tweak/optimize` → 成功后原地替换；按钮变「↶ 撤回」停留 6 秒 |
| 撤回 | 点「↶ 撤回」用快照复原；或直接用系统 `Ctrl+Z`（首选写入通道走 `document.execCommand('insertText')`，触发 Lexical 原生 beforeinput 进入撤销栈） |
| LLM 失败/超时(45s)/空返回 | **不动草稿**，红色 toast 轻提示原因 |
| 连续点击 | 400ms 去抖窗口；busy 期间显示「优化中…」并禁用 |

改写策略（内嵌于宿主半侧 system prompt）：复述意图分类 → 补齐可执行要素（目标产物/涉及模块/约束/验收标准/边界）→ 输出**单一可直接粘贴**的优化版；跟随草稿语言（中文进中文出）；不改原意、不新增未暗示的需求、不代做任务；草稿已够清晰则仅极轻微润色。

## 兼容性声明（诚实口径）

`package.json` 的 `dsh.compatibility.dshReleases`：

| DSH 版本 | 声明 | 依据 |
|----------|------|------|
| 0.2.0-rc.2 | compatible | 开发期在该版本宿主上实测装载并通过 API 冒烟 |
| 0.2.1-rc.2 | compatible | 后端差分验证通过：POST `/optimize` 返 200+JSON、GET 未知路径返 handler 级 404、空草稿返 400 `empty-draft` |
| 0.2.1-rc.3 | **unknown** | 发布时作者环境已在 rc.3 运行，但插件未在 rc.3 下完成重载与前端六项验证。**未实测不虚标**，欢迎反馈后更新此表 |

前端交互项（按钮挂载、Lexical 原地替换、Ctrl+Z 撤销栈、撤回复原）需在真实 GUI 会话中人工确认；API 层证据充分，GUI 层若在你的版本上异常请开 issue。

## 契约点附录（给其他 DSH 插件作者）

本插件踩过的坑，全部有实证来源，整理成可直接抄的清单：

### A1. UI 挂载：slot 实名与注册形状

聊天输入区工具条 slot 实名 **`conversation.composer.dock`**。宿主自己也用这套 API 挂按钮，照它抄即可：

```js
ctx.slots.inject("conversation.composer.dock", function* () {
  yield ctx.slots.register({
    name: "conversation.composer.dock",   // slot 名，必填
    id: "your-plugin-button-id",          // 全局唯一
    order: 50,                            // 同槽位排序
    locale: "your-ns",
    inject: () => ({}),                   // 组件级依赖，无则空对象
  }, YourComponent);
});
```

外层浏览器入口固定形状：

```js
window.__ModuleLoader__.load({
  id: "your-plugin",
  factory(require) {
    const react = require("react");
    // ...
    return { name: "your-plugin", inject: ["slots"], apply };
  },
});
```

`package.json` 需声明 `dsh.client.inject`（如 `["@deepseek-ai/dsh-client-connection"]`）与 `platform: "web"`，DSH 模块系统据此把包扫描为浏览器插件并提供 `/plugins/<name>/client.js` 给页面。

### A2. 输入框读写：Lexical contenteditable 通道

- 输入框是 **Lexical** 管理的 `contenteditable`，稳定选择器：`[data-composer-input][contenteditable="true"]`（`role=textbox`）。多实例时取 `offsetParent !== null` 的那个。
- 读草稿：直接取渲染出的 `innerText`，避开 `editor.read()` 事务里访问 DOM 的时序坑。
- 写草稿（关键）：**Lexical 的 `$` 系列助手不挂在 editor 实例上，外部无法安全调 `editor.update(() => $getRoot()...)`**。可行路径按优先级：
  1. `el.focus()` → Range 全选 → `document.execCommand('insertText', false, text)`：会触发原生 `beforeinput`，被 Lexical 监听并入自身 history，同时保住浏览器 `Ctrl+Z`；
  2. 兜底：改 `textContent` + 派发 `InputEvent('input', {inputType:'insertReplacementText'})` 促使宿主同步（此路是否进浏览器 undo 不确定，所以务必叠加自己的「撤回」双保险）。
- 宿主源码里有同款先例（异步文本作为独立 undo 操作插入），思路一致。
- 点按钮会让输入框失焦丢选区：`onMouseDown={(e) => e.preventDefault()}` 抢回焦点前先阻止默认。

### A3. 宿主半侧入口签名（本项目最贵的一课）

Cordis 加载宿主插件要求**具名导出 `{ apply, inject, name }`**：

```js
const name = "your-plugin";
const inject = ["webServer", "llm"];   // 你要用的 ctx 服务名，必须声明
function apply(ctx) { /* 参数直接是 ctx，不是 api */ }
export { apply, inject, name };
```

两个致命反例（我们真踩过）：

1. ❌ `export default function plugin(api) { const { ctx } = api; ... }` —— Cordis 按具名导出加载，`export default` 不被识别，`apply` 根本不会被调用。
2. ❌ 忘了 `inject` 数组 —— 即便 apply 跑了，访问 `ctx.webServer` / `ctx.llm` 前未声明依赖会直接抛错：
   > `Error: cannot get property "webServer" without inject`

   Cordis 对 `inject` 是硬强制，没有 optional-inject 形式。

**症状迷惑性**：这两处写错时，浏览器半侧照常工作、按钮照常出现，只有功能静默失败——因为宿主半侧的路由从未登记。

### A4. 「插件装载 ≠ 插件激活」的验证方法

profile 的 `bundles` 里有名字、UI 元素出现了，只证明 client 半侧活着。宿主半侧是否 `register` 成功要单独验。用**路由指纹差分**最快：

| 探针 | 未激活时 | 激活后 |
|------|---------|--------|
| `POST /<your-plugin>/<route>` | 405 或裸 404（**空 body、无 content-type**） | 你的 handler 应答（必带你自己设的 `content-type` + JSON body） |
| `GET /<your-plugin>/bogus-random-path` | 与上一条同构裸响应 | 也进 handler（返你的 404 JSON）——这正说明前缀已登记 |

判读要点：如果你的 handler 代码里所有分支都会 `setHeader('content-type', ...)`，而实测拿到的是**空 body 裸头**，说明请求根本没进 handler——问题在登记/激活层，不在网关，也不在业务逻辑。拿一个已知正常的第三方插件同法对照（通 vs 拒），一次就能定位。

### A5. 同源路由注册

```js
ctx.webServer.register({
  kind: "prefix",
  path: "/your-plugin",           // 前缀匹配
  handler: async (req, res) => { /* 自行分发 method/path，其余一律 404 */ },
});
```

只暴露必要的方法与路径，其余显式 404，避免误开攻击面。请求体读取务必设上限（本项目 200 KB）防超大负载。

### A6. 装载链与 bundle patch

```
profile/package.json: dependencies + dsh.profile.bundles[]
  → 各 bundle 的 package.json dsh.bundle.patch 指向自身 cordis.patch.yml
    → - insert: [ { id: <包名>, name: '<包名>' } ]  注入配置树 entry
```

`id` 全局唯一且等于包名；`"id:"` 行不能写行尾注释。

---

## 开发与验证记录摘要

- v0.1.0 首版因 A3 的两处契约错误导致「按钮在但功能不通」，经路由指纹差分定位后返工修正。
- v1.0.0 补全元数据、诚实兼容性声明、README 与 CI，准备对外发布。

详见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT — 见 [LICENSE](LICENSE)。
