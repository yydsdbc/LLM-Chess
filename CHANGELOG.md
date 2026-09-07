# Changelog

All notable user-visible changes to LLM-Chess are documented here. 逐轮细节（每轮 10 项级）见 [OPTIMIZATION_LOG.md](OPTIMIZATION_LOG.md) — 本文件只记里程碑。

Format based on Keep a Changelog; versions follow SemVer.

## [Unreleased]

### Changed
- Docs refreshed to the v1.0.3 prompt-level tiers (README EN/ZH) — removed stale play-style references
- `prompts_dump.md` regenerated from the live agent (tier system); `npm run check` now guards dump freshness (drift = fail)
- Docker image: OCI labels; `test/` no longer baked into the runtime image
- CI matrix: Node 24 added

### Added
- **Round-24 batch** (2026-09-08, 10 items): PWA round 2 — root `sw.js` network-first offline shell (`/api/*` never cached; offline or with the server stopped, the shell still works for Random-AI play) + `check_ui` SW guard; a11y round 3 — end-game card gets `role=dialog` with focus moved onto its primary button on show, settings overlay gets a real Tab focus trap (matching its `aria-modal`), collapsible think-panel headers and the think pager become keyboard-operable (`tabindex`/`role=button`/`aria-expanded`; pager spans became real buttons); server behavior suite extended 11→17 assertions (providers shape + **no apiKey leak**, HEAD+ETag, manifest/icon MIME, GET `/api/chat` method guard); `i18n_check` I8 attribute guard (CJK in `title`/`aria-label`/`placeholder` must carry a `data-i18n*` marker) + two tooltip keys fixed (the `nav_replay`/`btn_fullscreen` glyph keys were erasing the descriptive tooltips); favicon unified to the branded 弈 SVG icon; board-cell click handlers now bind once per pooled cell instead of 90 closures per render
- **Round-23 batch** (2026-09-07, 10 items): PWA installable (manifest.json + SVG icon + theme-color — server untouched, `application/json` MIME reused); new `test/_server_http.js` suite — server.js HTTP behavior (spawns a real server: ETag/304, path-traversal 403, rate-limit 429, …) — npm test is now **12 suites**; a11y round 2 (settings card is a real `role=dialog` with focus return to the gear, sound toggle `aria-pressed`, hidden overlays no longer Tab-focusable via `visibility`); renderer keeps the 90 board cells persistent (no full teardown per keystroke/move); i18n static-text gap guard (`i18n_check` I7) + 6 missed `data-i18n` hooks; suite-count docs re-aligned (README EN/ZH badges + trees, AGENTS.md, ARCHITECTURE.md, stale `test:serial` chain)
- **Round-19 hardening batch** (2026-09-06, 30+ items): replay bookmarks now support `N`/`P` jump navigation; per-game delete (🗑) in replay; replay board scales on small screens (`--cell`); gameId generation guard stops stale AI callbacks from leaking into a restarted game; end-of-game chime; new `test/_logic_layer.js` suite — npm test is now **11 suites**
- **Round-22 settings-panel text fix + guard**: 4 stray PowerShell escape artifacts (`n) in the settings panel (introduced in round 16) removed; `check_ui.js` now scans the HTML for escape leftovers / double-escaped entities — a blind spot where static text had no guard
- **Round-21 HUD detail polish** (2026-09-06, 16 items, pure CSS, zero new DOM): decision-card mono headers + eval pill + quote-style reasoning + hairline dividers, calmer thinking-card pulse, unified scrollbars, badge inner highlights, win/draw status gradients with glow, tabular-num status clock, move-log active highlight + time chips, cyan selection ring + target glows, last-move outline markers, idle-text centering
- **Round-20 HUD visual polish** (2026-09-06, 14 items, pure CSS + one SVG decoration — zero new DOM elements): unified panel glass surfaces with side-accent headers, calmer thinking breath, decision-card gradient/hover, candidate-move chips, last-move badge slide-in, captured-tray depth, zebra-striped move log, status-bar thinking sheen, softer check pulse, refined endgame card, sparkline gradient area fill
- `AGENTS.md` — AI-agent operating guide (hard test gates, release flow, cron conventions)
- **Mobile board scaling**: the 432px fixed board shrinks proportionally under 460px viewports (`--cell` CSS variable drives cells, pieces, labels; SVG lines scale via viewBox)
- **Keyboard play (a11y)**: arrow keys move a board cursor, Enter/Space selects & moves, Esc cancels — the board is playable without a mouse
- **Replay bookmarks**: `B` tags/untags the current ply, 🔖 shows in the move list, persisted per game in localStorage
- **Screen-reader move announcements** (`#sr-move` aria-live region, Chinese notation)
- New test suite `test/_replay_edge.js` (replay edge cases + bookmark pure logic) — npm test is now 10 suites

### Changed
- **Error banners**: 402 / insufficient-balance provider errors now show a dedicated top-up message (i18n, ZH/EN)
- **move-log DOM cap**: entries beyond 150 are folded into a "N earlier moves" line (long-game DOM growth bounded; full game still replayable/exportable)
- Keyboard-shortcut help and i18n dictionaries updated for all new keys (zh/en parity guarded)

### Fixed
- **i18n `init()` was never called** — users with saved `en` saw a full Chinese first paint and `<html lang>` stayed zh-CN until they toggled the language (caught by round-23 live acceptance)
- Six static texts missed `data-i18n` (keys note, play-again, watch-replay, fullscreen, save, load) — now localized in both languages
- Keyboard: Enter/Space no longer swallow native button activation when no keyboard cursor is active (round-18 regression caught in review)
- Move-log: folded-moves counter resets on new game (stale "N earlier moves" count after restart)

## [1.0.3] - 2026-09-05

### Added (2026-09-05, rounds 5-16)
- **Parallel test runner** (`test/run_all.js`): 9 suites in parallel — `npm test` 33.5s → 19s; serial chain kept as `npm run test:serial`; 5-min global timeout
- **Prompt-level tiers replace play-styles**: settings dropdown now None/Low/Mid/High — controls how much style guidance is injected into the LLM system prompt (legacy aggressive/balanced/defensive archives display via fallback map); system prompt stays constant per tier (prefix-cache invariant kept); tier badges (grey/blue/green/gold)
- **Rate limit** on `/api/chat` (30 req/min per IP, in-memory sliding window) — protects keys from runaway loops / malicious local pages
- **CORS hardening**: same-origin echo instead of `*` (blocks third-party web pages from driving the relay with the user's browser)
- **ETag/304** for static files (`Cache-Control: no-cache` + sha1 ETag) — mid-game F5 reloads are near-instant
- **keys.json mtime cache** in the relay (hot-reload semantics preserved; no disk read + JSON.parse per request; editor half-write tolerance)
- **`/api/health` now reports the real package version** (was hardcoded `3.6`)
- `docs/BENCHMARK.md`: rate-limit note for parallel headless matches

_Nothing yet._

## [1.0.2] - 2026-09-05

### Added (2026-09-04, daily round)
- `CHANGELOG.md` — milestone history (this file)
- `docker-compose.yml` — one-command Docker deployment (`docker compose up -d`, keys persist in `./config`)
- `test/i18n_check.js` — i18n CI guard: zh/en key parity, placeholder parity, `data-i18n` / `t()` coverage (8th test suite)
- PR auto-labeler (`.github/labeler.yml` + workflow, labels auto-provisioned)
- `.devcontainer/` — one-click contributor environment (Node 22 + test gate)
- `docs/BENCHMARK.md` — headless match / blunder analysis guide
- README Roadmap (EN + zh), `.github/FUNDING.yml` (GitHub Sponsors)
- CI minimal `permissions: contents: read` hardening
- a11y: status bar is now a screen-reader live region (turn / check / result announcements)

### Added (2026-09-05, daily round)
- **Release v1.0.2** — first cut of the tag-driven release automation (`release.yml`: npm test gate → GitHub Release with generated notes)
- `test/link_check.js` — docs link guard (9th test suite): every relative link in all `.md` files must resolve to a real file
- `.github/workflows/stale.yml` — stale bot: 30d inactive → `stale` label, +14d → auto-close (pinned/security/assigned exempt)
- `.github/SUPPORT.md` — support triage: Discussions first + pre-asking checklist
- `.github/CODEOWNERS` + npm `funding` — auto review requests; `npm fund` points to GitHub Sponsors
- CI concurrency cancel — superseded runs on the same ref stop early
- `docker-compose.yml` healthcheck — `/api/health` probe (busybox wget, matches Dockerfile HEALTHCHECK)
- CONTRIBUTING — "Cutting a release" runbook + docs map (ARCHITECTURE / BENCHMARK / SUPPORT)
- Release-file guard extended 4 → 6 (`CHANGELOG.md`, `SUPPORT.md`)

## [1.0.1] - 2026-08-31

### Added
- UI i18n: English/Chinese switch (settings panel dropdown, persisted in `localStorage`, covers all static UI text via `data-i18n`).

## [1.0.0] - 2026-08-31

### Added
- First public release (tag `v1.0`):
  - **Engine**: perft gold standard 44/1920/79666; Asian-rule closures in code — perpetual check loses, threefold repetition draw, 60-round natural draw.
  - **Live spectating**: decision-card stream, play styles per side, HUD dashboard (captured tray / Chinese notation / eval sparkline / endgame card), cyber dark-gold theme.
  - **Replay**: re-drive saved games without calling the LLM; 7 speeds, seek, eval charts, PGN export.
  - **LLM quality**: prefix caching (62–84% measured hit), hanging-piece guard, fallback safety valve, opening protection, 16 providers + native Anthropic relay.
  - **Community base**: CI (Node 18/20/22 + Windows), Issue/PR templates, CONTRIBUTING / CODE_OF_CONDUCT / SECURITY, Dockerfile + Render one-click deploy, MIT license.

### History
- 40+ pre-release dev rounds (HUD / replay / prompt engineering / engine rules) live in [OPTIMIZATION_LOG.md](OPTIMIZATION_LOG.md).
