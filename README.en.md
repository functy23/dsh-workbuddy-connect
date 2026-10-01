<div align="center">

<img src="icon.svg" width="150" alt="dsh-workbuddy-connect-functy"/>

# dsh-workbuddy-connect-functy

**A Functy fork of corrinehu/dsh-workbuddy-connect: dashboard UI, multi-account rotation and credit in the sidebar, bringing WorkBuddy desktop-app models into DeepSeek Harness.**

[![dsh-workbuddy-connect-functy](https://img.shields.io/badge/dsh--workbuddy--connect--functy-0.13.6-4F46E5)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Language](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Top Language](https://img.shields.io/github/languages/top/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/functy23/dsh-workbuddy-connect-functy)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[![Downloads](https://img.shields.io/github/downloads/functy23/dsh-workbuddy-connect-functy/total)](https://github.com/functy23/dsh-workbuddy-connect-functy/releases)
[![Stars](https://img.shields.io/github/stars/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy/stargazers)
[![Repo Size](https://img.shields.io/github/repo-size/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy)
[![Contributors](https://img.shields.io/github/contributors/functy23/dsh-workbuddy-connect-functy)](https://github.com/functy23/dsh-workbuddy-connect-functy/graphs/contributors)

[Issues](https://github.com/functy23/dsh-workbuddy-connect-functy/issues) • [Changelog](CHANGELOG.md) • [English](README.en.md) / [中文](README.md)

</div>

---

This is a fork of [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect), not the upstream project. The upstream npm package is still `dsh-workbuddy-connect` (currently `0.7.1`, DSH `0.2.0-rc.2` only). This repository publishes as **`dsh-workbuddy-connect-functy`**, with a different UI and account model.

Both the CN **WorkBuddy** app and the international **WorkBuddy AI** app are supported: whichever you have installed shows up as its own model group; both installed shows both, each with its own account and credit.

## How this fork differs

Compared with upstream **0.7.1** (2026-10-01). Features both trees share are not listed as ours.

| | Upstream `dsh-workbuddy-connect` 0.7.1 | This tree 0.13.6 |
|---|---|---|
| UI | two legacy plugin cards in Settings | sidebar credit card + centre dashboard + settings section page |
| Accounts | follows the desktop app's current sign-in | multi-account pool: rotation, QR, token, desktop adopt; a removed account is not swept back in |
| Credit | on the settings card only | in the sidebar, remaining or used/total, can be hidden |
| DSH | **`0.2.0-rc.2` only** | `0.1.7-alpha.1` / `0.2.0-rc.1` / `0.2.0-rc.2` |
| Update notice | bottom-right reminder | not ported |
| npm | `dsh-workbuddy-connect` | `dsh-workbuddy-connect-functy` |

Both trees have: CN/AI groups, image input, reasoning-effort detection, per-account model visibility, CN enterprise credit, picker rate/promo badges, Windows Electron discovery, per-region effort-rejection codes.

## Screenshots

WorkBuddy models in chat (rate and reasoning level in the composer, usage and credit on the status bar):

<img src="assets/chat.png" width="1000" alt="Chat using a WorkBuddy model, with usage and credit on the status bar">

Picker groups WorkBuddy / WorkBuddy AI, with rates and free badges:

<img src="assets/model-picker.png" width="1000" alt="Model picker with WorkBuddy and WorkBuddy AI groups">

Settings page for the account pool, cycle credit and the model list:

<img src="assets/settings-accounts.png" width="1000" alt="Settings: accounts, cycle credit, model list">

Choose which models appear in the picker:

<img src="assets/settings-models.png" width="1000" alt="Settings: show only checked models">

## Features

- **Zero configuration**: after install, pick a WorkBuddy model in chat. The plugin reuses the desktop app's sign-in and follows account switches.
- **Dashboard**: a credit card at the sidebar foot opens the centre-column panel; Settings → **DSH-WorkBuddy** manages accounts, models, context length and reasoning-level detection. The card itself can be switched off.
- **Multi-account rotation**: several accounts per product. Requests rotate across available ones; a rate-limited account is benched and retried later. Add via QR, a pasted token, or the desktop app's own sign-in.
- **Credit**: sidebar can show remaining credit or used/total; CN enterprise accounts use the enterprise billing endpoint.
- **Images**: most models accept paste or drag-and-drop.
- **Reasoning levels**: declared sets show up directly. Undeclared models can be probed from the picker on Web / Desktop (a few requests, may spend credit).
- **Visibility**: saved per signed-in account. Hiding a model only affects the picker; existing chats keep working.

## Install

Prerequisite: the WorkBuddy desktop app is installed and signed in (same for WorkBuddy AI). A mismatched DSH core fails to start.

**This release (`0.13.6`)** targets DSH `0.1.7-alpha.1`, `0.2.0-rc.1` and `0.2.0-rc.2`. Newer prereleases (e.g. `0.2.1-rc.x`) are not covered automatically.

> **Do not install npm's `dsh-workbuddy-connect`.** That is the upstream package, a different code line.

### From the UI

DSH **Add plugin** accepts a package name (optional version), a Git address, a tarball, or an absolute local path.

1. Open **Settings → Plugins** (some clients label this Extensions).
2. Choose **Add plugin**.
3. Paste either identifier and confirm:

```text
dsh-workbuddy-connect-functy
```

or:

```text
github:functy23/dsh-workbuddy-connect-functy
```

4. **Reload the page**; if nothing changed, **restart the DSH client**. The desktop app starts its own profile — do not use `dsh --profile desktop` as a launcher.

### From the CLI

Replace `<profile>` with the profile you use (`web` / `desktop`).

From npm (recommended):

```sh
dsh plugin --profile <profile> add dsh-workbuddy-connect-functy
```

From GitHub (the repo ships prebuilt `lib/`; git installs do not run `prepack`):

```sh
dsh plugin --profile <profile> add github:functy23/dsh-workbuddy-connect-functy
```

```sh
# Web
dsh plugin --profile web add dsh-workbuddy-connect-functy
dsh web
```

```sh
# Desktop (DSH 0.2+ lets the CLI manage the desktop profile)
dsh plugin --profile desktop add dsh-workbuddy-connect-functy
```

Before DSH 0.2 the CLI refused the `desktop` profile — use the UI path above. A wrapped desktop app (e.g. DSH NEXT) exposes CLI through its bundled `desktop-cli`, which needs `pnpm` on PATH.

Where things live:

```text
Settings → Models                            ← no WorkBuddy rows (intentional)
Settings → Built-in Plugins → workbuddy-connect  ← read-only runtime status
sidebar foot                                 ← credit card → centre dashboard
Settings → DSH-WorkBuddy                     ← accounts, models, sidebar
chat model picker                            ← WorkBuddy / WorkBuddy AI groups
```

## CLI

The executable is still `dsh-workbuddy-connect` (same as the provider ids, so existing scripts keep working):

```sh
dsh plugin --profile <profile> exec dsh-workbuddy-connect status
dsh plugin --profile <profile> exec dsh-workbuddy-connect accounts
dsh plugin --profile <profile> exec dsh-workbuddy-connect doctor
```

CN by default; add `--provider workbuddy-ai` for the international product. `accounts` is read-only. `logout` removes only the plugin-owned copy.

## Known limitations

- Verified on macOS Web / Desktop (DSH `0.1.7-alpha.1` / `0.2.0-rc.1` / `0.2.0-rc.2`, Node 22+). Windows probes Local then Roaming AppData; WSL reads the mounted Windows profile first. If user names differ, set `WORKBUDDY_AUTH_FILE` / `WORKBUDDY_AI_AUTH_FILE`.
- Sidebar display preferences need a host that can write settings; missing fields mean no switch is drawn.
- The international catalog comes from the app's own interface and can break; the plugin then degrades to the last successful catalog, then the built-in roster.
- International enterprise billing is unverified; a product with no credential no longer shows a model group.
- Relies on WorkBuddy client interfaces; app updates may require plugin updates.

## Disclaimer

For personal learning and research only, driving your own account on your own machine. Comply with WorkBuddy's terms. Not affiliated with Tencent, WorkBuddy, or DeepSeek.

## Acknowledgements

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) (MIT) — upstream.
- [Mars-Sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider) (MIT) — settings page, dashboard and account rows.
- [franksong2702/dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect) (Apache-2.0) — plugin structure and the composer reasoning-level control.
- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api) (MIT) — upstream protocol.

## License

[MIT](./LICENSE) © 2026 Corrine Hu and Functy
