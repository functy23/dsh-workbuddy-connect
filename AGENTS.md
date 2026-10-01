# dsh-workbuddy-connect Agent Notes

> **自用笔记**：这是维护者本机的工作笔记——含本机绝对路径、profile 布局、发布约定与个人判例；随仓库跟踪只是为了与它描述的代码同版本可追溯，**不是项目文档，也不是给其他使用者的说明**，里面的路径和约定换台机器就不成立。
> 面向使用者的文档是 `README.md` / `README.en.md`（两份必须同步改）。

## 项目坐标

- 开发副本 `~/Desktop/dsh-workbuddy-connect`，remote `origin` = `functy23/dsh-workbuddy-connect`（分发源，见下），`upstream` = `corrinehu/dsh-workbuddy-connect`（原作者，npm 上同名包属于它）。版本 `0.13.1`，未发 npm。
- 核心配对（README 有表）：**0.13.1 同时对 DSH `0.1.7-alpha.1` 线与 `0.2.0-rc.2` 线**（peer range 是两条线的并集，devDeps 按 0.2.0-rc.2 编译）；**0.13.0 只对 `0.1.7-alpha.1`**；0.3.2–0.5.4 对 `0.1.5-rc.1`；0.3.0–0.3.1 对 `0.1.2-rc.1`；0.2.6 对 `0.1.1-rc.2`。**装错哪个方向 DSH 都起不来。**
- **DSH 每次发新 prerelease，插件要显式跟 peer range**（0.2.0 那轮的实测细节见 `docs/dsh-0.2.0-adaptation-2026-09-29.md`）：真正会挡住的只有三处 —— peer range、`@earendil-works/pi-ai`（跟宿主同线）、`@deepseek-ai/schemastery`（去重到宿主那一版）。**`pnpm-workspace.yaml` 里的 `minimumReleaseAgeExclude` 是 pnpm 11 因本机全局 `minimumReleaseAge` 策略自动写的，删了会装不上 DSH 的 prerelease，别清。**
- 两半边：`src/` = host（凭据、上游协议、routes、provider）；`src/client/` = 浏览器半边（槽位、设置页、仪表盘）。各有 tsconfig（`tsconfig.json` / `tsconfig.client.json`）。
- **`lib/` 入库**：改完源码必须 `pnpm run build`，否则装包的人拿到旧产物。

## 本机环境

- PATH 里没有 node/pnpm：先 `export PATH=/opt/homebrew/bin:$PATH`。
- 一律 `npx --yes pnpm@11 ...`（pnpm 11 才认本机 store，别的版本报 `ERR_PNPM_UNEXPECTED_STORE`）。
- 常用：`run test`（vitest，约 5s）／`run typecheck`（两个 tsconfig）／`run build`／`run test:engine`（产物能否被引擎加载）。
- DSH profile 在 `~/.dsh/profiles/{web,desktop}`；参照插件 `@mars-sea/dsh-commandcode-provider` 装在这两处（UI 移植自它）。

### 插件装在哪（**别再造第二份副本**）

两个 profile 都用 `link:` 装本插件，**现在都指向这个工作副本**：

```
~/.dsh/profiles/web/package.json      "dsh-workbuddy-connect": "link:/Users/functy/dsh-plugins/dsh-workbuddy-connect"
~/.dsh/profiles/desktop/package.json  "dsh-workbuddy-connect": "link:/Users/functy/.dsh/plugins/dsh-workbuddy-connect"
        ↓ 上面这两个路径现在都是符号链接（2026-09-27 统一）
/Users/functy/Desktop/dsh-workbuddy-connect        ← 唯一开发副本
```

- **改完必须 `pnpm run build`**，并**重启 DSH**，宿主才会加载新的 `lib/index.js`（浏览器半边刷新页面即可换新，偏好字段名是顶层不变的，旧宿主 + 新客户端安全）。
- 2026-09-27 踩过的坑：同一个项目存在**三份副本**（`~/dsh-plugins` 的 git 克隆、`~/.dsh/plugins` 的打包安装、Desktop 这份），DSH 实际加载的是前两份里的旧构建，Desktop 的成果一直没生效。两份旧副本已归档到 `~/dsh-plugins/_archive-20260927/`（`…-clone-0942`、`…-packed-1717`），确认无碍后可删。
- `~/.dsh/plugins/` 是 `link:` 的目标 store，**不是扫描根**（profile 用绝对路径引用它），但别往里丢同名目录。

## 分发渠道（重要）

