# dsh-handoff

Long sessions get slower and less accurate. **dsh-handoff** turns the current
session into a durable, workspace-local handoff document, then gives a fresh
session an accurate summary and the file map it needs to continue — instead of
re-discovering the task from a 1000-step conversation.

[中文说明](README.md)

## What it does

- `/handoff` sends a handoff instruction to the current Session in the
  background; the model writes `HANDOFF.md` in a fixed 12-section format. No
  mechanical document and no `facts.json`.
- The document is the whole handoff: frontmatter records task/source/size and
  the body carries summary, state, decisions, file map, failures, verification
  and open questions.
- The Session row's **⋯** menu has **Handoff and continue**: it waits for the
  old Session's model to finish writing, then creates a new Session that reads
  only that document and replies with a ≤6-line takeover note.
- In a new session, `/handoff resume` injects a ≤2400-character resume brief
  into the next message: where the work stands, the full document path, and the
  single first action.
- At 800 steps (configurable), a non-interrupting notice suggests handing off;
  it repeats once per 200-step band and once for context pressure.
- Everything is local: documents live in `<workspace>/.dsh/handoff/<taskId>/`;
  no network, no subagent or out-of-band LLM call. A new Session is created
  only when you explicitly click **Handoff and continue**.

## Install

Requires DeepSeek Harness `0.2.1-rc.x` (the `dsh` engine must satisfy
`>=0.2.1-rc.1 <0.3.0-0`) and Node.js `^22.19.0 || >=24.0.0`.

### From a local checkout (recommended)

Open **Settings → Plugins**, install a bundle from a local directory, and point
it at this checkout. The Plugin Manager installs the package and selects it in
the profile; then restart DeepSeek Harness.

CLI alternative — installs the package but does **not** select the bundle:

```powershell
dsh plugin --profile desktop add link:D:\path\to\dsh-handoff
```

