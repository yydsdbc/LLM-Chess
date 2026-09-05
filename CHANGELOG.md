# Changelog

All notable user-visible changes to LLM-Chess are documented here. 逐轮细节（每轮 10 项级）见 [OPTIMIZATION_LOG.md](OPTIMIZATION_LOG.md) — 本文件只记里程碑。

Format based on Keep a Changelog; versions follow SemVer.

## [Unreleased]

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
