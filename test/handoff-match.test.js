import test from 'node:test'
import assert from 'node:assert/strict'
import { validateHandoffMatch } from '../lib/handoff-match.js'

const task = {
  taskId: 'task-1',
  docPath: 'task-1/HANDOFF.md',
  factsPath: 'task-1/facts.json',
}

test('matching task, frontmatter and facts pass', () => {
  assert.deepEqual(
    validateHandoffMatch({ task, frontmatter: { task_id: 'task-1', status: 'pending' }, facts: { taskId: 'task-1' } }),
    { ok: true, errors: [] },
  )
})

test('a document from another task is rejected', () => {
  const result = validateHandoffMatch({
    task,
    frontmatter: { task_id: 'task-2', status: 'pending' },
    facts: { taskId: 'task-2' },
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('task_id')))
  assert.ok(result.errors.some((error) => error.includes('facts.json taskId')))
})

test('a draft document is rejected', () => {
  const result = validateHandoffMatch({ task, frontmatter: { task_id: 'task-1', status: 'draft' }, facts: { taskId: 'task-1' } })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('draft')))
})

test('index paths outside the selected task are rejected', () => {
  const result = validateHandoffMatch({
    task: { ...task, docPath: 'other/HANDOFF.md' },
    frontmatter: { task_id: 'task-1', status: 'pending' },
    facts: { taskId: 'task-1' },
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('docPath')))
})
