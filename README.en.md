# DSH WorkBuddy Connect


[![version](https://img.shields.io/badge/version-0.13.0-blue)](https://github.com/functy23/dsh-workbuddy-connect/blob/main/package.json)
[![GitHub stars](https://img.shields.io/github/stars/functy23/dsh-workbuddy-connect)](https://github.com/functy23/dsh-workbuddy-connect)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![DSH core](https://img.shields.io/badge/DSH-0.1.7--alpha.1%2B-blueviolet)](https://github.com/deepseek-ai/deepseek-harness)


English | [中文](./README.md)


Brings every model in the WorkBuddy desktop app (GLM-5.3, GLM-5.2, DeepSeek-V4-Pro, DeepSeek-V4-Flash, Kimi-K3, MiniMax-M3, Hy3, and more) straight into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — zero configuration in the DSH chat.

Both the CN **WorkBuddy** and the international **WorkBuddy AI** apps are supported: whichever one you have installed shows up as its own model group, and having both installed shows both, each with its own account and credit.


## Features

- **Works out of the box**: install and enable the plugin, then use it directly in DSH — no extra configuration.


![WorkBuddy models in the DSH model picker](assets/1.png)


- **CN and international side by side**: the CN app appears as the **WorkBuddy** group and the international one as **WorkBuddy AI**. Their models, accounts, and credit never mix — each keeps its **own account pool**, and every figure on screen is **stated for both, never summed**.

  Whether a group appears depends on whether **its account pool is empty**, not on whether the desktop app is currently signed in. Once you sign in to the desktop app, the account is recorded in the pool and kept; the group then keeps working even after the desktop app signs out, because the plugin holds the credential.

![WorkBuddy AI models in the DSH model picker](assets/5.png)


- **Image input**: most models accept images — paste or drop one straight into the conversation (GLM-5.3-Flash, GLM-5.2, the DeepSeek-V4 series, and more); the few text-only models (e.g. GLM-5.1) clearly say so.


- **Reasoning levels**: levels explicitly declared by WorkBuddy appear directly — for example, GLM-5.3 and GLM-5.3-Flash offer low / high / max. For some models that do not declare selectable levels, Web and Desktop provide a **Reasoning levels** control in the model picker for a manual check. It sends a few requests and may consume credit. Models without a check result or selectable levels continue to use WorkBuddy's default.


- **Status and detection**: **Settings → DSH-WorkBuddy** shows the account, token validity, remaining credit, and model offers. It also lets you refresh the model list manually and shows whether the current list came from the upstream or from the built-in fallback, and provides manual reasoning-level detection for eligible models.

- **Model visibility**: both WorkBuddy and WorkBuddy AI let you tick which models appear in the model picker, on the management page. Hidden lists are **saved per signed-in account**: switching accounts switches to that account's own list, switching back restores it; new accounts and newly added models are visible by default. Hiding only affects pickability — **existing chats using a hidden model keep working**.

![Model filter and visibility on the management page](assets/6.png)


- **The sidebar summary can be turned off entirely**: the credit card at the bottom of the sidebar is both the always-on summary and the way into the dashboard. When you do not want it, **Settings → DSH-WorkBuddy → Sidebar** switches it off, and the dashboard moves to the *Open dashboard* row in the same group. See [UI structure → the sidebar card](#the-sidebar-card).


- **Enterprise credit**: on the CN product, enterprise accounts (non-empty `enterpriseId`) read their cycle quota from the enterprise billing endpoint, and the card shows an "enterprise quota" row with the cycle reset time.


- **Multi-account rotation**: each version can hold several accounts at once, and requests rotate between them automatically. When an account is rate limited (429), out of quota (402), or has an expired sign-in (401), the request is **retried on another account in the pool**, so the conversation does not break. Each healthy account is tried at most once per request — never an unbounded retry loop.

  A limited account is set aside, and the card says when it returns — in hours when that is the honest unit. **That time comes from the upstream**, which states the moment the allowance resets in its 429 body (for example "your usage will reset at 2026-09-13 21:50:51 UTC+8"). A schedule the server already knows beats one this plugin would invent, and the plugin's own backoff (a minute, doubling, capped at fifteen for a rate limit; an hour, capped at a day, for exhausted quota) applies only when the upstream says nothing.

  A benching is decided by the upstream's answers alone: the **thirty-second credential poll never clears it**, and it never switches an account you disabled back on. The poll only treats the source file as a new sign-in when the credential in it demonstrably post-dates the one the pool holds — which means the desktop app really did sign in again.

  A 401 is handled two ways: the account is marked `sign-in expired` only when the upstream **refuses** the refresh outright, and the card's Enable button brings it back. A refresh that merely could not be completed — a timeout, a 5xx, an unreadable body — says nothing about the session, so the account is benched for a while instead of being written off.

  Accounts come from two places: **the desktop app's sign-in is captured automatically**, and you can **add more by QR** from the card (scan with the phone app; the sign-in joins the plugin only and does not touch the desktop app).


## UI structure

Four surfaces, one navigation story. Every one of them registers through a DSH slot — the plugin mounts nothing of its own. Two further small controls sit beside the composer (the credit badge and the reasoning-level button), for six slots in all:

| Surface | Purpose | What it shows |
|---|---|---|
| **Sidebar foot** — the "WorkBuddy" card | Always-visible summary | One line per product: spend as "used / total" over a bar, or the bare balance when no capacity was declared. **A product with no account is not listed at all**; the whole card can be switched off from the settings page |
| **Centre-column dashboard** (opened by the card) | The full panel | Per product: accounts, total credit, models, benched accounts, catalog source; plus Refresh and Close |
| **Settings → DSH-WorkBuddy** | The management page | Account pool (add / test / enable / remove / QR / token sign-in), model list, context-length switch, reasoning-level detection, and the sidebar's own two display preferences |
| **Settings → Models → WorkBuddy (AI)** | A summary card inside that provider's row | Account count and how many are ready, model count, benched count, and the accounts with their balances |

The two products' figures are **always stated side by side and never summed**: their credits are not convertible and their accounts are not interchangeable.

### The sidebar card

The card gives each product **one line**, and by default states **the remaining credit alone** (`WorkBuddy 剩余额度 5,266`) — the cycle's capacity (the figure after the slash) is not what anyone opens the sidebar to read. Switch to the reference card's shape — a "used / total" pair over a ratio bar — from **Settings → DSH-WorkBuddy → Sidebar → Sidebar credit line**; both styles are one click apart and take effect at once.

**If you do not want the card at all, the *Sidebar credit card* switch in the same group takes it away.** It is the one preference here that **removes a surface** rather than reshaping it, so three things have to hold together:

- The card — **and the quota ring it collapses to** — leaves the sidebar. That 36px ring is a credit figure too; emptying only the wide card is not switching anything off.
- The **Sidebar credit line** row goes with it: it describes precisely the card that is no longer drawn.
- A **Dashboard → Open dashboard** row appears in the same group. The card was the plugin's **only** other way into the dashboard, so a switch that hid the one door would be a trap rather than a setting. Turning the card back on withdraws that row again.

![The Sidebar group with the card switched off: the Open dashboard row takes its place](assets/8.png)

Switching the card off **does not switch off the reading**: the account pool keeps being polled, and the dashboard and the composer badge keep updating. The background sweep lives on the card's own component, which stays mounted (rendering nothing) while the card is off — "no card on screen" is not "no data".

The preference is **on by default**, and **only an explicit `false` counts as off**: an older host, a read that failed, or a profile with no settings service all read as *on*. That is the one deliberate asymmetry — every other preference reshapes a surface that is always there, while this one takes it away, so an unknown value has to leave it alone; defaulting the other way would empty the sidebar of anyone who merely upgraded.

Both products share **one sidebar**, so there is one answer: a write from either product's card is served back on the other's document. When the document carries no such field (a host that cannot store the preference), the settings page **draws no switch at all** — a switch that could not be saved is worse than no switch.

In the 56px collapsed rail the card becomes a 36px quota ring that opens the same dashboard. Opening the dashboard replaces the centre column without touching the current Session; Close (or the card again) returns to the conversation.

### The centre-column dashboard

Clicking the sidebar card — or **Open dashboard** on the settings page while the card is off — opens the full panel in the centre column: per product, accounts, total credit, model count, benched accounts, and the catalog's source, with Refresh and Close. Opening it does not touch the current Session; Close (or the card again) returns to the conversation.

![The sidebar card and the centre-column dashboard it opens](assets/2.png)

### The management page: Settings → DSH-WorkBuddy

Its own entry in the settings navigation. The page is a **column of rows**, not a card, with the accounts above, the models below, and a group of its own for the sidebar.

![The management page: accounts above, models below](assets/3.png)

#### Accounts

Holds both products in a single list. Each row's head line carries the account name and a chip naming which product it belongs to (**WorkBuddy** / **WorkBuddy AI**, the same names the dashboard uses) — the one fact that must not be guessed, since the two products' credits are not convertible and their accounts are not interchangeable.

- **Rows fold.** The head line is always visible (status dot, name, product, and either the balance or the current state); opening it reveals the rest.
- A **⋮ menu** sits at the right of each head line (the Command Code account row's shape): enable/disable, test, rename, and remove all live behind it. Enable and disable write **immediately** — "stop using this account now" is not a change to hold until Save. Removing asks inline, in the row's own confirm bar, instead of through a system dialog that some shells suppress entirely (which made Remove look like a broken button).
- A **balance / cycle meter** sits under the head line: the words "This cycle" and a progress bar reading "balance / cap" (e.g. `2,373 / 2,800`) when the upstream declared one, and the balance alone with a note when it did not.
- **Disable is your override for everything rotation decides on its own**: an account that is benched, one judged to have an expired sign-in, or simply one you do not want spent. **Enabling it again is also the only way back for an account the plugin wrote off** — that flag is cleared by the same press.
- The **Add account** button asks which product first, then opens that product's sign-in dialog.
- **"Open sign-in page" hands the URL to your system browser** — the session and password manager the sign-in needs live there. The plugin tries, in order: `window.open`, then the host process's own operating-system hand-off (the one that works on the desktop), then DSH's right-sidebar browser, then an `<a target=_blank>` click. **When all four fail it shows the address to copy**, rather than leaving a button that appears to do nothing.
- The group ends with the **per-product total credit** tiles, side by side and never added together.
- A rate-limited or out-of-quota account says so in its head line ("rate limited · retry in 3 h"); an account added by a pasted token shows "sign-in expired" once its token lapses.

#### Models

The models stay per product, each group with a refresh button and the list's provenance (live / saved / built-in). Each row shows the model name, its promotion badges and rate, and its context-window switch.

**Show only selected models.** The filter row above the model list holds a **dropdown multi-select** (a "Choose models" pill, the same control the Command Code provider uses) and a switch.

- The pill opens a **searchable checkbox menu**: type to filter by id or name, click a row to toggle it, and the picks commit when the menu **closes** — one host write per visit instead of one per click.
- With the switch OFF the menu edits the **whole catalog** (the host treats "off" and "everything visible" as one state, so there is no stored list to edit), and picking anything **turns the switch on by itself** — otherwise unticking one model would hide the entire catalog through a list that only ever named it.
- With the switch ON only the ticked models reach DSH's model picker, and the row shows "N of M selected".
- **The filter is staged**, exactly as Command Code stages it: edits stay on the page until the **save bar** at the bottom writes them, and Discard puts the product back to what the host reports.
- **The last tick cannot be removed**: an empty list means "no filter" to the host, so clearing it would reopen the whole catalog.
- A model the filter excludes keeps its row (context window and detection still work) and gains a **small dot** marking it as excluded from the picker.
- A host too old to know this write says so explicitly ("restart DSH Desktop and try again") and **keeps the edit staged** rather than losing it.

#### Sidebar

The plugin's own display preferences, in a group of their own, in dependency order:

- **Sidebar credit card** (switch): shows both products' balances at the bottom of the sidebar. Off: no card is drawn there, and the dashboard is opened from the row below.
- **Sidebar credit line**: `Remaining only` / `Used / total + bar`. Present only while the card is there — it describes that card.
- **Dashboard → Open dashboard**: present only while the card is off, taking over the door the card used to be.

Both preferences write **immediately** (they are not staged behind the save bar): they change a surface that is on screen while the control is being used, and staging would let the sidebar draw one thing while the control claims another. When the host does not accept the write, these rows are **not drawn at all**, rather than offering a switch that could not be saved.

### Remaining credit in the composer

While the session's model is a **WorkBuddy** one, a small badge appears at the far right of the row under the input box — the same row that carries token usage, cache-hit rate and speed: `WorkBuddy: 5,266` (or `WorkBuddy AI: …`). It states that product's remaining credit, read from the same store the sidebar card and the dashboard use, so the three surfaces can never disagree. It disappears for any other provider (that quota cannot be spent) and while the product is signed out or its balance has not been read — an absent figure, never a zero.

Switching the sidebar card off **does not affect this badge** (or the dashboard): the card simply stops being drawn in the sidebar, and the reading carries on — see [the sidebar card](#the-sidebar-card).

- **Rate**: every model name carries its credits multiplier (e.g. `GLM-5.2 · x0.79`, `Hy3 · x0.00`) in both the `/model` popup and the composer's model dropdown. The rate is display-only and never affects requests.

- **Promo badges**: promo badges (`限时免费`, `夜间折扣`, `Free now`) ride the model name itself (e.g. `Hy4 preview · x0.00 · 限时免费`), visible wherever you pick a model. They are shown in the service's own words rather than translated, and when a badge already says a model is free no additional "Free" chip is stacked on it. Per the WorkBuddy service data, synced each time DSH starts. The international version's promotions come from the service's `modelPromotions` (which carry an effective window). Once a promotion lapses its badge is withdrawn; because the service writes the discounted value into the model's own rate field, the original price cannot be reconstructed, so that model then reports "price unavailable — refresh to update" rather than repeating the discounted rate or claiming the model is free.

### How the UI is built

All four surfaces share one implementation:

- **Styles are classes, not inline objects.** Every rule these four surfaces draw lives in the two stylesheets `src/client/ui-styles.ts` returns (`wbp-` prefixed) and every colour is a `--dsw-alias-*` theme token. The one exception is the pair of single-line composer controls: they have no interactive state, so the cross-file indirection would cost more than it buys, and they use tokenised inline styles instead (about twenty of them, colours still taken from `--dsw-alias-*`). An inline object can carry a token but not a `:hover`, a `:focus-visible`, an `::after`, or a media query — so each interactive affordance used to be reimplemented in JavaScript, and each colour was a literal that got dark mode wrong.
- **The settings page is a column of rows, not a stack of cards.** A 720px content column, groups of hairline-separated rows under a heading (title and description left, control right), the same shape as the harness's own General and Models pages. Account rows fold: the head line is always visible, and opening it reveals the balance, the state and the actions.
- **Buttons, switches and tags are the platform's own** (`@deepseek-ai/dsh-client-ui-primitives`, a seed module the browser shell provides), so a row's controls are literally the controls the harness's settings pages draw.
- **The Models-page card is self-contained.** It shows the summary and offers a Refresh; it does not navigate, because the settings shell exposes no navigation seam to a plugin and inventing a URL would be a button that looks live and does nothing. Managing accounts stays on the management page.
- **Switching the card off is not switching the data off.** The card's component is the only host of the shared poll: it stays mounted and renders `null` while the card is off, which is what keeps the dashboard and the composer badge fresh.


## Why reasoning levels work this way

Information about WorkBuddy models' reasoning levels is currently split between upstream API responses and private UI logic in the client, while the model catalog changes quickly. If the plugin filled in one uniform set of levels for every model without an upstream declaration, it would need to keep chasing unpublished product logic with no stable contract.

![Reasoning-level detection in the composer](assets/4.png)

Testing also found that some models accept the `reasoning_effort` parameter while ignoring unknown values and falling back to their default behavior. A successful request alone therefore does not prove that a level is actually usable.

For models without declared levels, Web and Desktop instead use user-authorized, on-demand detection: it first confirms that the upstream validates the parameter, then checks which standard levels it accepts. The check sends a few requests and may consume credit. Its result means only that the upstream currently accepts that level; it does not promise a particular change in reasoning quality, speed, or credit use.


## Install

Prerequisite: the WorkBuddy desktop app is installed and signed in. The plugin reuses the app's sign-in state and follows account switches automatically; the same applies to the international WorkBuddy AI app, and the two do not affect each other.

**Match the plugin version to your DSH core** — this repository ships **`0.13.0` only**, and it targets DSH `0.1.7-alpha.1` and up: the UI is a sidebar card, a centre-column dashboard and a settings section, built on 0.1.7's slot contracts and its `volatile` config write-back. A mismatched core fails to start DSH.

| Plugin | Required DSH core | Desktop app |
|---|---|---|
| **0.13.0 (dashboard UI)** | `0.1.7-alpha.1` and up (the plugin depends on 0.1.7's slot and settings mechanisms). **Newer prereleases (e.g. `0.1.8-alpha.x`) are NOT covered automatically** — the plugin must extend its peer range first | desktop builds bundling `0.1.7+` |

> **Do not install from npm.** The `dsh-workbuddy-connect` package on npm is the upstream author's older build (latest `0.6.3`, which requires DSH `0.1.5-rc.1`); it is a different code line from this repository's `0.13.0`, and installing it on a `0.1.7` core stops DSH from starting. Use the GitHub command below.

- **Where the cards live** (0.13.0):

  ```text
  DSH 0.1.7+ + this plugin
  ├─ Settings → Models
  │   └─ no WorkBuddy rows          ← intentional
  ├─ Settings → Built-in Plugins
  │   └─ workbuddy-connect          ← read-only inventory (runtime status), no config entry
  ├─ sidebar foot                    ✅ WorkBuddy card → opens the centre-column dashboard
  │                                    (the card itself can be switched off in Settings)
  ├─ Settings → DSH-WorkBuddy        ✅ accounts, models and sidebar page
  └─ chat model picker
      └─ WorkBuddy / WorkBuddy AI groups ✅
  ```

- The Models settings page does not show the non-editable WorkBuddy / WorkBuddy AI cards; the model picker, `/model`, and chat calls are unaffected.

The plugin runs under all three DSH interfaces: **Web**, **Desktop**, and **TUI**. Pick the install command that matches the profile you use.

```sh
# Web (recommended; the repository ships prebuilt artifacts)
dsh plugin --profile web add github:functy23/dsh-workbuddy-connect
dsh web
```

```sh
# Desktop (the DSH Desktop app)
dsh plugin --profile desktop add github:functy23/dsh-workbuddy-connect
dsh --profile desktop
```

```sh
# TUI (terminal UI)
dsh plugin --profile dsh-tui add github:functy23/dsh-workbuddy-connect
dsh --profile dsh-tui
```

> A `github:` install takes the `lib/` already built into the repository (`package.json`'s `prepack` does not run for git installs), so it builds nothing locally and needs no devDependencies.

> **TUI users, check the version pairing**: the terminal UI package (`@deepseek-harness-tui/dsh-tui`) must be **`0.10.0-beta.5` or newer** — older versions fail at startup with `events is not iterable` when this plugin is installed. Update the shell first (via its built-in update command or a fresh install), then add this plugin; the newest release is a beta, and a stable one will work the same way.

> Manual reasoning-level detection is currently available only on Web and Desktop; TUI does not provide a detection action.

> Note: the `dsh-tui` profile requires pnpm 11 to install packages (a different pnpm on PATH fails with `ERR_PNPM_UNEXPECTED_STORE` — use `npx pnpm@11`).

After installing, switch to a WorkBuddy model in the model picker of the interface you chose. On Web and Desktop, the WorkBuddy card at the bottom of the sidebar shows both products' account counts and total credit at a glance, clicking it opens the full dashboard in the centre column, and Settings → **DSH-WorkBuddy** is where you manage accounts, the model list, context length, and reasoning-level detection — including switching the sidebar card itself off. On TUI, configure `authFile` in `/settings` (or `authFileAI` for the international version).


## CLI

`dsh plugin --profile <web|desktop|dsh-tui> exec dsh-workbuddy-connect status`: sign-in state and remaining credit (`--json` for machine-readable output; `doctor` for diagnostics and `logout` for credential cleanup are also available).

`dsh plugin --profile <web|desktop|dsh-tui> exec dsh-workbuddy-connect accounts`: lists the account pool (name, origin, balance, set-aside state). It is **read-only**, and exits 0 when the pool has an account and 1 when it is empty, so scripts can branch on it. Adding, removing, and editing accounts happens in the card UI.

Both commands target the CN version by default; add `--provider workbuddy-ai` for the international one:

```sh
dsh plugin --profile web exec dsh-workbuddy-connect status --provider workbuddy-ai
dsh plugin --profile web exec dsh-workbuddy-connect doctor --provider workbuddy-ai
```

`logout` removes only that version's plugin-owned credential copy. It leaves the desktop app's own sign-in alone and does not promise the model group will disappear (the app's credential file still supplies one).

The sidebar's two display preferences (whether the card is drawn, and how it states the credit) live in DSH's own settings and have no command-line surface; they are presentation only and do not affect what these commands print.


## Known limitations

- Verified on macOS with the DSH Web / Desktop / TUI profiles (this requires DSH `0.1.7-alpha.1`+ and Node 22+; TUI requires the terminal UI package `0.10.0-beta.5` or newer — see the Install section). Windows probes Local and Roaming AppData in order; WSL first reads credentials from the mounted Windows user profile. If the Windows and Linux user names differ and Windows environment variables are not forwarded into WSL, point `WORKBUDDY_AUTH_FILE` (or `WORKBUDDY_AI_AUTH_FILE` for the international version) at the actual file.
- **The sidebar's two display preferences need a host that can write settings**: when the status document carries no `sidebarCreditVisible` / `sidebarCreditStyle`, the settings page draws no control for it — a switch that could not be saved is worse than none. With the card switched off, the dashboard's way in moves to the same settings group.
- **The international version's model catalog comes from the app's own interface**: the service splits it by User-Agent, which is a private implementation detail that a server-side change can break. When that happens the plugin degrades to this account's last successful catalog and then to its built-in roster, showing the source (live / saved / built-in), the fetch time, and the failure reason on the card — but long-term compatibility is not guaranteed. The CN version's catalog uses the same interface as the official CLI and is unaffected.
- **International-version environments not yet covered**: on Windows / WSL / Linux no reliable source for the international app's version has been located yet, so the saved value or the built-in default is used. On macOS, real-shim checks covered complete GPT-family replies, tool calls, and continued turns.
- **Behaviour change with no credentials**: a version whose app was never signed in — and that left no plugin-owned copy — no longer shows a model group. The CN version used to display a built-in fallback list, but every model on it failed when selected.
- **The enterprise credit path currently covers the CN product only**: the international enterprise billing interface is unverified, so those accounts still read through the personal endpoint pending measurement. The enterprise branch could not be tested locally (the development machine holds a personal account); it was implemented from the official app's interface contract, and reports from enterprise users are welcome.
- Relies on WorkBuddy client interfaces (not a public API); the plugin may need updates as WorkBuddy changes.


## Disclaimer

- This project is for **personal learning and research only**, driving your own WorkBuddy account on your own machine. Do not use it commercially or beyond reasonable personal use.
- Users must comply with the WorkBuddy terms of service. Any consequence of using this project (including but not limited to account restrictions, depleted credit, or service interruption) is borne by the user.
- The author is not liable for any direct or indirect loss arising from the use or misuse of this project.
- This project is not affiliated with, endorsed by, or sponsored by Tencent, WorkBuddy, or DeepSeek. Product names are used for compatibility description only; trademarks belong to their respective owners.


## Acknowledgements

- [Mars-Sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider) (MIT) — the settings page, the dashboard and the account rows are ported from its layout and styles (class prefix changed to `wbp-`).
- [franksong2702/dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect) (Apache-2.0) — reference for the DSH plugin structure and provider registration, and for the shape of the Reasoning levels control in the composer (its Fast Mode control sits in the same seat).
- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api) (MIT) — reference implementation of the WorkBuddy upstream protocol.


## License

[MIT](./LICENSE)
