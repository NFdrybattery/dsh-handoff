import test from 'node:test'
import assert from 'node:assert/strict'
import { pickResumeTask } from '../lib/resume-select.js'

const row = (taskId, overrides = {}) => ({ taskId, title: taskId, status: 'pending', resumedBy: [], resumedAt: null, ...overrides })

test('explicit task id wins even when the task is not pending', () => {
  const task = row('t1', { status: 'resumed' })
  assert.deepEqual(pickResumeTask([task], 's1', 't1'), { kind: 'task', task })
  assert.deepEqual(pickResumeTask([task], 's1', 'missing'), { kind: 'missing', taskId: 'missing' })
})

test('one pending task is selected directly', () => {
  const task = row('t1')
  assert.deepEqual(pickResumeTask([task, row('t2', { status: 'draft' })], 's1'), { kind: 'task', task })
})

test('several pending tasks require an explicit id', () => {
  const picked = pickResumeTask([row('t1'), row('t2')], 's1')
  assert.equal(picked.kind, 'many')
  assert.equal(picked.tasks.length, 2)
})

test('an unrelated draft does not mask a task already resumed by this session', () => {
  const resumed = row('t1', { status: 'resumed', resumedBy: ['s1'], resumedAt: '2026-10-29T18:05:00+08:00' })
  const draft = row('t2', { status: 'draft' })
  assert.deepEqual(pickResumeTask([resumed, draft], 's1'), { kind: 'already', task: resumed })
})

test('a task resumed by another session is not reported as already resumed', () => {
  const resumed = row('t1', { status: 'resumed', resumedBy: ['s2'] })
  assert.deepEqual(pickResumeTask([resumed], 's1'), { kind: 'none' })
})

test('the latest already-resumed task wins', () => {
  const older = row('t1', { status: 'resumed', resumedBy: ['s1'], resumedAt: '2026-10-29T18:00:00+08:00' })
  const newer = row('t2', { status: 'resumed', resumedBy: ['s1'], resumedAt: '2026-10-29T18:05:00+08:00' })
  assert.deepEqual(pickResumeTask([older, newer], 's1'), { kind: 'already', task: newer })
})

test('latest resolves several pending tasks to the most recently updated one', () => {
  const older = row('t1', { updatedAt: '2026-10-29T18:00:00+08:00' })
  const newer = row('t2', { updatedAt: '2026-10-29T19:57:12+08:00' })
  const picked = pickResumeTask([older, newer], 's1', '', { latest: true })
  assert.equal(picked.kind, 'task')
  assert.equal(picked.task.taskId, 't2')
  assert.equal(picked.latest, true)
})

test('latest falls back to createdAt when updatedAt is missing', () => {
  const older = row('t1', { createdAt: '2026-10-29T18:00:00+08:00' })
  const newer = row('t2', { createdAt: '2026-10-29T19:57:12+08:00' })
  assert.equal(pickResumeTask([newer, older], 's1', '', { latest: true }).task.taskId, 't2')
})

test('latest does not override an explicit task id or a single pending task', () => {
  const older = row('t1', { updatedAt: '2026-10-29T18:00:00+08:00' })
  const newer = row('t2', { updatedAt: '2026-10-29T19:57:12+08:00' })
  assert.equal(pickResumeTask([older, newer], 's1', 't1', { latest: true }).task.taskId, 't1')
  const single = pickResumeTask([older], 's1', '', { latest: true })
  assert.deepEqual(single, { kind: 'task', task: older })
})

test('latest does not invent a candidate when nothing is pending', () => {
  const draft = row('t1', { status: 'draft' })
  assert.deepEqual(pickResumeTask([draft], 's1', '', { latest: true }), { kind: 'none' })
})
