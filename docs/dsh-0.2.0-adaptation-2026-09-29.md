# DSH 0.2.0-rc.2 适配记录（2026-09-29）

这份文档记的是一次**版本跟进**：DSH 内核从 `0.1.7` 线走到 `0.2.0-rc.2` 时，本插件要动什么、
为什么只动了这几处、以及下一轮该从哪里开始查。结论先放前面：**0.2.0-rc.2 对本插件只有依赖层
冲击，没有 API、协议或界面改动。**

## 现场（当时的真实环境）

- 新宿主：`/Applications/DeepSeek Harness.app`（Electron 外壳，`CFBundleShortVersionString` =
  `0.2.0-rc.2`，2026-09-29 17:55 更新），用的 profile 是 `~/.dsh/profiles/desktop`，GUI 在
  `127.0.0.1:19387`。内核代码在 `Contents/Resources/app.asar/dsh/`（asar，需自行解包：8 字节头 +
  pickle 头 + JSON 文件表，文件体偏移 = 8 + headerPickleSize）。
- npm：`@deepseek-ai/dsh` 的 dist-tag `next` = `0.2.0-rc.2`，`latest` 仍是 `0.1.7-rc.2` ——
  **新线不能靠 `latest` 拿到**，装/升级都要显式写版本。
- 对照的旧线：Tauri 版桌面 App 里那套 `0.1.7-rc.2`（`~/Library/Application Support/dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/`），
  插件自身的 devDeps 基线是 `0.1.7-alpha.1`（`dsh-client-ui-primitives` 是 `0.1.7-rc.1`）。

## 两个内核版本差在哪

包集（`@deepseek-ai/*`）从 284 个变成 287 个，**增删都很少**：

- 新增：`dsh-client-product-analytics`、`dsh-client-ui-settings-session-log`、`dsh-desktop-host`、
  `dsh-experimental-schedule-bundle`、`dsh-host-product-telemetry-otel`、`dsh-otel`。
- 移除：`libreoffice-kit`（含 darwin-arm64）、`node-addon-system-darwin-arm64`。
- 桌面 App 的打包器会**裁掉 `lib/types/*.d.ts`**，所以想比对类型必须从 npm 拿 tarball
  （`npm pack @deepseek-ai/<pkg>@0.2.0-rc.2`），asar 里只剩运行期 JS。

插件实际依赖的 17 个包，**导出符号面完全没变**（逐文件比对 `export {...}` / `export const|function|class`）：
只有 `dsh-client-ui-primitives` 增补了一批图标与菜单件、删掉 `OnboardingSurface`，`dsh-llm` 增补
`ACCOUNT_QUOTA_EXCEEDED_CODE` 与 `projectToolUpdates`。插件一个都没用到。

`.d.ts` 的实质变化（`npm pack` 对比 `0.1.7-alpha.1`）：

| 包 | 变化 | 对本插件的影响 |
|---|---|---|
| `dsh-client-ui-sidebar` | `SidebarRootInjected.hooks` 增 `shortcuts` | 无（只增不改，插件未读） |
| `dsh-client-ui-layout` | `ILayout` 增 `panelInfo`、`LocaleNamespaceMap` 增 `shortcuts.layout` | 无 |
| `dsh-client-ui-settings` | `SettingsLauncherOwnerProps` 增 `settingsOpen` / `settingsShortcut` | 无（插件不实现该 owner） |
| `dsh-client-ui-model-selection` | 新增 `provider-order.d.ts`；`ModelDirectoryState` 增**必填** `pending` | **测试假件要补字段**（见下） |
| `dsh-client-ui-primitives` | 删 `OnboardingSurface` | 无（插件只用 Button / Menu / MenuEntry） |
| `dsh-llm` | 调用配置增 `toolUpdate`，新增工具更新投影 | 无（类型可选，适配器未引用） |
| `dsh-llm-pi-ai` | 兼容位 `deferredToolsMode` → `supportsMidConvoSystemMessages` / `supportsMidConvoToolAdditions` | 无（插件自带 profile 未声明这两位） |
| `dsh-atomic-write` | 锁记录持有者 PID，孤儿锁可接管 | 无（行为改良，调用面不变） |

