import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import {
  applyFactsEvent,
  buildFactsSnapshot,
  createEmptyFacts,
  createFactsProjection,
  DEFAULT_FACT_LIMITS,
  foldSessionEvents,
} from '../lib/facts.js'

const event = (type, seq, data, time = 1_000 + seq) => ({ type, seq, time, data })

test('unrelated events keep the same state reference', () => {
  const state = createEmptyFacts()
  const next = applyFactsEvent(state, event('approval/asked', 1, {}), DEFAULT_FACT_LIMITS)
  assert.equal(next, state)
})

test('fold counts turns/steps, user and assistant text', () => {
  let state = createEmptyFacts()
  state = applyFactsEvent(state, event('turn/start', 0, { turn: 1 }), DEFAULT_FACT_LIMITS)
  state = applyFactsEvent(state, event('step/start', 1, { turn: 1, step: 1 }), DEFAULT_FACT_LIMITS)
  state = applyFactsEvent(
    state,
    event('user/message', 2, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Build the plugin' }] }),
    DEFAULT_FACT_LIMITS,
  )
  state = applyFactsEvent(
    state,
    event('assistant/message', 3, {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'On it.' }] },
    }),
    DEFAULT_FACT_LIMITS,
  )
  state = applyFactsEvent(state, event('step/start', 4, { turn: 2, step: 2 }), DEFAULT_FACT_LIMITS)

  assert.equal(state.turns, 1)
  assert.equal(state.steps, 2)
  assert.equal(state.firstUserText, 'Build the plugin')
  assert.equal(state.users.length, 1)
  assert.equal(state.assistants[0].text, 'On it.')
})

test('non-user messages are ignored by the user fold', () => {
  let state = createEmptyFacts()
  state = applyFactsEvent(
    state,
    event('user/message', 1, { source: { kind: 'goal' }, content: [{ type: 'text', text: 'goal notice' }] }),
    DEFAULT_FACT_LIMITS,
  )
  assert.equal(state.users.length, 0)
})

test('tool calls record files, commands, errors and results', () => {
  let state = createEmptyFacts()

  state = applyFactsEvent(
    state,
    event('tool/call', 1, {
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'pwsh',
      arguments: JSON.stringify({ command: 'npm test -- --watch=false', workdir: 'C:\\ws' }),
    }),
    DEFAULT_FACT_LIMITS,
  )
  state = applyFactsEvent(
    state,
    event('tool/call', 2, {
      turn: 1,
      step: 1,
      callId: 'call-2',
      name: 'write',
      arguments: JSON.stringify({ file_path: 'C:\\ws\\src\\a.ts', content: 'x' }),
    }),
    DEFAULT_FACT_LIMITS,
  )
  state = applyFactsEvent(
    state,
    event('tool/result', 3, {
      message: { source: { callId: 'call-1' }, isError: false, content: [{ type: 'text', text: 'ok' }] },
    }),
    DEFAULT_FACT_LIMITS,
  )
  state = applyFactsEvent(
    state,
    event('tool/call', 4, {
      turn: 1,
      step: 2,
      callId: 'call-3',
      name: 'pwsh',
      arguments: JSON.stringify({ command: 'const API_KEY="supersecret"' }),
    }),
    DEFAULT_FACT_LIMITS,
  )
  state = applyFactsEvent(
    state,
    event('tool/result', 5, {
      message: { source: { callId: 'call-3' }, isError: true, content: [{ type: 'text', text: 'exit code 1' }] },
    }),
    DEFAULT_FACT_LIMITS,
  )
  state = applyFactsEvent(
    state,
    event('tool/result', 6, {
      message: { source: { callId: 'call-2' }, isError: false, content: [{ type: 'text', text: 'written' }] },
    }),
    DEFAULT_FACT_LIMITS,
  )

  assert.equal(state.toolCalls, 3)
  assert.equal(state.files['C:/ws/src/a.ts'].writes, 1)
  assert.equal(state.commands.length, 2)
  assert.equal(state.commands[0].ok, true)
  assert.equal(state.commands[1].ok, false)
  assert.ok(state.commands[1].text.includes('API_KEY=***'))
  assert.equal(state.errors.length, 1)
  assert.equal(state.errors[0].tool, 'pwsh')
  assert.equal(Object.keys(state.pending).length, 0)
})

test('caps truncate and flag old entries', () => {
  const limits = { ...DEFAULT_FACT_LIMITS, maxUserMessages: 2, maxErrors: 1 }
  let state = createEmptyFacts()
  for (let index = 0; index < 4; index++) {
    state = applyFactsEvent(
      state,
      event('user/message', index, {
        source: { kind: 'user' },
        content: [{ type: 'text', text: `message ${index}` }],
      }),
      limits,
    )
  }
  assert.equal(state.users.length, 2)
  assert.equal(state.users[0].text, 'message 2')
  assert.equal(state.truncated.users, true)
})

test('foldSessionEvents replays an array', () => {
  const state = foldSessionEvents(
    [event('turn/start', 0, { turn: 1 }), event('step/start', 1, { turn: 1, step: 1 })],
    DEFAULT_FACT_LIMITS,
  )
  assert.equal(state.turns, 1)
  assert.equal(state.steps, 1)
})

test('buildFactsSnapshot reads shipped projections and relativizes files', () => {
  const workspace = resolve('/ws-fixture')
  const filePath = join(workspace, 'src', 'a.ts')
  let state = createEmptyFacts()
  state = applyFactsEvent(
    state,
    event('tool/call', 1, {
      turn: 1,
      step: 1,
      callId: 'c1',
      name: 'write',
      arguments: JSON.stringify({ file_path: filePath }),
    }),
    DEFAULT_FACT_LIMITS,
  )
  const projections = {
    sessionStats: { turns: 3, steps: 12 },
    contextPressure: { projectedTokens: 1000, contextWindow: 131072 },
    todos: [{ content: 'ship it', status: 'in_progress' }],
    goal: { current: { goal: { objective: 'ship', phase: 'active', maxGoalRounds: 5 }, roundsStarted: 1 } },
    plan: { active: true },
    title: 'Demo task',
  }
  const session = { id: 'session-1', seq: 9, header: { cwd: workspace } }
  const facts = buildFactsSnapshot({
    state,
    session,
    getProjection: (key) => projections[key],
  })

  assert.equal(facts.schemaVersion, 1)
  assert.equal(facts.asOfSeq, 8)
  assert.equal(facts.workspace, workspace)
  assert.equal(facts.title, 'Demo task')
  assert.equal(facts.session.turns, 3)
  assert.equal(facts.session.steps, 12)
  assert.equal(facts.session.pressureTokens, 1000)
  assert.equal(facts.goal.objective, 'ship')
  assert.deepEqual(facts.todos, [{ content: 'ship it', status: 'in_progress' }])
  assert.deepEqual(facts.plan, { active: true })
  assert.equal(facts.files[0].path, 'src/a.ts')
  assert.deepEqual(facts.unavailable, [])
})

test('projection definition is host-only and versioned', () => {
  const definition = createFactsProjection()
  assert.equal(definition.key, 'handoffFacts')
  assert.equal(definition.stateVersion, 1)
  assert.equal(definition.wire, undefined)
  assert.deepEqual(definition.init(), createEmptyFacts())
})
