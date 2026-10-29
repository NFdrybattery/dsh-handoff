import test from 'node:test'
import assert from 'node:assert/strict'
import { nextReminder } from '../lib/notice-core.js'

const config = {
  remindAfterSteps: 800,
  remindEverySteps: 200,
  remindAfterTokens: 120_000,
}

test('no reminder below every threshold', () => {
  assert.equal(nextReminder({ steps: 799, tokens: 1000, window: 131_072 }, config, new Set()), undefined)
})

test('one reminder per step band', () => {
  const delivered = new Set()
  const first = nextReminder({ steps: 800, tokens: 5000, window: 131_072 }, config, delivered)
  assert.equal(first.key, 'steps:800')
  delivered.add(first.key)
  assert.equal(nextReminder({ steps: 812, tokens: 5000, window: 131_072 }, config, delivered), undefined)
  assert.equal(nextReminder({ steps: 999, tokens: 5000, window: 131_072 }, config, delivered), undefined)

  const second = nextReminder({ steps: 1000, tokens: 5000, window: 131_072 }, config, delivered)
  assert.equal(second.key, 'steps:1000')
  delivered.add(second.key)
  assert.equal(nextReminder({ steps: 1199, tokens: 5000, window: 131_072 }, config, delivered), undefined)
})

test('token threshold is independent and delivered once', () => {
  const delivered = new Set()
  const token = nextReminder({ steps: 10, tokens: 130_000, window: 131_072 }, config, delivered)
  assert.equal(token.key, 'tokens')
  delivered.add(token.key)
  assert.equal(nextReminder({ steps: 10, tokens: 200_000, window: 131_072 }, config, delivered), undefined)
})

test('token reminder can be disabled', () => {
  const delivered = new Set()
  assert.equal(
    nextReminder({ steps: 10, tokens: 900_000, window: 1_000_000 }, { ...config, remindAfterTokens: 0 }, delivered),
    undefined,
  )
})

test('reminder text carries the step and context numbers', () => {
  const reminder = nextReminder({ steps: 812, tokens: 118_000, window: 131_072 }, config, new Set())
  assert.ok(reminder.text.includes('812'))
  assert.ok(reminder.text.includes('118k/131k'))
  assert.ok(reminder.text.includes('/handoff'))
})
