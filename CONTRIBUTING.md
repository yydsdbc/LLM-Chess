# Contributing to LLM-chess

Thanks for your interest! LLM-chess is a **zero-dependency** Node.js project — no `npm install`, no build step. Pull requests are welcome.

## Quick start

```bash
git clone https://github.com/yydsdbc/LLM-Chess.git
cd LLM-Chess
npm start    # http://localhost:8788
npm test     # 9 test suites, all must pass
```

Zero-config trial: start the app, open settings (gear icon), set a side to **Random AI**. No API key needed.

## Project rules

- **Zero runtime dependencies.** Node stdlib + browser APIs only. Don't add packages to `package.json` without discussing first.
- **Dual-environment modules.** `core/`, `evaluation/`, `replay/replay.js`, `benchmark/record.js`, `ai/`, `ui/` are loaded as browser `<script>`s and reused in Node tests — no `require`/`import`/`export`; attach to the `XQ.*` namespace.
- **`server.js` is the only Node-side file** (static hosting + `/api/chat` key relay). Keep it dependency-free.
- **Never commit `config/keys.json`.** It holds real API keys and is gitignored. `config/keys.example.json` is the template reference. Never paste keys into issues/PRs/logs.

## Prompt-system contract (if you touch `ai/llm_agent.js`)

The LLM request structure is cache-optimized — please preserve it:

- `system` prompt stays **constant** for the whole game (≤2400 chars, simplified Chinese, no special symbols like ①②③≤≥→).
- History is appended as raw (user, assistant) pairs — request N+1's prefix ⊇ request N's (prefix-cache friendly). Retry prompts go **last**.
- `HIST_CAP` bounds history; guards (opening protection, hanging-piece marks) run before the request.

## Before you open a PR

1. `npm test` — all suites green (engine perft gold-standard, evaluation, LLM-conversation guards, replay smoke, notation, UI checks).
2. `node --check` any JS file you touched.
3. Update `README.md` / `README.zh-CN.md` if behavior or usage changed.
4. One logical change per PR; short imperative commit subject (e.g. `replay: remember last speed`).

## Cutting a release (maintainer runbook)

1. Move the Unreleased items in `CHANGELOG.md` under a new version heading; bump `version` in `package.json` (README h1 keeps the `v1.0` brand — a guard test enforces prefix consistency).
2. Commit, tag, push: `git tag v1.0.x && git push origin main --tags`.
3. [`release.yml`](.github/workflows/release.yml) runs `npm test` as a gate and publishes the GitHub Release with auto-generated notes.

## Docs map

- Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Benchmarks & headless matches: [docs/BENCHMARK.md](docs/BENCHMARK.md)
- Support triage: [.github/SUPPORT.md](.github/SUPPORT.md)

## Filing issues

Use the issue templates (bug / feature). Steps to reproduce + logs (never keys) get fixed fastest.

## Dev log

`OPTIMIZATION_LOG.md` records every optimization round — feel free to add an entry describing your change; it helps future contributors avoid rework.
