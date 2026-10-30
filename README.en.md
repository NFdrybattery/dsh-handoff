# Handoff

Hand a long Session to a fresh one: the old Session's model writes `HANDOFF.md`,
and the new Session continues from that document alone.

The package is **handoff**; the command is still `/handoff`.

[Chinese](README.md)

## Features

- `/handoff` sends a handoff instruction to the current Session; the model writes
  `HANDOFF.md` in 13 sections (0–12).
- Section 12 defines the takeover reply: six Markdown list items (takeover,
  state, next, key files, verification, confirmation).
- **Handoff and continue** in the Session **⋯** menu waits for the old model,
  creates a new Session, and reads only the document. The command result is a
  collapsed card instead of a long prompt.
- `/handoff resume` injects a brief; `/handoff resume --latest --wake` also wakes
  the model from the command handler.
- Tasks expire after one day by default; documents live under
  `<workspace>/.dsh/handoff/`.

## Install

Requires DeepSeek Harness `0.2.1-rc.x` and Node.js `^22.19.0 || >=24.0.0`.

In **Settings → Plugins**, install a bundle from this local checkout, select
`handoff`, and restart. CLI alternative:

```powershell
dsh plugin --profile desktop add link:D:\path\to\dsh-handoff
```

The CLI only installs the package; still select `handoff` in
**Settings → Plugins** (or add it to the profile's `dsh.profile.bundles`) and
restart.

Uninstall:

```powershell
dsh plugin --profile desktop remove handoff
```

Documents under `<workspace>/.dsh/handoff/` are left on disk.

## Usage

### Write a handoff document

```text
/handoff
/handoff status
/handoff list
```

`/handoff` creates the task folder and sends a formatted instruction; the
document is ready only after that model turn finishes. `/handoff update` is the
same action, `/handoff --new` starts another task line.

Sections 0–11 are the handoff; section 12 is the takeover format. The
instruction requires real content in every section and facts from the current
Session.

### One-click handoff

Session list **⋯** → **Handoff and continue**:

1. the old model writes `HANDOFF.md`;
2. the turn is allowed to finish (up to 4 minutes);
3. the new Session runs `/handoff resume --latest --wake`, reads the document,
   and replies with six list items.

The first reply does not run commands or modify files.

### Resume manually

```text
/handoff resume
/handoff resume --latest
/handoff resume --latest --wake
/handoff resume <taskId>
```

- Without `--wake`: inject only; send another message to continue.
- With `--wake`: inject and start the model turn; this is the one-click path.
- With several pending tasks, use `--latest` or an explicit `taskId`.

Re-running in the same Session reports “already resumed”; add `--force` to
inject again.

### Archive

```text
/handoff archive <taskId>
```

The document stays on disk but is no longer a resume candidate.

## Configuration

Override the row in the profile's `cordis.patch.yml`:

```yaml
- id: handoff
  name: handoff
  config:
    handoffDir: .dsh/handoff
    retentionDays: 1
    language: zh
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `handoffDir` | `.dsh/handoff` | Workspace-relative directory. |
| `retentionDays` | `1` | Delete task folders not updated for this many days; `0` disables. |
| `resumeBriefMaxChars` | `2400` | Maximum injected brief length. |
| `language` | `zh` | `zh` or `en`. |
| `remindAfterSteps` | `800` | First step reminder. |
| `remindEverySteps` | `200` | Reminder band interval. |
| `remindAfterTokens` | `120000` | Context-token reminder; `0` disables. |

## Files

```text
<workspace>/.dsh/handoff/
  index.json              task index (metadata)
  <taskId>/HANDOFF.md     the only content file, sections 0–12
```

Every `/handoff` command cleans up tasks older than `retentionDays`; legacy
`facts.json`, `history/`, and `resume-log.jsonl` are removed. Status flows
`draft` → `pending` → `resumed`, with `archived` terminal.

Add `.dsh/` to `.gitignore` if handoff notes should not be committed.

## Limitations

- The document is model-written; quality depends on following the template.
  `/handoff status` shows whether the file exists.
- One-click requires a Session with a workspace; blank Sessions do not show the
  menu item.
- If frontmatter `task_id` is missing, `/handoff resume` refuses the document;
  run `/handoff` again.
- `index.json` is metadata for discovery and cleanup, not handoff content.

## Development

```powershell
npm test
```

Pure ESM, no build step. Tests cover storage, cleanup, index recovery, briefs,
instruction format, and resume selection.

Repository: <https://github.com/NFdrybattery/dsh-handoff>

## License

MIT. See [LICENSE](LICENSE).