- **README 的安装方式是 `dsh plugin --profile <p> add github:functy23/dsh-workbuddy-connect`，不是 npm。** 因为 `lib/` 入库，git 安装直接拿预构建产物（`prepack` 在 git 安装时不执行），所以**推到 `origin/main` 就等于发布** —— 不推，别人照 README 装到的还是旧版本。
- **npm 上的 `dsh-workbuddy-connect` 是上游 `corrinehu` 的旧线**（最新 `0.6.3`，只支持 DSH `0.1.5-rc.1`），与本仓库的 `0.13.1` 不是同一条代码线，装到 `0.1.7` 上 DSH 起不来；包名也归上游，本仓库发不了同名包。
- 同一 profile 里 `dsh-infinite-gen-4: "github:Minglink/…#<sha>"` 是 `github:` 规格可用的先例，需要可复现时可以钉 SHA。
- `package.json` 的 `repository`/`homepage`/`bugs` 已指向 `functy23`；署名按 MIT「保留原作者 + 追加」处理：`LICENSE` = `Copyright (c) 2026 Corrine Hu and Functy`，`package.json` 的 `author` 同文。**不要**把原作者从署名里删掉。

## 发版规矩

未经明确指令**不得 `npm publish`、不得打 release tag**。**push 到远端（含普通 main 推送）必须先经用户同意**；本地 commit 可自主（用户说「提」= 只 commit，不含 push）。发布前 `pnpm run check` 全过，顺序固定：**先升版本号 → check/构建 → 最后发布**。

## 硬性不变量（改代码别破）

- **两个变体永远对称**：CN `workbuddy` 与国际 `workbuddy-ai` 的 config / route / 卡片 / 文案必须成对；只给一版加东西时，先问另一版怎么办。
- **plugin-wide 偏好只有一份**：设置写回走 `volatile` 字段（`sidebarCreditStyle`、`sidebarCreditVisible`…），两个变体的 route 都要接受写、两份文档都带回同一个值 —— 侧栏只有一张。
- **"说不出来的偏好 = 保持原样"**：文档里没有该字段时，改变外观的偏好回默认；**会删掉一个表面**的（如 `sidebarCreditVisible`）必须读作"开"，否则一次升级就清空别人的侧栏。
- **样式是类，不是内联对象**：规则全在 `src/client/ui-styles.ts`，前缀 `wbp-`，颜色只取 `--dsw-alias-*`。设置页是一列行（720px、发丝线分隔），不是卡片。
- **立即写 vs 暂存写**：改"此刻就在屏幕上"的表面（侧栏卡片、额度显示）→ 立即写；模型筛选 → 暂存，等保存栏。
- **槽位的 `t` 是命名空间绑定的**（只吃该命名空间的 key）：客户端组件 props 里的 `t` 必须声明成那个 key 联合（见 `PanelLocaleSeat`），**不能写成 `(key: string)`** —— 参数逆变，宿主会给不进去。
- **`ModelDirectoryState.current` 是 `ModelSelection | null`**：空值判断一律 `== null`。写 `=== undefined` 会把 null 放过去 → 渲染期 `TypeError: Cannot read properties of null (reading 'provider')`（本轮已实测复现，`credit-badge.tsx` 一直是对的，`WorkBuddyProbeControl.tsx` 那三处是错的）。
- **测试里的 store 假件要满足接口**（实现 `update`/`set`，或用 `satisfies`），不要 `as unknown as` 糊过去：假件撒谎 = 真问题测不出来。真签名是 `update(mutator: (snapshot) => void)`（可变草稿式，不是返回新快照）。
  - **带 private 字段的类没法被对象字面量结构化满足**（`WorkBuddyCredentialStore` 就是这样）→ 用 `tests/doubles.ts` 的 `credentialStoreDouble()` / `shimDouble()`，它们是**继承真类**的，不是强转。
  - 平台类型（`Response`/`fetch`/`Document`/`CanvasRenderingContext2D`）的桥接不在此列，那是不可避免的。
- **新增一个偏好 = 改 4 个文件**：`src/preferences.ts` 一行（zod 字段 + `stated` 投影）→ 设置页控件 → `locales.ts` 文案（中英）→ `index.ts` 的 route action。**config schema、默认值、状态文档字段、浏览器半边的读取都已经从那张表派生**，别再手写第二份。
- **所有 store 的读写只走 `src/store-file.ts`**：`readStoreDocument`（一个 `undefined` 策略）+ `writeStoreDocument`（每次随机后缀 + `wx` 独占写的原子替换）。**不要**再手写 `${path}.tmp` —— 两个进程共用同一个 tmp 名会互相截断。
- **JSON 形状判断只走 `src/json-value.ts`** 的 `isJsonObject` / `parseJsonObject`，别再写 `typeof x !== 'object' || x === null || Array.isArray(x)` 的第 N 份副本。
- **状态文档读取只走 `src/client/status-document.ts`**：`readWorkBuddyStatus`（请求 + 形状校验 + refused/unreadable/read 三态）+ `statedPreference`（plugin-wide 偏好从"第一个真正回答了该字段的文档"里取）。
- **不要再给代码注释指向未入库的文档**：`docs/reasoning-effort-probe-plan.md`、`docs/r3-final.js`、`docs/client-defect-confirmation.md`、`docs/upstream-identity-alignment-plan.md`、`docs/workbuddy-ai-international-research-2026-09-11.md`、`docs/client-identity-live-verification-2026-09-14.md` 都**不在库里**；引用已全部改写成自足说明。`AGENTS.md` 本身也被 gitignore，别当共享知识源。

