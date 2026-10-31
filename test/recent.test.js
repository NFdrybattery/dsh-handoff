import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRecentDialog, buildRecentDialogFromEvents, formatRecentDialog } from '../lib/recent.js'

const facts = {
  recentUserMessages: [
    { seq: 1, text: 'first user' },
    { seq: 3, text: 'second user' },
    { seq: 5, text: 'third user' },
  ],
  recentAssistantMessages: [
    { seq: 2, text: 'first answer' },
    { seq: 4, text: 'second answer' },
  ],
}

const events = [
  { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一轮' }] } },
  { type: 'assistant/message', seq: 2, data: { content: [{ type: 'text', text: '回答一' }] } },
  {
    type: 'user/message',
    seq: 3,
    data: { source: { kind: 'plugin:dsh-handoff' }, content: [{ type: 'text', text: '内部交接指令' }] },
  },
  { type: 'tool/call', seq: 4, data: { name: 'write' } },
  { type: 'user/message', seq: 5, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二轮' }] } },
  { type: 'assistant/message', seq: 6, data: { content: [{ type: 'text', text: '回答二' }] } },
]

test('buildRecentDialog keeps the last N user rounds in UI order', () => {
  const rounds = buildRecentDialog(facts, 2)
  assert.deepEqual(
    rounds.map((message) => `${message.role}:${message.seq}`),
    ['user:3', 'assistant:4', 'user:5'],
  )
})

test('buildRecentDialog returns nothing for zero rounds or missing users', () => {
  assert.deepEqual(buildRecentDialog(facts, 0), [])
  assert.deepEqual(buildRecentDialog({ recentAssistantMessages: facts.recentAssistantMessages }, 3), [])
})

test('formatRecentDialog writes 用户 / 回复 lines without summarizing', () => {
  const text = formatRecentDialog(buildRecentDialog(facts, 2))
  assert.equal(text, '用户：second user\n\n回复：second answer\n\n用户：third user')
})

test('formatRecentDialog keeps a multi-line message verbatim', () => {
  const text = formatRecentDialog([{ role: 'user', seq: 1, text: '第一行\n- 第二行\n```js\nx()\n```' }])
  assert.equal(text, '用户：第一行\n- 第二行\n```js\nx()\n```')
})

test('buildRecentDialog keeps a long message whole instead of clipping it', () => {
  const long = 'x'.repeat(3000)
  const rounds = buildRecentDialog({ recentUserMessages: [{ seq: 1, text: long }] }, 1)
  assert.equal(rounds[0].text, long)
})

test('buildRecentDialogFromEvents reads the Session log and skips non-user sources', () => {
  const rounds = buildRecentDialogFromEvents(events, 3)
  assert.deepEqual(
    rounds.map((message) => `${message.role}:${message.seq}`),
    ['user:1', 'assistant:2', 'user:5', 'assistant:6'],
  )
  assert.equal(rounds[0].text, '第一轮')
})

test('buildRecentDialogFromEvents keeps only the last N user rounds', () => {
  const rounds = buildRecentDialogFromEvents(events, 1)
  assert.deepEqual(
    rounds.map((message) => `${message.role}:${message.seq}`),
    ['user:5', 'assistant:6'],
  )
  assert.equal(formatRecentDialog(rounds), '用户：第二轮\n\n回复：回答二')
})

test('buildRecentDialogFromEvents returns nothing without a user turn', () => {
  assert.deepEqual(buildRecentDialogFromEvents(events, 0), [])
  assert.deepEqual(buildRecentDialogFromEvents([events[1], events[3]], 2), [])
})
