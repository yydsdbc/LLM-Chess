# Architecture / 架构

> Contributor-facing map of LLM-chess v1.0: what each module does, how an LLM turn flows, and which invariants the test suite guards. 面向贡献者的模块地图、LLM 单手数据流与测试守护的约定。

## Overview / 总览

```mermaid
flowchart LR
    subgraph Browser [ui/ + replay/ (browser only)]
        UI[index.html + ui/app.js] -->|renders| RD[ui/renderer.js]
        UI -->|re-watch| RP[replay/replay.js + replay_controller.js]
        I18N[ui/i18n.js zh/en]
    end
    UI <-->|WebSocket/HTTP| SRV[server.js :8788]
    SRV -->|static files| UI
    SRV -->|relay: OpenAI / Anthropic protocol| LLM[16 LLM providers]
    subgraph Core [core/ + evaluation/ (browser + node)]
        ENG[core/engine.js] --> JUDGE[core/judge.js]
        EVAL[evaluation/position.js + xiangqi_knowledge.js]
        AGENT[ai/llm_agent.js + random_agent.js + committee_agent.js]
    end
    UI --> AGENT --> SRV
    AGENT --> ENG
    AGENT --> EVAL
    BENCH[benchmark/ + test/] --> ENG
```

- **core/** — the engine. Standalone-usable (perft-verified, alpha-beta friendly): `engine.js` (board state, make/unmake, repetition + perpetual-check + natural-draw clocks), `rules.js` / `generator.js` / `move.js` / `board.js` / `piece.js`, `judge.js` (move semantics: mate / stalemate / check tagging).
- **evaluation/** — static evaluation + knowledge layer. `position.js` (material, mobility, positional terms) and `xiangqi_knowledge.js` (domain heuristics). Feeds both the safety valve and the spectating evaluation bar.
- **ai/** — agents. `llm_agent.js` builds prompts, calls the relay, parses/retries/falls back; `random_agent.js` for zero-config play; `committee_agent.js` (round 29) fields several LLMs on one side — rotation or parallel council voting, per-voter states/tally in progress, merged per-voter reasoning streams.
- **server.js** — static file server + provider relay (OpenAI protocol, plus Anthropic protocol conversion). API keys never leave the server; default bind `127.0.0.1`.
- **ui/** + **replay/** — spectating HUD, decision cards, i18n (zh/en), full replay system that re-drives a saved record without calling the LLM.
- **benchmark/** + **test/** — headless matches, ELO/record tooling, and the test suites.

## LLM turn data flow / 单手数据流

1. `engine.snapshot()` → board text + legal moves (annotated: capture / mate / losing-tag).
2. `llm_agent` builds the prompt under the **cache contract** (below) and POSTs to `server.js` relay.
3. Relay forwards to the provider (OpenAI or Anthropic protocol), streams back.
4. Response JSON is parsed (full-width tolerant, fence-stripped, thinking-layer salvage); invalid → retry with backoff; final fallback → greedy safe move.
5. Code-level guards (opening cannon-capture ban, hanging-piece guard) may reject a move before it is applied; rejections are counted in `usage.blocked`.
6. `engine.applyPlayerMove()`; clocks, repetition, HUD and record update.

## Prompt cache contract / 提示词缓存契约 (do not break)

- `system` prompt is **byte-identical for the whole game** (no per-move trimming).
- Conversation grows **append-only** as (user request, assistant raw JSON) pairs; each request's prefix ⊇ the previous one.
- The retry block is always the **last** element, so a retry reuses the failed request's cached prefix.
- `HIST_CAP` (default 10 pairs) trims from the head and re-injects the task header.
- Guard: `npm run check` runs the prompt hard gate (`test/dump_prompts.js --check`: system ≤ 2400 chars, no special symbols ①②③≥≤~→⚠).

## Test map / 测试地图

| Suite | What it guards |
|---|---|
| `test/run_tests.js` | engine rules, clocks, repetition, perft, make/unmake round-trip |
| `test/test_evaluation.js` | evaluation terms + knowledge heuristics (zero-noise on start position) |
| `test/test_llm_convo.js` | prompt building, cache contract, parsing/retry/fallback, guards |
| `test/replay_smoke.js` | replay re-drive (synthesizes a record if none exists) |
| `test/_clean_reason_check.js` | thinking-stream cleaning rules |
| `test/cn_notation_check.js` | Chinese move notation (disambiguation edge cases) |
| `test/_replay_edge.js` | replay edge cases + bookmark pure logic |
| `test/_logic_layer.js` | pure logic layer guards (notation, HUD helpers) |
| `test/_server_http.js` | server.js HTTP behavior (spawns a real server: ETag/304, traversal 403, rate-limit 429, …) |
| `test/check_ui.js` | syntax sweep, ID cross-check, localStorage prefix, release files, README version parity, HTML hygiene, PWA manifest + SW guard, replay-dialog semantics |
| `npm run check` | syntax sweep of every JS file + prompt hard gate |

Run everything with `npm test` (15 suites) — CI runs `npm run check` + `npm test` on Node 18/20/22 (ubuntu) and Node 22 (windows).

## Conventions / 约定

- **Zero dependencies.** Browser modules attach to the `XQ.*` namespace and must not use `require()`; Node-only code lives in `server.js`, `tools/`, `test/`.
- Static UI files are hot-reloadable (F5); only `server.js` changes need a restart.
- Artifacts (`logs/`, `temp/`, `screenshots/`) never enter git; neither does `config/keys.json`.
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for the PR checklist and [SECURITY.md](../SECURITY.md) for the security model.
