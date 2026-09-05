# Support / 支持

Need help getting LLM-Chess running, or have questions about providers, replays, or the engine? Start here — please **don't open an issue for questions**.

## Where to ask

- **Q&A / usage help** → [Discussions](https://github.com/yydsdbc/LLM-Chess/discussions) — fastest answer, searchable by others
- **Ideas / feature proposals** → [Discussions](https://github.com/yydsdbc/LLM-Chess/discussions) first; accepted ideas become tracked issues
- **Bug reports** → [Issues](https://github.com/yydsdbc/LLM-Chess/issues) with the bug template (repro steps + logs — **never paste API keys**)
- **Security vulnerabilities** → [private vulnerability reporting](../SECURITY.md) only, never public issues

## Before asking

1. Read [Troubleshooting](../README.md#troubleshooting) — it covers 401 / missing key, `REASONING_REQUIRED`, 503/504 queue waves, hot-reload scope (only `server.js` needs a restart), and `MATCH INCOMPLETE` semantics.
2. Verify Node.js 18+ and run `npm test` — all suites green means your checkout is healthy.
3. Zero-config trial: start the app and set a side to **Random AI** (gear icon) — no API key needed.

中文说明见 [README.zh-CN.md](../README.zh-CN.md)。架构与基准测试文档: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) · [docs/BENCHMARK.md](../docs/BENCHMARK.md)。
