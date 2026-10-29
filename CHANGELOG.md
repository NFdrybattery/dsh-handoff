# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-10-29

### Added

- `/handoff resume --latest`: resolve several `pending` tasks to the most
  recently updated one instead of failing on ambiguity. The ambiguity error now
  mentions the flag.

### Fixed

- `package.json` no longer starts with a UTF-8 BOM. The 0.2.1 version bump was
  written by a tool that added one, and the host reads a bundle manifest with
  `JSON.parse(readFileSync(file, "utf8"))`, so the plugin row was refused at
  composition time and the plugin manager showed **包不可用 / Package
  unavailable**. `test/manifest.test.js` now asserts the manifest is BOM-free,
  parses, and that its declared bundle patch and client entries exist.

- **Handoff and continue** now loads the brief it just wrote. The one-click flow
  ran a plain `/handoff resume`, which fails with "several pending tasks" as
  soon as an older task line exists — in this workspace that was the very first
  time it ran, so the new Session received only the prompt. It now runs
  `/handoff resume --latest` and reports a failed injection in a toast instead
  of swallowing it.
- The one-click flow's first `/handoff` no longer ignores a command error: a
  non-success outcome aborts the flow with the command's message.

### Changed

- The Chinese README no longer repeats two "known limitations" bullets.

## [0.2.0] - 2026-10-29

### Added

- **Handoff and continue** entry in each Session's `⋯` menu: writes the current
  Session's handoff, creates a new Session in the same workspace, injects the
  resume brief, and sends the first prompt automatically. The action lives only
  in the three-dot menu; the Session header and row keep their shipped icons.
- Fast, model-free handoff: `/handoff` now writes a complete mechanical
  document and marks it `pending` immediately (about 0.1s instead of waiting
  for a ~100s model turn).
- `/handoff --narrative` opt-in for the old model-written narrative path.

### Changed

- The default handoff is the mechanical document; `handoff_write` remains
  available for optional enrichment.

### Fixed

- `/handoff` and the threshold reminders now read the session-projection
  registry through `ctx.get('sessionProjections')` instead of a plain
  `ctx.sessionProjections` property read. A Cordis context rejects the latter
  for services the plugin did not inject (`cannot get property … without
  inject`), so every projection read degraded to `undefined` and `facts.json`
  listed `sessionStats`, `contextPressure`, `todos`, `goal` and `title` as
  unavailable.
- `facts.json` now derives `pressureTokens` the same way the shipped
  `contextPressure` wire view does (prompt-side sample plus surface movement)
  instead of falling back to the raw prompt-side figure, because the host
  projection state carries no `projectedTokens`.
- `/handoff resume` in a session that already resumed a task now reports that
  fact instead of failing on an unrelated `draft` row; running it again no
  longer looks like a broken command.
- `/handoff` run from a session that resumed a task now updates that same task
  line instead of starting a second document, so the resume brief's
  "完成一个阶段后用 /handoff 更新文档" actually works in the continued session.
  Task lookup matches `sourceSessionId` or a `resumedBy` entry.
- `handoff_write` keeps the task's original `createdAt` when it updates an
  existing document, instead of adopting `facts.generatedAt` (the facts
  snapshot time). Task age and ids no longer jump on every document write.
- The resume brief no longer renders `undefined` for the progress label, and
  the success text explains that the brief lands on the next user message
  rather than starting a turn by itself.

## [0.1.0] - 2026-10-29

### Added

- `/handoff` command family: write/update, status, list, resume, archive and
  `--new`.
- `handoff_write` and `handoff_read` model tools.
- Host-only `handoffFacts` session projection: turns, steps, user/assistant
  text, tool calls, write/edit paths, shell commands, failures, and
  workspace-change turns, with bounded lists and truncation flags.
- `facts.json` assembled from the plugin fold plus the shipped `sessionStats`,
  `contextPressure`, `todos`, `goal`, `plan`, and `title` projections.
- Mechanical `HANDOFF.md` skeleton and a twelve-section final document.
- Resume brief injection through `agent.inject` (≤2400 characters by default),
  re-injection with `--force`, `resumedBy`/`resumedAt`, and
  `resume-log.jsonl`.
- Step-band and context-pressure reminders at `agent/pre-step` and
  `tools/post-execute`, one per band.
- Workspace-confined storage with atomic writes, an `O_EXCL` index lock, stale
  lock recovery, corruption backup/rebuild, per-task history, path escape and
  symlink refusal.
- Credential redaction for commands, errors, and the resume brief.
- Unit tests for the fold, rendering, storage/locking/history, corruption
  recovery, path safety, and redaction.