If `dsh` is not on your `PATH`, use
`<DSH install>\resources\runtime\cli\bin\dsh.cmd`. After the CLI install, select
`dsh-handoff` as a bundle in **Settings → Plugins** (or add it to
`dsh.profile.bundles` in the profile's `package.json`) and restart.

### From npm (after publishing)

```powershell
dsh plugin --profile desktop add dsh-handoff
```

Then select `dsh-handoff` as a bundle in **Settings → Plugins** and restart.

### Configuration

Override the row in your profile's `cordis.patch.yml`:

```yaml
- id: dsh-handoff
  name: dsh-handoff
  config:
    remindAfterSteps: 800
    remindEverySteps: 200
    remindAfterTokens: 120000
    handoffDir: .dsh/handoff
    retentionDays: 1
    language: zh
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `handoffDir` | `.dsh/handoff` | Workspace-relative document directory; must stay inside the workspace. |
| `remindAfterSteps` | `800` | First step count that triggers a reminder. |
| `remindEverySteps` | `200` | Reminder band interval. |
| `remindAfterTokens` | `120000` | Projected context-token reminder; `0` disables it. |
| `maxUserMessages` | `40` | Recent user messages used for task metadata. |
| `maxAssistantMessages` | `12` | Recent assistant messages used for task metadata. |
| `maxCommandLog` | `40` | Recent shell commands used for task metadata. |
| `maxErrors` | `30` | Recent failed tool calls used for task metadata. |
| `retentionDays` | `1` | Delete a task folder when its last update is older than this many days; `0` disables cleanup. |
| `resumeBriefMaxChars` | `2400` | Maximum injected resume brief length. |
| `language` | `zh` | Document language: `zh` or `en`. |

If you use another profile, replace `desktop` with its name (`dsh --profile
<name> ...`).

## Usage

### Hand off a long session

```text
/handoff
```

The command creates `<workspace>/.dsh/handoff/<taskId>/` and sends a formatted
handoff instruction to the current model. The model writes `HANDOFF.md` with
`write`; the command itself returns immediately, and the document is ready only
after that model turn finishes. Check it with:

```text
/handoff status
/handoff list
```

`/handoff update` is an explicit spelling of the same action; `/handoff --new`
starts another task line even when this session already owns one.

The document has twelve sections: 60-second summary, goal/acceptance, current
state, completed, next steps, decisions, file map, pitfalls, verification,
environment, open questions, and related sessions. The instruction requires
facts from the current Session, no invented changes, no credentials, and a
frontmatter `task_id`. `HANDOFF.md` is the only content file.

### One-click handoff (Session ⋯ menu)

Open a Session row's **⋯** menu and choose **Handoff and continue**:

1. the current Session is told to write `HANDOFF.md`;
2. the old model turn is allowed to finish (Toast shows progress, up to 4 minutes);
3. a new Session is created in the same workspace, the brief is injected, and a
   first prompt asks it to read **only HANDOFF.md** (all 12 sections) and reply
   with the 6-line takeover note.

The new Session does not modify files or run long commands yet; confirm its plan
before it starts work.

Step 3 uses `/handoff resume --latest`, so it always targets the document this
flow just wrote even when older `pending` tasks exist; a failed injection shows
a red toast instead of staying silent, and the prompt still points the new
Session at the newest document.

The injected brief is a short field block (ID / Source / Size / State /
Progress / Document / Facts / First action / Next / Rules), not a paragraph.
The automatic prompt requires exactly six reply lines:

```text
[Takeover] what I am taking over
[State] current state; call out truncated history if any
[Next] 1) … 2) … 3) …
[Key file] `path from section 6`
[Verify] `command from section 8`
[Confirm] what needs confirmation; write "none" if nothing
```

The action lives only in the three-dot menu — no extra icon on the Session
header or on the row.

### Continue in a fresh session

Open a new session in the same workspace and run:

```text
/handoff resume
```

If exactly one task is `pending`, it is used. With several, the command lists
them and asks for a task id, or `--latest` takes the most recently updated one
(this is what the one-click handoff uses):

```text
/handoff resume --latest
/handoff resume 20261029-1710-keep-history
```

The resume brief is injected with `agent.inject`, so it travels with the next
message you send; **the command does not start a turn**, and no reply appears
on its own. Send any message to let the model continue with the brief. The task
is marked `resumed` and recorded in `resume-log.jsonl`. Re-running the command
in the same session reports that it was already resumed; add `--force` to
inject again.

### Tools for the model

This version registers no `handoff_write` / `handoff_read`: the old Session
writes `HANDOFF.md` with `write`, and the new Session reads it with `read`.

### Archive

```text
/handoff archive <taskId>
```

An archived task stays on disk but is no longer a resume candidate.

### Uninstall

Remove `dsh-handoff` in **Settings → Plugins**, or:

```powershell
dsh plugin --profile desktop remove dsh-handoff
```

Then remove it from the profile's `dsh.profile.bundles` if it is still listed,
and restart. Documents under `<workspace>/.dsh/handoff/` are intentionally left
on disk; delete them yourself if you no longer want them.

## Files on disk

```text
<workspace>/.dsh/handoff/
  index.json                    workspace-wide task index (metadata, locked)
  <taskId>/
    HANDOFF.md                  the only content file (YAML frontmatter + 12 sections)
