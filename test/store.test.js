import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { HandoffStore, parseFrontmatter, resolveHandoffDir } from '../lib/store.js'

async function workspace() {
  return mkdtemp(join(tmpdir(), 'dsh-handoff-test-'))
}

test('resolveHandoffDir stays inside the workspace', async () => {
  const root = await workspace()
  try {
    assert.equal(resolveHandoffDir(root, '.dsh/handoff'), resolve(root, '.dsh/handoff'))
    assert.throws(() => resolveHandoffDir(root, 'C:\\outside'), /relative path/)
    assert.throws(() => resolveHandoffDir(root, '..\\outside'), /must not contain/)
    assert.throws(() => resolveHandoffDir(root, '.'), /strictly inside/)
    assert.throws(() => resolveHandoffDir('', '.dsh/handoff'), /workspace directory is unknown/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('facts, document history, index and resume log round-trip', async () => {
  const root = await workspace()
  try {
    const store = new HandoffStore({ cwd: root, dir: '.dsh/handoff' })
    await store.init()
    assert.ok(store.root.startsWith(root))

    await store.writeFacts('20261029-1705', { taskId: '20261029-1705', title: 'demo' })
    assert.deepEqual(await store.readFacts('20261029-1705'), { taskId: '20261029-1705', title: 'demo' })

    await store.writeDoc('20261029-1705', '# one\n')
    await store.writeDoc('20261029-1705', '# two\n')
    await store.writeDoc('20261029-1705', '# three\n')
    assert.equal(await store.readDoc('20261029-1705'), '# three\n')

    await store.upsertTask({
      taskId: '20261029-1705',
      title: 'demo',
      status: 'draft',
      createdAt: '2026-10-29T17:05:00+08:00',
      updatedAt: '2026-10-29T17:05:00+08:00',
      workspace: root,
      docPath: '20261029-1705/HANDOFF.md',
      factsPath: '20261029-1705/facts.json',
      sourceSessionId: 'session-1',
      sourceSessionTitle: 'demo',
      steps: 1,
      turns: 1,
      firstAction: 'one',
    })
    let { index } = await store.readIndex()
    assert.equal(index.tasks.length, 1)
    assert.equal(store.findTaskForSession(index, 'session-1').taskId, '20261029-1705')

    await store.updateTask('20261029-1705', { status: 'pending', updatedAt: '2026-10-29T17:06:00+08:00' })
    ;({ index } = await store.readIndex())
    assert.equal(index.tasks[0].status, 'pending')

    const leftovers = (await readdir(store.taskDir('20261029-1705'))).filter((name) => name.includes('.tmp-'))
    assert.deepEqual(leftovers, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent index mutations are serialized', async () => {
  const root = await workspace()
  try {
    const store = new HandoffStore({ cwd: root })
    await store.init()
    await Promise.all(
      Array.from({ length: 10 }, (_, number) =>
        store.upsertTask({
          taskId: `task-${number}`,
          title: `task ${number}`,
          status: 'draft',
          updatedAt: `2026-10-29T17:0${number}:00+08:00`,
        }),
      ),
    )
    const { index } = await store.readIndex()
    assert.equal(index.tasks.length, 10)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('corrupt index is backed up and rebuilt from task folders', async () => {
  const root = await workspace()
  try {
    const store = new HandoffStore({ cwd: root })
    await store.init()
    await store.writeFacts('20261029-1705', {
      taskId: '20261029-1705',
      title: 'rebuild me',
      generatedAt: '2026-10-29T17:05:00+08:00',
      workspace: root,
      session: { id: 'session-1', title: 'demo', steps: 3, turns: 1 },
      firstAction: 'first',
    })
    await store.writeDoc('20261029-1705', '---\nstatus: "pending"\ntitle: "rebuild me"\nupdated_at: "2026-10-29T17:06:00+08:00"\n---\n\n# T\n')

    await writeFile(store.indexFile, '{not valid json', 'utf8')
    const { index, warning } = await store.readIndex()
    assert.ok(warning.includes('corrupt'))
    assert.equal(index.tasks.length, 1)
    assert.equal(index.tasks[0].taskId, '20261029-1705')
    assert.equal(index.tasks[0].status, 'pending')
    const backups = (await readdir(store.root)).filter((name) => name.startsWith('index.json.bak-'))
    assert.equal(backups.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('facts and index tolerate a UTF-8 BOM', async () => {
  const root = await workspace()
  try {
    const store = new HandoffStore({ cwd: root })
    await store.init()
    await store.writeFacts('bom-task', { taskId: 'bom-task' })
    await writeFile(store.factsPath('bom-task'), '\uFEFF' + JSON.stringify({ taskId: 'bom-task', title: 'bom' }), 'utf8')
    assert.deepEqual(await store.readFacts('bom-task'), { taskId: 'bom-task', title: 'bom' })

    await writeFile(store.indexFile, '\uFEFF' + JSON.stringify({ schemaVersion: 1, tasks: [{ taskId: 'bom-task' }] }), 'utf8')
    const { index } = await store.readIndex()
    assert.equal(index.tasks.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('inspectPath marks missing and outside paths', async () => {
  const root = await workspace()
  try {
    const store = new HandoffStore({ cwd: root })
    await store.init()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'x', 'utf8')

    assert.deepEqual(await store.inspectPath('src/a.ts'), { display: 'src/a.ts', exists: true, outside: false })
    assert.deepEqual(await store.inspectPath('src/missing.ts'), { display: 'src/missing.ts', exists: false, outside: false })
    assert.equal((await store.inspectPath('..\\outside.txt')).outside, true)
    assert.equal((await store.inspectPath('C:\\outside.txt')).outside, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('parseFrontmatter handles quoted and scalar values', () => {
  const parsed = parseFrontmatter(
    '---\nhandoff_version: 1\ntask_id: "20261029-1705"\nstatus: pending\nsteps: 812\n---\n\n# T\n',
  )
  assert.deepEqual(parsed, { handoff_version: 1, task_id: '20261029-1705', status: 'pending', steps: 812 })
})

test('findTaskForSession matches the source session and any session that resumed it', () => {
  const store = new HandoffStore({ cwd: resolve('/ws-fixture') })
  const index = {
    schemaVersion: 1,
    tasks: [
      {
        taskId: 'resumed-line',
        sourceSessionId: 'session-source',
        resumedBy: ['session-continued'],
        status: 'resumed',
        updatedAt: '2026-10-29T18:00:00+08:00',
      },
      {
        taskId: 'other-line',
        sourceSessionId: 'session-other',
        resumedBy: [],
        status: 'pending',
        updatedAt: '2026-10-29T18:10:00+08:00',
      },
      {
        taskId: 'archived-line',
        sourceSessionId: 'session-source',
        resumedBy: [],
        status: 'archived',
        updatedAt: '2026-10-29T18:20:00+08:00',
      },
    ],
  }

  assert.equal(store.findTaskForSession(index, 'session-source').taskId, 'resumed-line')
  assert.equal(store.findTaskForSession(index, 'session-continued').taskId, 'resumed-line')
  assert.equal(store.findTaskForSession(index, 'session-other').taskId, 'other-line')
  assert.equal(store.findTaskForSession(index, 'session-new'), undefined)
  assert.equal(store.findTaskForSession(index, ''), undefined)
})

test('cleanupExpired removes old tasks, orphan folders and keeps the latest', async () => {
  const root = await workspace()
  try {
    const store = new HandoffStore({ cwd: root })
    await store.init()
    const oldId = '20200101-0000-old'
    const freshId = '20261029-2000-fresh'
    for (const [taskId, updatedAt] of [
      [oldId, '2020-01-01T00:00:00+08:00'],
      [freshId, '2026-10-29T20:00:00+08:00'],
    ]) {
      await store.writeFacts(taskId, { taskId, title: taskId })
      await store.writeDoc(taskId, `---\ntask_id: "${taskId}"\nstatus: "pending"\n---\n`)
      await store.upsertTask({ taskId, title: taskId, status: 'pending', updatedAt })
    }
    // Orphan folder: no index row, old mtime.
    const orphanId = 'orphan-1'
    await mkdir(store.taskDir(orphanId), { recursive: true })
    await writeFile(join(store.taskDir(orphanId), 'HANDOFF.md'), 'x', 'utf8')
    const oldDate = new Date('2020-01-01T00:00:00Z')
    await utimes(store.taskDir(orphanId), oldDate, oldDate)

    const result = await store.cleanupExpired({ retentionMs: 7 * 86_400_000 })
    assert.deepEqual(result.removed.sort(), [oldId, orphanId].sort())
    assert.equal(await store.taskExists(oldId), false)
    assert.equal(await store.taskExists(orphanId), false)
    assert.equal(await store.taskExists(freshId), true)

    const { index } = await store.readIndex()
    assert.equal(index.tasks.length, 1)
    assert.equal(index.tasks[0].taskId, freshId)
    assert.equal(index.latestTaskId, freshId)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cleanupExpired is disabled by a non-positive retention', async () => {
  const root = await workspace()
  try {
    const store = new HandoffStore({ cwd: root })
    await store.init()
    await store.writeFacts('old-task', { taskId: 'old-task' })
    await store.upsertTask({ taskId: 'old-task', title: 'old', status: 'pending', updatedAt: '2020-01-01T00:00:00+08:00' })
    assert.deepEqual(await store.cleanupExpired({ retentionMs: 0 }), { removed: [], warnings: [] })
    assert.equal(await store.taskExists('old-task'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

