# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `/handoff resume` in a session that already resumed a task now reports that
  fact instead of failing on an unrelated `draft` row; running it again no
  longer looks like a broken command.
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
