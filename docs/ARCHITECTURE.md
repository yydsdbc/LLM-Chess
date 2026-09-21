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
| `test/_logic_layer.js` | pure logic layer guards (notation, HUD helpers), engine `legalTargets`/`dangerTargets` memo + state-version invalidation, a DOM-stub renderer hot-path guard (one `snapshot()` per render, O(1) `isOver`, arrow-SVG dedupe, sparkline signature dedupe, move-log `tabindex`, banner→`#sr-alert` announcement), a DOM-stub **i18n/glyph** block (language-switch event reaches `document`, `pieceGlyph` honours `xq_pieces`, fallback-move wording keyed off the language-neutral `fallback` flag, clock text identical from both call sites), and a `vm`-stubbed **service-worker offline-shell** guard (install-time shell precache covering every sub-resource `index.html` references, scope-relative navigation fallback, rejected cache writes swallowed), plus **L14** — the decision-card a11y label against the real dictionary (localized `aria-label`, both languages present and distinct, no raw English left in zh, no toggle rendered when there is no reasoning) — plus **L15** (the repetition counter's undo key timing and the `inCheck`/`posKey` hot-path memos, including a probe that distinguishes "passes the undone key explicitly" from "accidentally correct via the `posKey` cache") and **L16** (sw.js: a scope-relative `/api/` check that passes subpath-deployment relay calls through, and a cache write attached to the event lifetime — with a manually released `put` proving the `waitUntil` promise stays pending until the write lands) and **L17** (the end-game card's keyboard exit and its "already dismissed" flag — including the probe that renders *again* after dismissing, which is what a flag-less fix would fail — plus `role="img"` and the coordinate label on all 90 board squares, `role="button"` on move-log entries, and the last-move badge's accessible name being recomputed on a language hot-swap) |
| `test/i18n_check.js` | i18n dictionary guards, 15 groups (zh/en key parity, placeholder parity, static `data-i18n` + JS `t()` coverage, static/JS-side CJK attribute and dynamic-write-entry leaks, key existence for non-first-argument references, button-label hooks — a `data-i18n-title` no longer exempts a button's text, preference-option hooks, JS-template `data-i18n*` key existence, glyph-only button accessible names) |
| `test/link_check.js` | docs link guard — every relative link in the repo's `.md` files must resolve, and links inside `docs/` / `.github/` must start with `../` (a same-directory link resolves locally yet points at the wrong GitHub URL) |
| `test/_prompt_level_smoke.js` | prompt-tier injection (per-level constant length + prefix-cache invariance) |
| `test/replay_risk_check.js` | replay risk detector — including the lazy-fill path (jumping to a ply must produce the same risk table and the same 将/杀/困 marks as stepping there; `computeRisk` must position the engine at the position *before* the move, which is what `moveRisk` assumes) — + record quota fallback |
| `test/_committee_agent.js` | same-side multi-LLM committee (council vote, tie-break, rotation, all-fail, usage sum) |
| `test/_server_http.js` | server.js HTTP behavior, 96 checks (spawns a real server: ETag/304 + query-string form, traversal 403 incl. backslash form, rate-limit 429 + Retry-After, request-side validation 400s, OpenAI non-stream + **streaming SSE** + Anthropic protocol relay, CORS origin policy, **keys.json hot-reload + half-written tolerance**, **static-cache invalidation** (a rewritten file — even same-size — must never serve stale bytes), **upstream request construction** (per-provider headers merged without clobbering defaults, `thinking` only for GLM-family upstreams *and actually injected for them*, trailing-slash stripping plus default and per-provider `chatPath`, `stream_options` only when streaming, documented defaults), **upstream failure → 502** (that error branch was previously unasserted, so a regression would hang instead of failing fast; both protocol paths must carry ACAO), **upstream non-200 passthrough** (401/429/500 must not be rewritten to 200/502 — under streaming the error body gets parsed as SSE and surfaces as the misleading 「流式返回为空」), **non-object JSON body → 400** (a literal `null` body used to throw inside the async handler and terminate the process — one POST could remotely kill the relay), providers `name`/`baseUrl`/`models` passthrough, OPTIONS preflight header values, keys.json ENOENT tolerance, static `Cache-Control` value, …) |
| `test/check_ui.js` | syntax sweep, ID cross-check, localStorage prefix, release files, README version parity, HTML hygiene, PWA manifest + SW guard (icons/screenshots/categories), replay-dialog semantics, life-cycle generation guards, a11y/PWA source guards (`#sr-alert` announcer, `#sr-cursor` keyboard-cursor announcement, label `for=`, move-log keyboard, drag abort, end-card focus return, settings-modal shortcut gate, SW shell precache + navigation fallback + cache-write catch, piece-glyph single outlet, fallback-move detection off raw meta), and wire-up/write-point guards — static ids must be queried from `document` (a subtree query silently returns `null`), the end-card export binding, the `dataset.flip` write that the replay board and candidate-hover highlight both read, `#btn-row` invisibility (a hidden-but-focusable control), the status-clock ticker that made the exported `updateClock` reachable, Enter/Space yielding to controls that consume the key, the keyboard-cursor announcer being cleared with the cursor, the replay layer's first paint, the panel-stat single outlet, the replay-mode (`currentRecord === null`) AI gate, the end-game card's `Te`/`TAe` aliases being assigned before their first call (`var` hoists the declaration only — the ordering bug threw inside AI-vs-AI games and was swallowed by the AI-failure handler), and a display-value/timing section — replay toolbar labels must come from the dictionary and the play/pause button needs its own first paint, both full-screen overlays (Elo ladder, replay help) need dialog semantics plus one shared keyboard exit (Esc used to be swallowed by the replay layer underneath, leaving the overlay floating over the board), the repetition-counter key must be taken *before* `undoMove`, and the engine's hot-path memos must exist and be invalidated by `bumpVer`; plus an a11y/i18n/hot-path/PWA section — accessible names on the replay toolbar's symbol-only buttons, the record picker / jump box / think-panel pager, `aria-pressed` on the flip and fullscreen toggles, a live region for the provider test-connection result, the replay layer's Tab trap yielding to a higher modal (`modalAnyOpen`), focus returned to the same move after the move list is rebuilt, `th[scope]` on the committee and help tables, move-effect glyphs from the dictionary while the `杀/困/将` judgement stays on the language-neutral marker, the drag ghost's cached size, the splitter and volume slider persisting only on release, the replay range input coalesced per animation frame, sw.js's scope-relative `/api/` check plus its cache write attached to `waitUntil`, and the manifest splash colour compared against the page's **effective** `body` rule (the last `body{…}` with a background wins — reading the first match yields a superseded colour); plus a section on **one key press triggering two actions** and on **ARIA that cannot work** — the panel splitter's arrows yielding to the already-consumed key and `selfActing` recognising `role="separator"` (a splitter that does not consume Enter/Space used to let Enter play a board move for the user), the last-move badge being a real `<button>` with a live click binding and a `visibility` contract for its hidden state, `role="img"` on board squares (an `aria-label` on a role-less `div` is ignored by spec), `role="button"` on move-log entries, the end-game card's dismiss flag and its reset, the resume banner's `role="status"` inserted empty and filled afterwards, focus and expanded-state survival across the think panel's and the replay header/info panel's wholesale rebuilds, and `a[href]` in all four focus-trap selector sets; plus a section on **two entry points for one action where only one got fixed** — the end-game card's backdrop click must go through the same `dismissEndOverlay` outlet as Esc (dismissing with the mouse used to let the next render pop the card back), the replay move list needs `role="button"` and `aria-current` just like the main move log, and both protocol paths need ACAO on their upstream-failure 502; plus **a default focus target that swallows Esc** — the replay layer focuses a `<select>` on open while the global keydown early-returns on SELECT, so Esc right after opening replay did nothing; plus **banner semantics** — the `err`-mode banner raised by `window.onerror` must reach `#sr-alert`, be focusable and actually have a close binding (the binding used to live only in `errBanner`), and hiding a banner that holds focus must hand focus back to the board |
| `npm run check` | syntax sweep of every JS file + prompt hard gate |

Run everything with `npm test` (15 suites) — CI runs `npm run check` + `npm test` on Node 18/20/22/24 (ubuntu) and Node 22 (windows).

## Conventions / 约定

- **Zero dependencies.** Browser modules attach to the `XQ.*` namespace and must not use `require()`; Node-only code lives in `server.js`, `tools/`, `test/`.
- Static UI files are hot-reloadable (F5); only `server.js` changes need a restart.
- Artifacts (`logs/`, `temp/`, `screenshots/`) never enter git; neither does `config/keys.json`.
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for the PR checklist and [SECURITY.md](../SECURITY.md) for the security model.
