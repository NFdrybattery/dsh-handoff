/**
 * Workspace storage for handoff documents.
 *
 * Layout (relative to the workspace root, configurable but always confined
 * to that root):
 *
 *   .dsh/handoff/index.json
 *   .dsh/handoff/<taskId>/HANDOFF.md
 *   .dsh/handoff/<taskId>/facts.json
 *   .dsh/handoff/<taskId>/history/<stamp>.md
 *   .dsh/handoff/<taskId>/resume-log.jsonl
 *
 * Writes are atomic (temp file + rename), the index is guarded by an
 * O_EXCL lock, and every path is checked to stay inside the workspace.
 */

import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isoLocal, slugify, stampCompact, stampFile, isInside } from './util.js'

export const INDEX_SCHEMA_VERSION = 1
const LOCK_RETRY_MS = 50
const LOCK_ATTEMPTS = 40
const STALE_LOCK_MS = 30_000

/** A user-facing storage failure (bad path, escaping directory, corrupt lock). */
export class HandoffStoreError extends Error {
  constructor(message, code = 'HANDOFF_STORE') {
    super(message)
    this.name = 'HandoffStoreError'
    this.code = code
  }
}

/**
 * Validate a configured handoff directory and resolve it against the
 * workspace. Rejects absolute paths, drive-qualified paths, empty values and
 * any escape out of the workspace.
 */
export function resolveHandoffDir(cwd, handoffDir) {
  if (typeof cwd !== 'string' || cwd.length === 0 || !isAbsolute(cwd)) {
    throw new HandoffStoreError('workspace directory is unknown (the session has no absolute cwd)', 'NO_WORKSPACE')
  }
  const configured = typeof handoffDir === 'string' && handoffDir.trim().length > 0 ? handoffDir.trim() : '.dsh/handoff'
  const portable = configured.replace(/\\/g, '/')
  if (portable.startsWith('/') || /^[A-Za-z]:/.test(portable)) {
    throw new HandoffStoreError(`handoffDir must be a relative path inside the workspace, got "${configured}"`, 'BAD_DIR')
  }
  if (portable.split('/').some((segment) => segment === '..')) {
    throw new HandoffStoreError(`handoffDir must not contain "..", got "${configured}"`, 'BAD_DIR')
  }
  const root = resolve(cwd, portable)
  if (root === resolve(cwd) || !isInside(resolve(cwd), root)) {
    throw new HandoffStoreError(`handoffDir must stay strictly inside the workspace, got "${configured}"`, 'BAD_DIR')
  }
  return root
}

/** Parse the compact YAML frontmatter used by HANDOFF.md. */
export function parseFrontmatter(markdown) {
  if (typeof markdown !== 'string') return {}
  const text = markdown.replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n')) return {}
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) return {}
  const result = {}
  for (const line of text.slice(4, end).split('\n')) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        value = value.slice(1, -1)
      }
    } else if (value === 'true' || value === 'false') {
      value = value === 'true'
    } else if (/^-?\d+$/.test(value)) {
      value = Number(value)
    }
    result[key] = value
  }
  return result
}

/** One workspace's handoff store. */
export class HandoffStore {
  /**
   * @param {object} options
   * @param {string} options.cwd absolute workspace root
   * @param {string} [options.dir] workspace-relative handoff directory
   * @param {number} [options.keepHistory] retained HANDOFF.md snapshots
   */
  constructor({ cwd, dir = '.dsh/handoff', keepHistory = 10 }) {
    this.cwd = cwd
    this.keepHistory = Number.isSafeInteger(keepHistory) && keepHistory >= 0 ? keepHistory : 10
    this.root = resolveHandoffDir(cwd, dir)
  }

  get indexFile() {
    return join(this.root, 'index.json')
  }

  taskDir(taskId) {
    assertTaskId(taskId)
    return join(this.root, taskId)
  }

  docPath(taskId) {
    return join(this.taskDir(taskId), 'HANDOFF.md')
  }

  factsPath(taskId) {
    return join(this.taskDir(taskId), 'facts.json')
  }

  resumeLogPath(taskId) {
    return join(this.taskDir(taskId), 'resume-log.jsonl')
  }

