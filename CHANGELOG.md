# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
