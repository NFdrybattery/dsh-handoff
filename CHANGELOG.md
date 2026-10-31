# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.2] - 2026-10-31

### Fixed

- Mark every Config field `.volatile()`. The Host Settings service only
  projects a form for a plugin whose Config contains a volatile field; without
  that metadata the settings page received no namespace and showed the red
  "no settings entry" error. Also unwrap volatile `{ get() }` refs in the Host
  and client resolvers.

### Changed

- Icon refinement: increase the vertical offset of the second document, use a
  white rounded right-angle arrow that stops before the frame, and simplify the
  two-document menu icon.

## [0.8.1] - 2026-10-31

### Changed

- The takeover prompt now asks for a full document read and project-file review,
  without emphasizing the recent-rounds section; the old Session may be read
  when necessary.
- Redesign the plugin icon as an indigo tile with two documents and a right-angle
  arrow, and simplify the ⋯ menu icon to the same two-document elbow-arrow form
  for legibility at 14px.

## [0.8.0] - 2026-10-31

### Changed

- Replace section 12's takeover reply template with a recent-rounds section:
  the last N user inputs and assistant outputs in UI order.
- Add `recentRounds` (default 5, 0 disables the section) to config, the settings
  page, and the handoff instruction. The plugin passes the extracted rounds to
  the old model, which writes them into section 12.
- The wake/fallback prompt now asks the new Session to read the document and
  project files, then give a concise summary of the earlier work and next steps;
  the fixed six-item reply format is gone.

### Fixed

- The Settings page now finds the Host settings namespace by either the patch
  id or the `include:` entry id, and the profile has a real config row.

## [0.7.1] - 2026-10-30

### Fixed

- Give the bundle patch an empty `config: {}` so the Host settings API exposes
  a namespace for the new Settings page. Accept either the patch id or the
  `include:` entry id when reading/mutating it.

### Changed

- Remove `handoffDir` from both the plugin config and the Settings page. The
  document directory is fixed at `.dsh/dsh-handoff`.

## [0.7.0] - 2026-10-30

### Added

- A Settings → Handoff section for `handoffDir`, reminder thresholds,
  `retentionDays`, `resumeBriefMaxChars`, and `language`. Values are read and
  written through the Host settings API; the page shows read-only and missing
  states. `enabled` stays outside the page because disabling the plugin removes
  the page itself.

## [0.6.6] - 2026-10-30

### Changed

- Remove the custom locale `meta.title`; the plugin list now uses the package
  name `dsh-handoff` as its display name. Descriptions stay localized.

## [0.6.5] - 2026-10-30

### Removed

- Remove the unused `maxUserMessages`, `maxAssistantMessages`, `maxCommandLog`,
  and `maxErrors` config keys. They only shaped internal fact arrays that the
  current model-written handoff flow never reads.

## [0.6.4] - 2026-10-30

### Changed

- The default storage directory is now `.dsh/dsh-handoff` (previously
  `.dsh/handoff`). On first use of the default, an existing `.dsh/handoff`
  directory is renamed to `.dsh/dsh-handoff` so existing documents remain
  available.

## [0.6.3] - 2026-10-30

### Changed

- Rename the plugin/package to `dsh-handoff`; the `/handoff` command, storage
  directory, and document format stay unchanged.

## [0.6.2] - 2026-10-30

### Fixed

- The injected resume brief no longer tells the new Session to read the removed
  `facts.json`; it now explicitly says to read `HANDOFF.md` completely, including
  section 12.

## [0.6.1] - 2026-10-30

### Changed

- Rename the plugin/package back to `handoff`; the `/handoff` command, storage
  directory, and document format stay unchanged.

## [0.6.0] - 2026-10-30

### Changed

- Rename the plugin/package to `handover`; the `/handoff` command, storage
  directory, and document format stay unchanged.
- Simplify both READMEs to install, usage, configuration, storage, limitations,
  and development; remove performance notes, historical migration details, and
  the naming essay.

## [0.5.0] - 2026-10-29