  historyDir(taskId) {
    return join(this.taskDir(taskId), 'history')
  }

  /** Create the directory chain and refuse symlinked path components. */
  async init() {
    await mkdir(this.root, { recursive: true })
    await assertNoSymlink(this.cwd, this.root)
    await mkdir(this.root, { recursive: true })
    const stats = await lstat(this.root)
    if (!stats.isDirectory()) throw new HandoffStoreError(`handoff directory is not a directory: ${this.root}`, 'BAD_DIR')
    return this
  }

  /** Whether a task directory exists. */
  async taskExists(taskId) {
    try {
      const stats = await stat(this.taskDir(taskId))
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Allocate `<YYYYMMDD-HHmm>[-slug]` unique within this workspace.
   */
  async allocateTaskId(title, now = new Date()) {
    const base = stampCompact(now)
    const slug = slugify(typeof title === 'string' ? title : '')
    const stem = slug.length > 0 ? `${base}-${slug}` : base
    for (let attempt = 1; attempt <= 99; attempt++) {
      const candidate = attempt === 1 ? stem : `${stem}-${attempt}`
      if (!(await this.taskExists(candidate))) return candidate
    }
    return `${stem}-${Date.now()}`
  }

  /** Read the index, recovering from corruption with a backup + rebuild. */
  async readIndex() {
    let raw
    try {
      raw = await readFile(this.indexFile, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { index: emptyIndex(), warning: undefined }
      throw error
    }
    try {
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
      if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
        throw new Error('index.json has no tasks array')
      }
      return {
        index: {
          schemaVersion: INDEX_SCHEMA_VERSION,
          tasks: parsed.tasks.filter((task) => task !== null && typeof task === 'object' && typeof task.taskId === 'string'),
        },
        warning: undefined,
      }
    } catch (error) {
      const backup = `${this.indexFile}.bak-${stampFile()}`
      await rename(this.indexFile, backup).catch(() => {})
      const rebuilt = await this.#rebuildIndex()
      return {
        index: rebuilt,
        warning: `index.json was corrupt (${error.message}); backed it up to ${backup} and rebuilt from task folders`,
      }
    }
  }

  async #rebuildIndex() {
    const tasks = []
    let entries = []
    try {
      entries = await readdir(this.root, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const taskId = entry.name
      let facts
      try {
        facts = JSON.parse((await readFile(this.factsPath(taskId), 'utf8')).replace(/^\uFEFF/, ''))
      } catch {
        continue
      }
      let frontmatter = {}
      try {
        frontmatter = parseFrontmatter(await readFile(this.docPath(taskId), 'utf8'))
      } catch {
        frontmatter = {}
      }
      tasks.push({
        taskId,
        title: typeof facts.title === 'string' ? facts.title : typeof frontmatter.title === 'string' ? frontmatter.title : taskId,
        status: typeof frontmatter.status === 'string' ? frontmatter.status : typeof facts.status === 'string' ? facts.status : 'draft',
        createdAt: typeof facts.generatedAt === 'string' ? facts.generatedAt : isoLocal(),
        updatedAt: typeof frontmatter.updated_at === 'string' ? frontmatter.updated_at : isoLocal(),
        workspace: typeof facts.workspace === 'string' ? facts.workspace : this.cwd,
        docPath: `${taskId}/HANDOFF.md`,
        factsPath: `${taskId}/facts.json`,
        sourceSessionId: typeof facts.session?.id === 'string' ? facts.session.id : '',
        sourceSessionTitle: typeof facts.session?.title === 'string' ? facts.session.title : '',
        steps: Number(facts.session?.steps) || 0,
        turns: Number(facts.session?.turns) || 0,
        firstAction: typeof facts.firstAction === 'string' ? facts.firstAction : '',
        resumedBy: [],
        resumedAt: null,
      })
    }
    tasks.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    const index = { schemaVersion: INDEX_SCHEMA_VERSION, tasks }
    await this.writeIndex(index)
    return index
  }

  /** Atomically replace index.json (callers normally use `mutateIndex`). */
  async writeIndex(index) {
    await mkdir(this.root, { recursive: true })
    const payload = { schemaVersion: INDEX_SCHEMA_VERSION, tasks: Array.isArray(index.tasks) ? index.tasks : [] }
    await writeFileAtomic(this.indexFile, JSON.stringify(payload, null, 2) + '\n')
  }

  /**
   * Serialized index read-modify-write. `mutator` receives the current index
   * and returns the next one (or mutates it in place).
   */
  async mutateIndex(mutator) {
    return this.withLock(async () => {
      const { index, warning } = await this.readIndex()
      const next = (await mutator(index)) ?? index
      await this.writeIndex(next)
      return { index: next, warning }
    })
  }

  /** Run `fn` while holding `index.json.lock`. */
  async withLock(fn) {
    const release = await acquireLock(join(this.root, 'index.json.lock'))
    try {
      return await fn()
    } finally {
      await release()
    }
  }

  /** Insert or replace one task row, preserving `resumedBy`/`resumedAt` when absent. */
  async upsertTask(row) {
    return this.mutateIndex((index) => {
      const existing = index.tasks.find((task) => task.taskId === row.taskId)
      const merged = {
        ...(existing ?? {}),
        ...row,
        resumedBy: row.resumedBy ?? existing?.resumedBy ?? [],
        resumedAt: row.resumedAt ?? existing?.resumedAt ?? null,
      }
      index.tasks = [merged, ...index.tasks.filter((task) => task.taskId !== row.taskId)]
      return index
    })
  }

  /** Update selected fields of one task row. */
  async updateTask(taskId, patch) {
    return this.mutateIndex((index) => {
      const task = index.tasks.find((entry) => entry.taskId === taskId)
      if (task === undefined) throw new HandoffStoreError(`handoff task not found: ${taskId}`, 'NO_TASK')
      Object.assign(task, patch)
      index.tasks = [task, ...index.tasks.filter((entry) => entry.taskId !== taskId)]
      return index
    })
  }

  /**
   * Find the active task line owned by one session: either the session that
   * produced the document, or a session that resumed it. Matching resumed
   * sessions is what lets `/handoff` update the same document after a resume
   * instead of starting an unrelated task line.
   */
  findTaskForSession(index, sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    return index.tasks
      .filter(
        (task) =>
          task.status !== 'archived' &&
          (task.sourceSessionId === sessionId ||
            (Array.isArray(task.resumedBy) && task.resumedBy.includes(sessionId))),
      )
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0]
  }

  /** Read and parse facts.json for one task. */
  async readFacts(taskId) {
    try {
      const raw = await readFile(this.factsPath(taskId), 'utf8')
      return JSON.parse(raw.replace(/^\uFEFF/, ''))
    } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw new HandoffStoreError(`cannot read ${this.factsPath(taskId)}: ${error.message}`, 'BAD_FACTS')
    }
  }

