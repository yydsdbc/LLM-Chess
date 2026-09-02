<!-- Thanks for the PR! 中文或英文描述都可以。 -->

## What does this PR change?

<!-- One or two sentences. Reference issues with #N if any. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Prompt / evaluation quality change (ai/llm_agent.js, evaluation/)
- [ ] Refactor (no behavior change)
- [ ] Docs / CI / repo meta
- [ ] Breaking change (existing users must change config/keys or workflow)

## Checklist

- [ ] `npm test` passes (7 suites) — run `npm test` locally
- [ ] `node --check` passes for every touched `.js` file
- [ ] If you touched **ai/llm_agent.js systemPrompt**: system stays ≤ 2400 chars, no special symbols (①②③≥≤~→⚠️), and the cache contract holds (constant system + append-only history pairs + retry block last). Run `node test/dump_prompts.js --check`
- [ ] No secrets: `config/keys.json`, `logs/`, `temp/` are not committed
- [ ] Docs updated if user-facing (README.md + README.zh-CN.md)

## Screenshots (UI changes only, optional)

<!-- Drag & drop images here -->