```

Legacy `facts.json`, `history/` and `resume-log.jsonl` are deleted on the next
`/handoff` command; the document no longer depends on them.

Task ids are `<YYYYMMDD-HHmm>[-ascii-slug]`; the same session reuses its task id
unless `--new` is passed. A session that resumed a task updates that same task
line when it runs `/handoff`, instead of starting a second document. Status
flows `draft` → `pending` → `resumed`, with `archived` as the terminal state.

Add `.dsh/` to `.gitignore` if you do not want handoff notes committed, or leave
it tracked if the handoff is part of the deliverable. The plugin never edits
your `.gitignore`.

**Automatic cleanup**: every `/handoff` command first deletes task folders
whose last update is older than `retentionDays` (default 1 day) and removes
their index rows. Age is based on `updatedAt`; deletion is irreversible. Set it
to `0` to disable cleanup.

**Load validation**: `/handoff resume` checks the `task_id` in HANDOFF.md
frontmatter against the indexed task. A missing document, a mismatch, or a
`draft` status refuses the injection. `--latest` uses `index.latestTaskId`
written by the producing command, so it targets exactly the task just sent
instead of guessing by timestamps.

## How it works

1. `/handoff` reads the session projections only for task metadata (title,
   steps, turns), creates the task folder, and sends the current model a
   `followup` instruction with the 12-section format.
2. The current model writes `HANDOFF.md` with `write`. The plugin does not
   render a mechanical document, does not create `facts.json`, and does not
   require a dedicated tool.
3. One-click handoff waits for that old model turn to finish, then creates the
   new Session. The new Session reads only `HANDOFF.md`, builds the brief from
   its frontmatter and body, and does not read the old Session by default.
4. `/handoff resume` injects the brief without waking the driver. The next user
   message carries it into the first model step.
5. Reminders are delivered at `agent/pre-step` or `tools/post-execute` through
   the native plugin-sourced `notice` channel; they never interrupt a tool call.

## Performance

- The plugin only sends the instruction and updates the index; its own work is
  in the millisecond range. Most of the time is the old model writing
  `HANDOFF.md`, usually tens of seconds to a minute or two.
- One-click handoff waits for that turn before opening the new Session, so the
  new Session never reads a missing or half-written document. The Toast shows
  progress during the wait.
- The new Session reads one `HANDOFF.md` and replies with a 6-line note; it does
  not start a long task.

## Safety and boundaries

- Writes are atomic (temp file + fsync + rename) and `index.json` updates are
  serialized with an `O_EXCL` lock (30 s stale-lock recovery).
- `handoffDir` must be relative and inside the workspace; symlinked path
  components are refused; `..` escapes are rejected; file-map entries outside
  the workspace are marked and never read.
- Shell commands, errors, and the brief pass through credential redaction
  (`sk-*`, `Bearer *`, `*_KEY=*`, private-key blocks).
- Apart from the explicit **Handoff and continue** click, the plugin does not
  create sessions or send messages; it does not modify session logs and does
  not replace `/compact`.
- Uninstalling the plugin leaves every document on disk.

## Known limitations

- The document is written by the old Session's model; its quality depends on
  following the template. `/handoff status` shows whether the file exists.
- The one-click action requires a Session that belongs to a workspace; blank
  Sessions do not render the menu row.
- If the model omits the frontmatter `task_id`, `/handoff resume` refuses the
  document; run `/handoff` again.

## Development

Pure ESM JavaScript, no build step, no runtime dependencies beyond the Harness
packages the loader already provides.

```powershell
npm test
```

Tests cover the pure fold, rendering, storage/locking, corruption recovery,
path safety, redaction, and cleanup.

To install a working copy:

```powershell
dsh plugin --profile desktop add link:$PWD
```

## Publishing

The remote is <https://github.com/NFdrybattery/dsh-handoff> (`origin` is already
configured):

```powershell
git push -u origin main
npm publish
```

`npm pack --dry-run` lists exactly the files that will be published
(`lib/`, `cordis.patch.yml`, locales, icon, READMEs, LICENSE, SECURITY,
CHANGELOG). The GitHub Actions workflow runs the unit tests on Node 22.19 and
24.

## Why "handoff" and not "handover"?

"Handoff" is the established term in agent and workflow tooling for passing a
task and its context to another worker (and it is shorter). The repository,
package, command, tools, projection key, data directory, and locale ids all use
the same word — `dsh-handoff`, `/handoff`, `.dsh/handoff` — so
there is one spelling to remember. Renaming later would touch the command name,
tool names, and on-disk directory, so the naming decision is recorded here.

## License

MIT. See [LICENSE](LICENSE).