## 当前状态

- 0.13.0：仪表盘界面（侧栏卡片 + 中栏仪表盘 + 设置分区页）＋**侧栏额度卡片开关** `sidebarCreditVisible`。
- 0.13.1：**DSH 0.2.0-rc.2 适配**（纯依赖/兼容层，界面与协议零改动）：devDeps 的 `@deepseek-ai/dsh-*` 全部升到 `0.2.0-rc.2`、peer range 放宽成 `^0.1.7-alpha.1 || ^0.2.0-rc.2`（pi-ai 同理 `^0.85.1 || ^0.87.1`）、`@earendil-works/pi-ai` 升 `^0.87.1`、schemastery 从钉死 `3.18.3` 改 `^3.18.4` 与宿主去重；三个测试假件补上 0.2.0 新增的必填字段 `ModelDirectoryState.pending`。
- **HMAP 评测整改已落地**（报告 69 分；改动见 `git log` 里 2026-09-26 之后的 4 个提交）：
  1. **删掉死组件** `src/client/WorkBuddyPluginCard.tsx`（1268 行）+ 3 个只测它的 spec（1378 行）+ 30 条文案。它是 #48「让 Agent 帮你处理」的**唯一实现**，`48a054a` 换掉注册时功能就下线了 —— 已**明确砍掉该功能**，同时拆掉 host 侧 `reasonCode` 线（wire 字段、枚举、`reasonCodeOf` 的 wire 用途），只保留 `WorkBuddyElectronPathError.reasonCode` 作为模块内部失败分类（测试在用）。
  2. **抽 4 个共用件**：`src/json-value.ts`、`src/store-file.ts`（6 个 store 的读守卫 + 6 处手写原子写 → 各 1 处）、`src/client/status-document.ts` 的 `readWorkBuddyStatus` / `statedPreference`。
  3. **偏好单源表** `src/preferences.ts`：加一个偏好从 8 个文件降到 4 个。
  4. 15 处悬空文档引用改成自足说明；README 中英两处事实偏差（4 挂载点→6 slot、样式承诺）已纠。
  5. 测试：52 文件 / 659 用例。（原 55 / 717，差额全是随死组件一起删的。）
- `pnpm run check` + `test:engine` 全绿。
- 截图：`assets/{1..6,8}.png` 在用，`7.png` 是孤儿（0.1.5 旧卡片）。**2.png 的磁贴仍是修复前的 `{count}`，3.png 与 8.png 的胶囊仍是 `DSH WorkBuddy Connect`** —— 重拍覆盖同名路径即可，README 不用动。

## 待办

- （可选）重拍 `assets/2.png`：磁贴标签已修好，实拍还是旧的。
- `assets/7.png`：删掉，还是挂进「管理页」当补充图。
- **跨进程丢更新（未做，已知风险）**：6 个 store 都在 `$DSH_HOME` 根下，而插件同时装在 `profiles/{web,desktop}`。两个宿主同时跑时各有各的内存副本，`persist()` 是"载入→改→整份写回"，没有跨进程锁 → 后写的会覆盖先写的（账号池最疼）。正解是给每个 store 的 read-modify-write 套 `@deepseek-ai/dsh-atomic-write` 的 `withFileLock`（`auth.ts` 已在用），代价是 `persist()` 得从同步改异步，往上传染到 `account-pool` 的 `remove/reorder/setLabel/setEnabled` 等同步方法。
- **测试里的 `as unknown as` 还剩 57 处**（原 67）：已处理掉 store/shim 假件；剩下的是 `WorkBuddyWebStatus` 部分文档夹具（`settings-page.spec.ts` 15 处最多）、`Response`/`fetch`/`Document` 平台桥接、以及 `ctx.settings` 取假件私有方法的 4 处。
- 发布 0.13.1 前：已在 DSH `0.2.0-rc.2`（Electron 版）与 `0.1.7` 线上对齐依赖；`pnpm run check` + `test:engine` 全过；版本号已升（**先升版本号再 build，否则 `tests/version.spec.ts` 会先失败**）；**push 前先问用户**。
