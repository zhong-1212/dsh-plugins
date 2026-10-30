# dsh-plugins

DeepSeek Harness（DSH）第三方插件集合。每个插件独立放在 `plugins/<name>/`，可单独安装，互不依赖。

## 插件清单

| 插件 | 作用 | 兼容性 |
|------|------|--------|
| [dsh-prompt-tweak](plugins/dsh-prompt-tweak/) | 聊天输入框旁的「✨ 优化」按钮：用当前会话模型把草稿指令改写得更清晰，原地替换、可撤回 | 0.2.0-rc.2 / 0.2.1-rc.2 compatible；0.2.1-rc.3 unknown（未实测） |

## 共同约定

本仓库所有插件遵守同一套纪律：

- **零外部网络出口**：只走同源宿主路由与 DSH 内置服务；任何外发都会在 README 明示。
- **零生命周期脚本**：`package.json` 不含 `scripts.install/postinstall/prepare`，包管理器安装时不执行代码。
- **不改宿主核心**：只用官方扩展生态（bundle patch + client plugin），卸载即净退出，不留配置或缓存。
- **诚实的兼容性声明**：`dsh.compatibility.dshReleases` 只标实测过的版本，未测一律标 `unknown`。
- **API 来源可追溯**：源码注释标注每个 API 的实证出处；推断项显式标记，不把猜测写成事实。

## CI

`.github/workflows/ci.yml` 做纯静态检查（无网络依赖动作）：`node --check` 语法、JSON/YAML 合法性、隐私模式扫描（`tools/privacy_scan.py`）。

## 许可

各插件目录内含自己的 `LICENSE`；除非另有说明，均为 MIT。
