# Changelog

本项目遵循[保留式变更日志](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-10-30

对外发布首个版本。

### Added
- `README.md`：安装（dsh CLI / profile bundles 两种方式）、卸载净退出三步、行为说明表、兼容性诚实声明表。
- `README.md` · 契约点附录 A1–A6：slot 实名与注册形状、Lexical contenteditable 读写通道、Cordis 宿主入口签名（具名导出 + inject 强制声明）、「插件装载 ≠ 插件激活」的路由指纹差分验证法、同源路由注册与请求体上限、bundle patch 装载链与 `id:` 行无尾注规则。
- `LICENSE`（MIT）。
- CI：`.github/workflows/ci.yml`，纯静态检查（`node --check` 语法 + JSON/YAML 合法性 + 隐私模式扫描），零网络依赖动作。
- `package.json` 补全：`repository`（含 `directory`）、`bugs`、`homepage`、`keywords`、`files` 纳入文档件。
- `dsh.compatibility.dshReleases` 新增 `0.2.1-rc.3: "unknown"` —— 该版本未实测，如实标注不虚标。

### Changed
- 版本号 `0.1.0` → `1.0.0`（首次对外发布定级）。

## [0.1.0] - 2026-10-29

首个可用版本（本机 profile 内开发态）。

### Fixed（返工史一 · 宿主入口契约）
- **症状**：按钮正常出现，但每次点「✨ 优化」都失败；`POST /dsh-prompt-tweak/optimize` 返回裸 405（空 body、无 content-type）。
- **定位**：路由指纹差分——同 profile 内另一插件的 POST 路由完全通（证伪「网关拦截第三方 POST」假设），且一个代码里根本不存在的 bogus path 也返回逐字节同构的裸 404，证明请求从未进入本插件 handler，即宿主半侧 `ctx.webServer.register(...)` 从未执行。
- **根因**：首版把宿主入口写成 `export default function plugin(api) { const { ctx } = api; ... }` 且未声明 `inject` 数组。Cordis 按具名导出 `{ apply, inject, name }` 加载，`apply` 参数直接是 `ctx`；未 `inject` 声明的服务在 `ctx` 上取不到会抛 `cannot get property "webServer" without inject`（同类报错在本机另一插件日志中亦有实证）。
- **修复**：改为 `const name` / `const inject = ["webServer", "agentDefaultModel", "llm"]` / `function apply(ctx)` / `export { apply, inject, name }`。浏览器半侧无需改动（其具名 factory + `inject: ["slots"]` 本就正确，按钮已现即为证据）。
- **教训固化**：凡涉及「框架如何加载我的模块」，必须先在实证参照中核对入口导出约定与依赖声明机制，不能只抄内部 API 的形状；契约点标「推断」的风险会在真实装载时兑现。

### Fixed（返工史二 · 前端验证边界）
- **症状**：后端 API 层已逐分支实测通过（200 出文本 / 未知路径 handler 级 404 / 空草稿 400 `empty-draft`），但前端六项（挂载、原地替换、Ctrl+Z 撤销栈、撤回复原、去抖、失败态不动草稿）无法在同一会话内自动验证。
- **尝试与结论**：浏览器自动化通道需重启刷新注册（不属本任务权限）；宿主未开调试端口（开启需重启，禁止擅自操作）；Windows UIA 不穿透 Electron web 内容层；自建隔离浏览器 + 调试端口的方案受限于 DSH Web 的一次性鉴权 URL——裸地址只返回鉴权提示页，拿不到 composer 节点。
- **处置**：前端六项**如实标注为未经自动实证**，不用「应该没问题」冒充实测；API 层证据以逐分支表格形式留档，GUI 层验证交由真实会话人工确认并写入 README 兼容性表的依据列。
- **教训固化**：能证的给证据，不能证的说明为什么不能证、需要什么条件才能证。

## 早期迭代（0.1.0 之前，开发态）

- 确立零外部网络出口原则：浏览器半侧仅 fetch 同源路由，宿主半侧仅调内置 LLM 服务。
- 确立草稿改写双保险：优先 `document.execCommand('insertText')` 保原生撤销栈，兜底 DOM 改写 + `InputEvent` 派发，并叠加插件自身的「↶ 撤回」快照复原。
- 内嵌改写提示词收敛为「单一可直接粘贴的优化版」输出纪律：跟随草稿语言、不改原意、不新增未暗示的需求、不代做任务、草稿已清晰则极轻微润色。
