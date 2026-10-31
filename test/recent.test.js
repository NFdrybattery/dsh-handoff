import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRecentDialog, formatRecentDialog } from '../lib/recent.js'

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

test('formatRecentDialog labels user and assistant lines', () => {
  const text = formatRecentDialog(buildRecentDialog(facts, 1))
  assert.ok(text.includes('[用户 seq=5]\nthird user'))
})
