# Security

## Reporting a vulnerability

Open a private security advisory on the repository, or contact the maintainer
listed in `package.json` once a repository is configured. Please do not publish
an exploit before a fix is available.

## Design boundaries

- The plugin writes only under the configured handoff directory
  (`<workspace>/.dsh/handoff/` by default).
- `handoffDir` must be relative and inside the workspace. Absolute paths,
  `..` segments, and symlinked path components are rejected.
- File-map entries that escape the workspace are marked and never read.
- `index.json` is written atomically and guarded by an `O_EXCL` lock.
- Shell commands, error summaries, and the resume brief pass through pattern
  redaction for `sk-*`, `Bearer *`, `*_KEY=*`/`*TOKEN=*`, and private-key
  blocks. Redaction is best-effort; the plugin also instructs the model not to
  write credentials into any field.
- Documents are plain files in the workspace. If the workspace is a Git
  repository, decide deliberately whether `.dsh/` should be committed; the
  plugin never changes `.gitignore`.
- The plugin performs no network calls and starts no extra model requests. The
  only follow-up it queues is a user-approval-visible message in the current
  session after `/handoff`.

## Supported versions

Security fixes target the current `0.1.x` line and the DSH engine range
`>=0.2.1-rc.1 <0.3.0-0`.
