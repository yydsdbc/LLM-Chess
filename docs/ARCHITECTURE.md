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
- **ai/** — agents. `llm_agent.js` builds prompts, calls the relay, parses/retries/falls back; `random_agent.js` for zero-config play; `committee_agent.js` (round 29) fields several LLMs on one side — rotation or parallel council voting with voter budgets, safety veto, per-voter states/tally in progress, merged per-voter reasoning streams, Elo-weighted tallies (round 36). The external abort signal may be passed as an **object or a getter function** (round 39) so a game-scoped controller can be swapped without re-creating agents.
- **server.js** — static file server + provider relay (OpenAI protocol, plus Anthropic protocol conversion). API keys never leave the server; default bind `127.0.0.1`.
- **ui/** + **replay/** — spectating HUD, decision cards, i18n (zh/en), full replay system that re-drives a saved record without calling the LLM. Board flip (black perspective, round 34), drag-move (round 33), keyboard travel + resizable think panels, undo (U), auto-save + resume, PGN import/export, backup/restore, Elo ladder (rounds 30–36).
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
| `test/_logic_layer.js` | pure logic layer guards (notation, HUD helpers), engine `legalTargets`/`dangerTargets` memo + state-version invalidation, a DOM-stub renderer hot-path guard (one `snapshot()` per render, O(1) `isOver`, arrow-SVG dedupe, sparkline signature dedupe, move-log `tabindex`, banner→`#sr-alert` announcement), a DOM-stub **i18n/glyph** block (language-switch event reaches `document`, `pieceGlyph` honours `xq_pieces`, fallback-move wording keyed off the language-neutral `fallback` flag, clock text identical from both call sites), and a `vm`-stubbed **service-worker offline-shell** guard (install-time shell precache covering every sub-resource `index.html` references, scope-relative navigation fallback, rejected cache writes swallowed), plus **L14** — the decision-card a11y label against the real dictionary (localized `aria-label`, both languages present and distinct, no raw English left in zh, no toggle rendered when there is no reasoning) |
| `test/i18n_check.js` | i18n dictionary guards, 13 groups (zh/en key parity, placeholder parity, static `data-i18n` + JS `t()` coverage, static/JS-side CJK attribute and dynamic-write-entry leaks, key existence for non-first-argument references, button-label hooks — a `data-i18n-title` no longer exempts a button's text, preference-option hooks) |
| `test/link_check.js` | docs link guard — every relative link in the repo's `.md` files must resolve |
| `test/_prompt_level_smoke.js` | prompt-tier injection (per-level constant length + prefix-cache invariance) |
| `test/replay_risk_check.js` | replay risk detector + record quota fallback |
| `test/_committee_agent.js` | same-side multi-LLM committee (council vote, tie-break, rotation, all-fail, usage sum) |
| `test/_server_http.js` | server.js HTTP behavior, 73 checks (spawns a real server: ETag/304 + query-string form, traversal 403 incl. backslash form, rate-limit 429 + Retry-After, request-side validation 400s, OpenAI non-stream + **streaming SSE** + Anthropic protocol relay, CORS origin policy, **keys.json hot-reload + half-written tolerance**, **static-cache invalidation** (a rewritten file — even same-size — must never serve stale bytes), **upstream request construction** (per-provider headers merged without clobbering defaults, `thinking` only for GLM-family upstreams, `stream_options` only when streaming, documented defaults), …) |
| `test/check_ui.js` | syntax sweep, ID cross-check, localStorage prefix, release files, README version parity, HTML hygiene, PWA manifest + SW guard (icons/screenshots/categories), replay-dialog semantics, life-cycle generation guards, a11y/PWA source guards (`#sr-alert` announcer, `#sr-cursor` keyboard-cursor announcement, label `for=`, move-log keyboard, drag abort, end-card focus return, settings-modal shortcut gate, SW shell precache + navigation fallback + cache-write catch, piece-glyph single outlet, fallback-move detection off raw meta), and wire-up/write-point guards — static ids must be queried from `document` (a subtree query silently returns `null`), the end-card export binding, the `dataset.flip` write that the replay board and candidate-hover highlight both read, `#btn-row` invisibility (a hidden-but-focusable control), the status-clock ticker that made the exported `updateClock` reachable, Enter/Space yielding to controls that consume the key, the keyboard-cursor announcer being cleared with the cursor, the replay layer's first paint, the panel-stat single outlet, the replay-mode (`currentRecord === null`) AI gate, the end-game card's `Te`/`TAe` aliases being assigned before their first call (`var` hoists the declaration only — the ordering bug threw inside AI-vs-AI games and was swallowed by the AI-failure handler), and a display-value/timing section — replay toolbar labels must come from the dictionary and the play/pause button needs its own first paint, both full-screen overlays (Elo ladder, replay help) need dialog semantics plus one shared keyboard exit (Esc used to be swallowed by the replay layer underneath, leaving the overlay floating over the board), the repetition-counter key must be taken *before* `undoMove`, and the engine's hot-path memos must exist and be invalidated by `bumpVer` |
| `npm run check` | syntax sweep of every JS file + prompt hard gate |

Run everything with `npm test` (15 suites) — CI runs `npm run check` + `npm test` on Node 18/20/22/24 (ubuntu) and Node 22 (windows).

## Conventions / 约定

- **Zero dependencies.** Browser modules attach to the `XQ.*` namespace and must not use `require()`; Node-only code lives in `server.js`, `tools/`, `test/`.
- Static UI files are hot-reloadable (F5); only `server.js` changes need a restart.
- Artifacts (`logs/`, `temp/`, `screenshots/`) never enter git; neither does `config/keys.json`.
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for the PR checklist and [SECURITY.md](../SECURITY.md) for the security model.
