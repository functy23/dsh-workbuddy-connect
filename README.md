<div align="center">

<img src="icon.svg" width="150" alt="dsh-workbuddy-connect-functy"/>

# dsh-workbuddy-connect-functy

**corrinehu/dsh-workbuddy-connect 的 Functy 分支：仪表盘界面、多账号轮换与额度展示，把 WorkBuddy 桌面 App 的模型接到 DeepSeek Harness。**

[![dsh-workbuddy-connect-functy](https://img.shields.io/badge/dsh--workbuddy--connect--functy-0.13.6-4F46E5)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Language](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Top Language](https://img.shields.io/github/languages/top/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/functy23/dsh-workbuddy-connect-functy)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[![Downloads](https://img.shields.io/github/downloads/functy23/dsh-workbuddy-connect-functy/total)](https://github.com/functy23/dsh-workbuddy-connect-functy/releases)
[![Stars](https://img.shields.io/github/stars/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy/stargazers)
[![Repo Size](https://img.shields.io/github/repo-size/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Contributors](https://img.shields.io/github/contributors/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy/graphs/contributors)

[Issues](https://github.com/functy23/dsh-workbuddy-connect-functy/issues) • [Changelog](CHANGELOG.md) • [中文](README.md) / [English](README.en.md)

</div>

---

这是 [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) 的分支，不是上游本体。上游 npm 包仍叫 `dsh-workbuddy-connect`（当前 `0.7.1`，只认 DSH `0.2.0-rc.2`）。本仓库发在 **`dsh-workbuddy-connect-functy`**，界面和账号模型都走了另一条线。

国内版 **WorkBuddy** 与国际版 **WorkBuddy AI** 同时支持：装哪个 App 就出现哪个模型分组，两个都装就两组并存，各自用自己的账号与积分。

## 和上游差在哪

对照上游稳定版 **0.7.1**（2026-10-01）。两边都有的不写进「本仓库才有」。

| | 上游 `dsh-workbuddy-connect` 0.7.1 | 本仓库 0.13.6 |
|---|---|---|
| 界面 | 设置里两张旧插件卡片 | 侧栏额度卡 + 中栏仪表盘 + 设置分区页 |
| 账号 | 跟桌面 App 当前这一份登录 | 多账号池：轮换、扫码、令牌、桌面凭证；删除后不会被 30 秒扫描加回来 |
| 额度 | 只在设置卡片上 | 侧栏一眼可见，可切「剩余 / 用量」样式，可关掉 |
| DSH | **只** `0.2.0-rc.2` | `0.1.7-alpha.1` / `0.2.0-rc.1` / `0.2.0-rc.2` |
| 更新提醒 | 右下角更新条 | 无（未移植） |
| npm | `dsh-workbuddy-connect` | `dsh-workbuddy-connect-functy` |

两边都有：国内/国际分组、图片输入、推理档位检测、模型显隐、国内企业额度、选择器里的倍率与促销徽章、Windows Electron 发现、按区域识别 effort 拒绝码。

## 展示

对话里直接用 WorkBuddy 模型（侧栏底部有额度卡）：

<img src="assets/chat.png" width="1000" alt="对话输入框选用 WorkBuddy 模型，侧栏底部有额度卡">

模型选择器按 WorkBuddy / WorkBuddy AI 分组，带倍率与免费标记：

<img src="assets/model-picker.png" width="1000" alt="模型选择器里的 WorkBuddy 与 WorkBuddy AI 分组">

设置页管账号池、周期额度与模型列表：

<img src="assets/settings-accounts.png" width="1000" alt="设置页：多账号、周期额度、模型列表">

勾选要出现在选择器里的模型：

<img src="assets/settings-models.png" width="1000" alt="设置页：只显示勾选的模型">

## 功能

- **开箱即用**：装上并启用后，对话里直接选 WorkBuddy 模型。插件复用桌面 App 的登录，账号切换会跟。
- **仪表盘**：侧栏底部一张额度卡，点开中栏看完整面板；设置 → **DSH-WorkBuddy** 管账号、模型、上下文长度和推理档位检测。卡片本身可以关掉。
- **多账号轮换**：同一产品可放多个账号。请求在可用账号之间轮换；被上游限流的会暂时搁置，稍后自动重试。添加方式：扫码、网页令牌、桌面端凭证。
- **额度**：侧栏可显示剩余额度或「已用 / 总量」；国内企业账号走企业计费接口。
- **图片输入**：多数模型支持粘贴或拖入图片。
- **推理档位**：上游声明了的直接显示。没声明的，Web / Desktop 可在选择器里点「推理等级」手动检测（会发少量请求，可能扣积分）。
- **模型显隐**：按登录账号分别保存。隐藏只影响选择器，已有会话不受影响。

## 安装

前置：已安装并登录 WorkBuddy 桌面 App（国际版同理）。核心必须对上，否则 DSH 起不来。

**本版 `0.13.6`** 面向 DSH `0.1.7-alpha.1`、`0.2.0-rc.1`、`0.2.0-rc.2`。更新的 prerelease（如 `0.2.1-rc.x`）不会自动覆盖。

> **不要装 npm 上的 `dsh-workbuddy-connect`。** 那是上游包，和本仓库不是同一条线。

### 从界面安装

DSH 的 **添加插件** 对话框接受：npm 包名（可带版本）、Git 地址、tarball、或本机绝对路径。

1. 打开 **设置 → 插件**（有的客户端写「扩展管理」）。
2. 选 **添加插件**。
3. 填下面任一标识，确认：

```text
dsh-workbuddy-connect-functy
```

或：

```text
github:functy23/dsh-workbuddy-connect-functy
```

4. 装完**刷新页面**；没生效就**重启 DSH 客户端**。桌面 App 由它自己拉起 profile，不要用 `dsh --profile desktop` 当启动命令。

### 从命令行安装

把 `<profile>` 换成实际 profile（`web` / `desktop` / `dsh-tui`）。

从 npm（推荐）：

```sh
dsh plugin --profile <profile> add dsh-workbuddy-connect-functy
```

从 GitHub（仓库里已有预构建 `lib/`，git 安装不会跑 `prepack`）：

```sh
dsh plugin --profile <profile> add github:functy23/dsh-workbuddy-connect-functy
```

```sh
# Web
dsh plugin --profile web add dsh-workbuddy-connect-functy
dsh web
```

```sh
# Desktop（DSH 0.2+ 才让 CLI 管 desktop profile）
dsh plugin --profile desktop add dsh-workbuddy-connect-functy
```

```sh
# TUI（终端界面插件需 0.10.0-beta.5 及以上，更早会 `events is not iterable`）
dsh plugin --profile dsh-tui add dsh-workbuddy-connect-functy
dsh --profile dsh-tui
```

DSH 0.2 之前 CLI 不接受 `desktop` profile，请走上面的界面安装。套壳桌面 App（如 DSH NEXT）的 CLI 入口是自带的 `desktop-cli`，它要求 PATH 上有 `pnpm`。

配置入口：

```text
设置 → 模型                         ← 不显示 WorkBuddy 两行（有意如此）
设置 → 内置插件 → workbuddy-connect  ← 只读运行状态，不是配置入口
侧栏底部                             ← 额度卡，点开中栏仪表盘
设置 → DSH-WorkBuddy                 ← 账号、模型、侧栏显示
聊天模型选择器                       ← WorkBuddy / WorkBuddy AI 分组
```

## 命令行

CLI 二进制仍叫 `dsh-workbuddy-connect`（和 provider id 一样没改，避免已装用户的脚本对不上）：

```sh
dsh plugin --profile <profile> exec dsh-workbuddy-connect status
dsh plugin --profile <profile> exec dsh-workbuddy-connect accounts
dsh plugin --profile <profile> exec dsh-workbuddy-connect doctor
```

默认国内版；加 `--provider workbuddy-ai` 走国际版。`accounts` 只读。`logout` 只删插件自留副本，不动桌面 App 的登录。

## 已知限制

- 在 macOS 的 Web / Desktop / TUI 下验证过（DSH `0.1.7-alpha.1` / `0.2.0-rc.1` / `0.2.0-rc.2`，Node 22+）。Windows 依次探 Local 与 Roaming AppData；WSL 优先读挂载的 Windows 用户目录。用户名不一致时用 `WORKBUDDY_AUTH_FILE` / `WORKBUDDY_AI_AUTH_FILE`。
- 侧栏两个显示偏好要宿主能写设置；状态文档没有对应字段时，设置页不画开关。
- 国际版模型目录来自 App 界面接口，属私有实现，可能失效；届时按「本账号上次成功目录 → 内置目录」降级。
- 国际版企业计费未验证；无凭据时该版模型分组不再显示。
- 依赖 WorkBuddy 客户端接口，App 更新后插件可能要跟。

## 免责声明

仅供个人学习研究，只驱动使用者自己的账号在本机调用。遵守 WorkBuddy 服务条款；后果自负。与腾讯、WorkBuddy、DeepSeek 均无关联。

## 致谢

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect)（MIT）— 上游本体。
- [Mars-Sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider)（MIT）— 设置页、仪表盘与账号行的布局。
- [franksong2702/dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect)（Apache-2.0）— 插件结构与输入框「推理等级」控件的参照。
- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api)（MIT）— 上游协议参照。

## 许可证

[MIT](./LICENSE) © 2026 Corrine Hu and Functy
