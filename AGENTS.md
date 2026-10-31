# AGENTS.md — LLM-Chess Handbook for AI Agents

Audience: AI agents working in this repo (OpenClaw cron / human+AI collaboration). Project: a Xiangqi (Chinese chess) LLM battle platform, public repo https://github.com/yydsdbc/LLM-Chess .
> 🀄 中文版: [AGENTS.zh-CN.md](AGENTS.zh-CN.md)

## Project at a glance

- Node.js, no build step: static frontend (`index.html` + `ui/`) + `server.js` relay (proxies LLM APIs; keys.json hot-reloaded).
- Battle core: `ai/llm_agent.js` (system prompt assembly / retry backoff / prefix cache / HIST_CAP trimming).
- Deeper architecture: `docs/ARCHITECTURE.md`; optimization history: `OPTIMIZATION_LOG.md` (**read it every round to avoid duplicate work**).

## Hard gates (violating any = wasted work)

1. **Tests**: `npm test` (parallel 27 suites, ~20s — the count tracks `test/run_all.js`) must be all green before committing; run a single suite via `node test/<name>.js`; every touched JS file passes `node --check` first.
2. **System prompt** (`ai/llm_agent.js`): ≤2400 chars, **Chinese only**, no special symbols (①②③≥≤~→emoji); prompt levels are `none`/`high` only, each level's prefix byte-stable (prefix-cache invariant). `none` keeps task + output protocol; `high` adds strategy/tactics. Legacy `low`/`mid` configs migrate to `high`; historical game metadata is preserved.
3. **Avoid touching `server.js`** (changes require the user to restart the process); if you must, run `test/check_ui.js` (syntax-level checks) **and `test/_server_http.js`** (real-server HTTP behavior gate: static sensitive paths / traversal / relay / CORS / rate limiting).
4. **PowerShell discipline**: check `$LASTEXITCODE` after every command; never end a pipeline as the last statement (PowerShell fakes exit 1).
5. **i18n**: any Chinese copy change must be mirrored in `ui/i18n.js` EN keys (guarded by `i18n_check`). UI default language is English since round 88; Chinese stays switchable.
6. **Doc links**: relative links inside `.github/` and `docs/` markdown must carry the `../` prefix (enforced by CI link_check).

## Common commands

```powershell
npm test                 # parallel 27 suites (~20s)
node test/run_tests.js   # serial chain
node server.js           # local server :8788
git push                 # direct first; on failure: git -c http.https://github.com.proxy=http://127.0.0.1:10808 push
```

## Versioning / releases

- `CHANGELOG.md` follows Keep a Changelog.
- Release flow: bump `package.json` → add the version section to CHANGELOG → commit → tag `vX.Y.Z` → push the tag (`release.yml` runs the test gate and publishes the Release automatically).
- `test/check_ui.js` guards README bilingual H1 version parity and alignment with the major.minor prefix of `package.json` (no version badge; compares `v\d+.\d+` only, patch is not checked) — when bumping versions, sync both README H1s.
- Historical versions: v1.0.2 (2026-09-05 morning), v1.0.3 (2026-09-05 evening, prompt-level tiers + CORS/rate-limit/ETag), v1.1.0 (2026-09-30, roundtable live spectating + correctness/security hardening).

## Multi-agent collaboration protocol (zcode / OpenClaw / Codex / human)

This repo is **multi-agent parallel collaboration** — several AI agents may work at different times, even simultaneously. Follow this protocol to avoid conflicts:

### Before starting (mandatory)
1. `git pull` latest main (being a few commits behind means possibly duplicating work).
2. `git log --oneline -10` for recent round numbers and topics — **next round number = latest + 1** (see the `## YYYY-MM-DD HH:mm 第N轮` tail of `OPTIMIZATION_LOG.md`).
3. `git status` — confirm no uncommitted changes from others; if any exist, coordinate or wait; never overwrite.

### Round logging
- Every round appends to `OPTIMIZATION_LOG.md`: `## YYYY-MM-DD HH:mm 第N轮 (executorID — instruction summary)`.
- Executor IDs: zcode / codex / openclaw / human name — so later agents know who did what.
- Write the LOG **before** running long tests (crash-resilience — this already saved the record 3 times).

### Parallel safety
- Before big changes `git pull` to confirm nobody works the same area; if a parallel agent landed new commits → **read what they did first**, then pick this round's direction.
- Multiple agents committing at once → the later pusher runs `git pull --rebase` first.
- Round-number collision (both wrote round N) → the later committer renumbers to N+1 and notes it in the LOG.

### Codex-specific notes
- Codex CLI reads `AGENTS.md` (this file) natively; no extra config.
- Codex sandboxes may lack proxy config → `git push` goes direct (`git -c http.https://github.com.proxy= push`); the proxy `http://127.0.0.1:10808` only exists on the host machine.
- Codex has no IAB browser → substitute GUI verification with `npm test` (includes check_ui source-string guards); note "browser verification pending human/other agent" in the report when visual acceptance is needed.
- Codex does not need `chcp 65001` (that is a Windows cmd UTF-8 setting); Git Bash / Linux shells output UTF-8 directly.
- PowerShell `$LASTEXITCODE` rules do not apply to Codex's bash environment — use `$?` / `echo "EXIT=$?"`.

## Mined-out areas (as of round 54, 2026-09-25)
Well-covered directions — new agents should not repeat them:
- a11y ×6 rounds / i18n ×6 rounds (321+ keys full bilingual coverage, I5-I9 guard network) / PWA ×3 rounds / security response headers + CSP + messages validation
- prompt ×2 specials (2384 chars, r35/r51) / engine semantic alignment (gaveCheck/undoPly snapshot stacks, r48) / relay robustness (hang/traversal/heartbeat, r46-48)
- drag-move / panel splitter / board flip / last-move arrow / roundtable / weighted Elo / fastMajority / candidate hover / merged streaming thinking
- Remaining veins: evaluation knowledge expansion / board-flip input edge cases / committee debate phase 2 / PWA offline record management / Elo trend chart

## Daily cron agent convention (llmchess-daily-optimize-report, 09:00)

- ≥6 genuinely valuable, non-duplicate optimizations (fewer but honest); read all of `OPTIMIZATION_LOG.md` first.
- Deliverables: code/doc changes + OPTIMIZATION_LOG round entry + commit + best-effort push + plain text report (GitHub stats + 10 optimizations + test/push status).
- Trigger payload and report format: see the OpenClaw automations task `llmchess-daily-optimize-report`.