  /** Read HANDOFF.md for one task. */
  async readDoc(taskId) {
    try {
      return await readFile(this.docPath(taskId), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw new HandoffStoreError(`cannot read ${this.docPath(taskId)}: ${error.message}`, 'BAD_DOC')
    }
  }

  /** Write facts.json for one task. */
  async writeFacts(taskId, facts) {
    await mkdir(this.taskDir(taskId), { recursive: true })
    await writeFileAtomic(this.factsPath(taskId), JSON.stringify(facts, null, 2) + '\n')
  }

  /**
   * Write HANDOFF.md, keeping at most `keepHistory` previous versions.
   * Returns `{written, previous}`; an identical rewrite is a no-op.
   */
  async writeDoc(taskId, markdown) {
    const dir = this.taskDir(taskId)
    await mkdir(dir, { recursive: true })
    const target = this.docPath(taskId)
    const previous = await readFile(target, 'utf8').catch(() => undefined)
    if (previous === markdown) return { written: false, previous: false }
    if (previous !== undefined && this.keepHistory > 0) {
      await mkdir(this.historyDir(taskId), { recursive: true })
      const stamp = stampFile()
      let name = `${stamp}.md`
      for (let suffix = 1; suffix < 1000; suffix++) {
        try {
          await access(join(this.historyDir(taskId), name))
          name = `${stamp}-${suffix}.md`
        } catch {
          break
        }
      }
      await copyFile(target, join(this.historyDir(taskId), name))
      await this.#pruneHistory(taskId)
    }
    await writeFileAtomic(target, markdown)
    return { written: true, previous: previous !== undefined }
  }

  async #pruneHistory(taskId) {
    const dir = this.historyDir(taskId)
    let names = []
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()
    } catch {
      return
    }
    const excess = names.length - this.keepHistory
    for (const name of names.slice(0, Math.max(0, excess))) {
      await rm(join(dir, name), { force: true })
    }
  }

  /** Append one JSON line to resume-log.jsonl. */
  async appendResumeLog(taskId, entry) {
    await mkdir(this.taskDir(taskId), { recursive: true })
    await writeFile(this.resumeLogPath(taskId), JSON.stringify(entry) + '\n', { flag: 'a' })
  }

  /** Check whether a model-supplied relative path currently exists. */
  async fileExists(relativePath) {
    const absolute = resolve(this.cwd, relativePath)
    if (!isInside(this.cwd, absolute)) return false
    try {
      await access(absolute, fsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * Normalize one file-map path and check its existence. Absolute paths inside
   * the workspace become relative; anything escaping the workspace is marked
   * `outside` and never read.
   */
  async inspectPath(rawPath) {
    const text = String(rawPath ?? '').trim().replace(/\\/g, '/')
    if (text.length === 0) return { display: '', exists: false, outside: false }
    const absolute = isAbsolute(text) ? resolve(text) : resolve(this.cwd, text)
    if (!isInside(this.cwd, absolute)) return { display: text, exists: false, outside: true }
    const rel = relative(this.cwd, absolute).replace(/\\/g, '/')
    if (rel.length === 0) return { display: '.', exists: true, outside: false }
    return { display: rel, exists: await this.fileExists(rel), outside: false }
  }
}

function emptyIndex() {
  return { schemaVersion: INDEX_SCHEMA_VERSION, tasks: [] }
}

function assertTaskId(taskId) {
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(taskId)) {
    throw new HandoffStoreError(`invalid handoff task id: ${String(taskId)}`, 'BAD_TASK_ID')
  }
}

async function assertNoSymlink(cwd, target) {
  const rel = relative(cwd, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new HandoffStoreError(`handoff directory escapes the workspace: ${target}`, 'BAD_DIR')
  }
  const segments = rel.split(sep).filter(Boolean)
  let current = cwd
  for (const segment of segments) {
    current = join(current, segment)
    let stats
    try {
      stats = await lstat(current)
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (stats.isSymbolicLink()) {
      throw new HandoffStoreError(`refusing to use a symlinked handoff path component: ${current}`, 'SYMLINK')
    }
  }
}

async function acquireLock(lockPath) {
  await mkdir(dirname(lockPath), { recursive: true })
  let lastError
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: isoLocal() }))
      return async () => {
        await handle.close().catch(() => {})
        await rm(lockPath, { force: true }).catch(() => {})
      }
    } catch (error) {
      lastError = error
      if (error.code !== 'EEXIST') throw error
      try {
        const stats = await stat(lockPath)
        if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
          await rm(lockPath, { force: true })
          continue
        }
      } catch {
        continue
      }
      await new Promise((resolveSleep) => setTimeout(resolveSleep, LOCK_RETRY_MS))
    }
  }
  throw new HandoffStoreError(
    `handoff index is locked by another session (${lockPath}); ${lastError?.message ?? 'timeout'}`,
    'LOCKED',
  )
}

/** Atomic file replacement that works on Windows too. */
export async function writeFileAtomic(file, content) {
  await mkdir(dirname(file), { recursive: true })
  const temp = join(dirname(file), `.${file.split(/[\\/]/).pop()}.tmp-${process.pid}-${randomUUID()}`)
  const handle = await open(temp, 'w')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close().catch(() => {})
  }
  try {
    await rename(temp, file)
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
    await rm(file, { force: true })
    await rename(temp, file)
  }
}