### Added

- `HANDOFF.md` now includes section 12, the takeover reply format. The
  document carries the six-list-item template, so the new Session can read the
  format from the document instead of a long prompt.
- `/handoff resume --wake` injects the brief and starts the model turn from the
  command handler. One-click handoff uses it, so the first visible input is the
  collapsed command result rather than a long user prompt; a short fallback
  prompt is used only if waking fails.

## [0.4.2] - 2026-10-29

### Fixed

- The takeover reply is now specified as six Markdown list items (`- 【接手】…`),
  one per line. The previous six bare label lines were collapsed into one
  paragraph by the chat renderer because Markdown treats single newlines as
  spaces.

## [0.4.1] - 2026-10-29

### Changed

- The handoff instruction now specifies concrete content for every one of the
  12 sections (evidence, file map table, failed attempts, executable
  verification commands, environment values) instead of only listing headings.
- The new-Session prompt now specifies what each of the six reply lines must
  contain: task identity, state/branch/test baseline, concrete next actions,
  up to two key files, command plus expected result, and confirmation
  questions. Missing/incomplete documents must be reported in the reply.

## [0.4.0] - 2026-10-29

### Changed

- `/handoff` no longer renders a mechanical document. It creates the task
  folder and sends the current model a formatted handoff instruction; the model
  writes the single `HANDOFF.md` with the `write` tool.
- The document is now the only per-task content file. `facts.json`, `history/`
  and `resume-log.jsonl` are no longer written and are removed on the next
  command. The index remains as metadata.
- The new Session reads only `HANDOFF.md`; it does not read a facts file by
  default and is told to consult the old Session only when the document is
  insufficient.
- One-click handoff waits for the old model turn to finish before creating the
  new Session, so the document is complete when the new Session reads it.
- `handoff_write` / `handoff_read` are no longer registered.

### Fixed

- The new Session can no longer start against a missing or half-written handoff
  document.

## [0.3.1] - 2026-10-29

### Changed

- Resume brief is now a compact field block (ID / source / size / state /
  progress / document / facts / first action / next / rules) with long status
  and next-step text truncated, instead of a long paragraph.
- The one-click prompt now asks for exactly six labelled lines — `【接手】`,
  `【状态】`, `【下一步】`, `【关键文件】`, `【验证】`, `【待确认】` — and tells
  the model to replace the placeholders instead of adding prose.

## [0.3.0] - 2026-10-29

### Added

- `retentionDays` (default `1`): every `/handoff` command removes task folders
  and index rows whose last update is older than the configured number of days.
  `0` disables cleanup; deletion is irreversible. Orphan task folders are
  removed too.
- Handoff loading now validates identity before injecting a brief: the index
  row's `docPath`/`factsPath`, HANDOFF.md's `task_id`, and facts.json's
  `taskId` must all match the selected task. A mismatch refuses the resume.
- `index.latestTaskId` records the exact task the producing command wrote;
  `/handoff resume --latest` targets it instead of guessing from timestamps.

### Fixed

- A resume can no longer load a document from a different task line when the
  workspace has several pending handoffs or when a document is stale/corrupt.

## [0.2.3] - 2026-10-29

### Changed

- The one-click takeover now requires the new Session to read the complete
  `HANDOFF.md` (all 12 sections) and the complete `facts.json` before replying.
  The 0.2.2 prompt read only sections 0/2/4 and skipped facts.json, which was
  fast but too lossy for accurate continuation. The reply is still capped at
  six lines and still does not execute anything before confirmation.

## [0.2.2] - 2026-10-29

### Changed

- One-click handoff now asks the new Session for a ≤6-line takeover note and
  next steps instead of executing the task immediately. The earlier long run
  was the model starting an 18-minute repair task, not the handoff itself
  (measured 37ms); the new prompt also reads only sections 0/2/4 when no brief
  is available.

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
- `/handoff` argument parsing moved to `lib/argv.js` and is covered by tests,
  including `--latest` and the client's resume wiring.

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
