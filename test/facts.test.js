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
  projectedPressureTokens,
  readFactsState,
  resolveProjectionRegistry,
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

/**
 * A test double with the exact Cordis read semantics that caused the
 * command-side regression: a service the plugin did not inject is rejected on
 * plain property access, while `get(name)` is the supported read-without-inject
 * seam.
 */
function cordisLikeContext(services) {
  const ctx = {
    get(name) {
      return services[name]
    },
  }
  for (const name of Object.keys(services)) {
    Object.defineProperty(ctx, name, {
      get() {
        throw new Error(`cannot get property "${name}" without inject`)
      },
    })
  }
  return ctx
}

test('resolveProjectionRegistry reads through ctx.get when plain access is rejected', () => {
  const registry = { stateOf: () => undefined }
  const ctx = cordisLikeContext({ sessionProjections: registry })
  assert.throws(() => ctx.sessionProjections, /without inject/)
  assert.equal(resolveProjectionRegistry(ctx), registry)
})

test('resolveProjectionRegistry degrades to undefined when no registry is composed', () => {
  const ctx = { get: () => undefined }
  assert.equal(resolveProjectionRegistry(ctx), undefined)
  assert.equal(resolveProjectionRegistry(undefined), undefined)
})

test('readFactsState reads the folded state through a non-injected registry', () => {
  const state = createEmptyFacts()
  state.steps = 7
  const session = { id: 'session-1', seq: 9, header: { cwd: '/ws-fixture' } }
  const registry = {
    stateOf: (target, key) => (target === session && key === 'handoffFacts' ? state : undefined),
  }
  const ctx = cordisLikeContext({ sessionProjections: registry })
  assert.equal(readFactsState(ctx, session), state)
})

test('collectFacts-style snapshot loses no projection through a non-injected registry', () => {
  // Mirrors commands.js: read the registry once, then project each key.
  const projections = {
    sessionStats: { turns: 4, steps: 20 },
    contextPressure: { projectedTokens: 2048, contextWindow: 131072 },
    todos: [{ content: 'fix projection read', status: 'in_progress' }],
    goal: { current: { goal: { objective: 'ship', phase: 'active', maxGoalRounds: 5 }, roundsStarted: 1 } },
    title: 'Real session title',
  }
  const session = { id: 'session-2', seq: 30, header: { cwd: '/ws-fixture' } }
  const registry = { stateOf: (target, key) => (target === session ? projections[key] : undefined) }
  const ctx = cordisLikeContext({ sessionProjections: registry })
  const resolved = resolveProjectionRegistry(ctx)
  const read = (key) => {
    try {
      return resolved?.stateOf?.(session, key)
    } catch {
      return undefined
    }
  }
  const facts = buildFactsSnapshot({ state: createEmptyFacts(), session, getProjection: read })

  assert.deepEqual(facts.unavailable, [])
  assert.equal(facts.title, 'Real session title')
  assert.equal(facts.session.steps, 20)
  assert.equal(facts.session.turns, 4)
  assert.equal(facts.session.pressureTokens, 2048)
  assert.equal(facts.session.contextWindow, 131072)
  assert.deepEqual(facts.todos, [{ content: 'fix projection read', status: 'in_progress' }])
  assert.equal(facts.goal.objective, 'ship')
})

test('projected context pressure mirrors the contextPressure wire view', () => {
  assert.equal(
    projectedPressureTokens({ pressureTokens: 1000, surfaceTokens: 120, sampledSurfaceTokens: 100 }),
    1020,
  )
  assert.equal(projectedPressureTokens({ pressureTokens: 1000 }), 1000)
  assert.equal(projectedPressureTokens({ pressureTokens: 10, surfaceTokens: 1, sampledSurfaceTokens: 5 }), 6)
  assert.equal(projectedPressureTokens({ projectedTokens: 999, pressureTokens: 1 }), 999)
  assert.equal(projectedPressureTokens(undefined), undefined)
  assert.equal(projectedPressureTokens({ surfaceTokens: 5 }), undefined)
})

test('facts snapshot derives pressure from the host state, not the client view', () => {
  const session = { id: 'session-3', seq: 12, header: { cwd: '/ws-fixture' } }
  const projections = {
    sessionStats: { turns: 1, steps: 2 },
    contextPressure: { pressureTokens: 800, surfaceTokens: 40, sampledSurfaceTokens: 30, contextWindow: 65536 },
    todos: null,
    goal: { current: null, seenGoalIds: [], failure: null },
    title: 'State-only pressure',
  }
  const facts = buildFactsSnapshot({
    state: createEmptyFacts(),
    session,
    getProjection: (key) => projections[key],
  })
  assert.deepEqual(facts.unavailable, [])
  assert.equal(facts.session.pressureTokens, 810)
  assert.equal(facts.session.contextWindow, 65536)
  assert.deepEqual(facts.todos, [])
  assert.equal(facts.goal, null)
})