`dsh-client-modules` 里读 `dsh.client.inject` 的那段代码新旧**逐行相同** —— 客户端半边的模块契约没动，
所以 `package.json` 的 `dsh.client.*` 一个字都不用改。

## 真正挡住的三处（外加一处测试）

1. **peer range**：插件原来写 `^0.1.7-alpha.1`，语义上止步于 `0.2.0`，装进 0.2.0 核心会报 peer 不满足。
   现改为两条线的并集 `^0.1.7-alpha.1 || ^0.2.0-rc.2`，**旧线不丢**。
2. **`@earendil-works/pi-ai`**：`dsh-llm-pi-ai@0.2.0-rc.2` 依赖 `^0.87.1`（0.1.7 线是 `^0.85.1`）。
   插件自己若仍钉 `^0.85.1`，树里会同时存在两份 pi-ai，`src/adapter.ts` 把 `Provider` 交给宿主的
   `piProvider` 时直接编译失败：`TS2375 … not assignable … 'exactOptionalPropertyTypes: true'`。
   → devDep 升 `^0.87.1`，peer 放宽成 `^0.85.1 || ^0.87.1`。
3. **`@deepseek-ai/schemastery`**：插件原来钉死 `3.18.3`，而 `dsh-llm-pi-ai@0.2.0-rc.2` 要 `~3.18.4`，
   两份并存时 dts 构建报 `TS2742: The inferred type of 'WORKBUDDY_PREFERENCES' cannot be named …`
   （`pnpm run build` 失败，而 `run typecheck` 还是绿的 —— **只看 typecheck 会漏**）。
   → 改成 `^3.18.4`，与宿主去重到 3.18.4。
4. **测试假件**：`ModelDirectoryState` 在 0.2.0 增了必填 `pending: ModelSelection | null`
   （"刚提交、尚未落定"的选择），`tests/client-defects.spec.ts` / `client-variants.spec.ts` /
   `probe-composer.spec.ts` 里三处按老接口写的快照字面量全部报 `TS2741`。插件自身不读 `pending`，
   所以给假件补 `pending: null`（这些假件描述的都是已落定的快照）。

## 验证

- `pnpm install`（pnpm 11，本机 store）→ `pnpm run build` → `pnpm run check`（typecheck 双 tsconfig +
  52 文件 / 659 用例 + 构建）→ `pnpm run test:engine` 全绿。
- 另外做了一次 **fresh-clone 模拟**：`rsync` 出一份干净树（不带 `node_modules`）跑
  `pnpm install --frozen-lockfile` + 上面全套，同样全绿；解析到的 `pi-ai` = `0.87.1`、
  `schemastery` = `3.18.4` —— 也就是 README 里那条 GitHub 安装路径拿到的就是这套。
- 运行期旁证：更新后的宿主进程（PID 45711）`lsof` 里能看到插件在 `$DSH_HOME` 下自己那 6 个
  `.workbuddy-*.json` store 全部被打开，说明宿主半边确实被新内核挂载了。
- **没覆盖到的**：浏览器半边的目视验收（要人看界面），以及"新 `lib/` 是否被宿主加载"——宿主只在
  启动时读 `lib/index.js`，**改完必须重启 DSH**。

## 下一轮（0.2.x / 0.3）从哪里开始

1. `npm view @deepseek-ai/dsh dist-tags` 确认新版本号与 tag（别信 `latest`）。
2. `npm pack` 插件依赖的那 17 个包的新旧两版，比对导出面与 `.d.ts`（asar 里没有类型）。
3. 重点看三件套：`dsh-client-ui-slots` 的 `SlotMap`、`dsh-client-ui-model-selection` 的目录状态、
   `dsh-llm-pi-ai` 的兼容位与 `ResolvedPiAiProviderProfile`。
4. 升 `package.json`（devDeps 钉新版、peer 写并集、pi-ai 与 schemastery 跟宿主同线）→ **先 build**
   （`tests/version.spec.ts` 会先于构建检查产物版本号）→ `check` + `test:engine`。
5. `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 会由 pnpm 11 自动追加新版本条目 —— 那是本机
   全局 `minimumReleaseAge` 策略的例外清单，**别删**，删了 prerelease 装不上。
