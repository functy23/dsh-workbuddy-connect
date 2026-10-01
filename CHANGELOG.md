# Changelog

版本号即 git tag，遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.13.6] — 2026-10-01

- **对外改名**：仓库与 npm 包改为 `dsh-workbuddy-connect-functy`，以区别上游 `corrinehu/dsh-workbuddy-connect`（npm 上的同名包仍归上游，当前 `0.7.1`）。provider id（`workbuddy` / `workbuddy-ai`）和 CLI 二进制名 `dsh-workbuddy-connect` 保持不变，已装用户的会话和脚本不用改。
- 状态 / 探测 / 账号路由改为 `/plugins/dsh-workbuddy-connect-functy/...`，与新包名一致。
- README 中英重写：标明 fork、对照上游 0.7.1 的差异、界面安装与命令行安装分开写。
- 截图换成 2026-10-01 实拍（对话、模型选择器、设置账号、设置模型），并在仓库根声明 `screenshots.json`。
- 并入上游：Windows 在 Electron 宿主内发现桌面 App（#66），以及国际端点的 effort 拒绝码按区域识别（#75）。

[0.13.6]: https://github.com/functy23/dsh-workbuddy-connect-functy/releases/tag/v0.13.6
