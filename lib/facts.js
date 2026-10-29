/**
 * The host-only `handoffFacts` session projection and the mechanical facts
 * snapshot derived from it.
 *
 * The fold is a pure reducer: an event that does not concern handoff returns
 * the same state reference, which is the session-projection registry's
 * zero-work gate. The projection is deliberately host-only (no `wire` block),
 * so nothing here reaches a client carrier.
 */

import { isAbsolute, relative } from 'node:path'
import { clamp, firstLine, parseArguments, pickString, redactSecrets, textFromContent, toPosixPath } from './util.js'

/** Projection key reserved by this plugin. */
export const FACTS_KEY = 'handoffFacts'

/** Bumped whenever the folded state fields or semantics change. */
export const FACTS_STATE_VERSION = 1

/** Hard caps that keep the persisted projection small. */
export const DEFAULT_FACT_LIMITS = Object.freeze({
  maxUserMessages: 40,
  maxAssistantMessages: 12,
  maxCommandLog: 40,
  maxErrors: 30,
  maxFiles: 200,
  maxChangedTurns: 20,
  textUserMaxChars: 4096,
  textAssistantMaxChars: 2048,
  textCommandMaxChars: 500,
  textErrorMaxChars: 300,
})

const FILE_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
const SHELL_TOOLS = new Set(['pwsh', 'bash'])

/** Empty fold state. Every array/object is freshly owned by the caller. */
export function createEmptyFacts() {
  return {
    v: 1,
    turns: 0,
    steps: 0,
    firstUserText: '',
    users: [],
    assistants: [],
    toolCalls: 0,
    callsByName: {},
    pending: {},
    files: {},
    commands: [],
    errors: [],
    changedTurns: [],
    truncated: {
      users: false,
      assistants: false,
      commands: false,
      errors: false,
      files: false,
    },
  }
}

/**
 * The projection definition. `stateSchema` is intentionally permissive: the
 * registry only uses `parse` to gate persisted checkpoint rows, and the fold
 * owns the shape.
 */
export function createFactsProjection(limits = DEFAULT_FACT_LIMITS) {
  const resolved = { ...DEFAULT_FACT_LIMITS, ...limits }
  return {
    key: FACTS_KEY,
    stateVersion: FACTS_STATE_VERSION,
    stateSchema: { parse: (value) => value },
    init: () => createEmptyFacts(),
    apply: (state, event) => applyFactsEvent(state, event, resolved),
  }
}

/**
 * Fold one committed session event.
 *
 * @param {object} state - current folded state (never mutated).
 * @param {object} event - committed session event `{type, seq, time, data}`.
 * @param {object} limits - resolved caps.
 * @returns {object} the next state, or `state` itself for unrelated events.
 */
export function applyFactsEvent(state, event, limits = DEFAULT_FACT_LIMITS) {
  if (state === null || typeof state !== 'object') return createEmptyFacts()
  if (event === null || typeof event !== 'object') return state

  switch (event.type) {
    case 'turn/start': {
      const turn = Number(event.data?.turn)
      if (!Number.isSafeInteger(turn) || turn <= state.turns) return state
      return { ...state, turns: turn }
    }
    case 'step/start': {
      const step = Number(event.data?.step)
      if (!Number.isSafeInteger(step) || step <= state.steps) return state
      return { ...state, steps: step }
    }
    case 'user/message':
      return foldUserMessage(state, event, limits)
    case 'assistant/message':
      return foldAssistantMessage(state, event, limits)
    case 'tool/call':
      return foldToolCall(state, event, limits)
    case 'tool/result':
      return foldToolResult(state, event, limits)
    case 'workspace/changes': {
      const turn = Number(event.data?.turn)
      if (!Number.isSafeInteger(turn)) return state
      let changedTurns = state.changedTurns
      if (!changedTurns.some((entry) => entry.seq === event.seq)) {
        changedTurns = [...changedTurns, { turn, seq: event.seq }].slice(-limits.maxChangedTurns)
      }
      return { ...state, changedTurns }
    }
    default:
      return state
  }
}

function foldUserMessage(state, event, limits) {
  const data = event.data
  if (data === null || typeof data !== 'object') return state
  if (data.source?.kind !== 'user') return state
  const text = clamp(textFromContent(data.content), limits.textUserMaxChars)
  if (text.length === 0) return state

  let users = [...state.users, { seq: event.seq, turn: state.turns, time: event.time, text }]
  let truncatedUsers = state.truncated.users
  if (users.length > limits.maxUserMessages) {
    users = users.slice(users.length - limits.maxUserMessages)
    truncatedUsers = true
  }
  return {
    ...state,
    firstUserText: state.firstUserText.length > 0 ? state.firstUserText : firstLine(text, 240),
    users,
    truncated: { ...state.truncated, users: truncatedUsers },
  }
}

function foldAssistantMessage(state, event, limits) {
  const message = event.data?.message ?? event.data
  const text = clamp(textFromContent(message?.content), limits.textAssistantMaxChars)
  if (text.length === 0) return state

  let assistants = [...state.assistants, { seq: event.seq, turn: Number(event.data?.turn) || state.turns, text }]
  let truncatedAssistants = state.truncated.assistants
  if (assistants.length > limits.maxAssistantMessages) {
    assistants = assistants.slice(assistants.length - limits.maxAssistantMessages)
    truncatedAssistants = true
  }
  return {
    ...state,
    assistants,
    truncated: { ...state.truncated, assistants: truncatedAssistants },
  }
}

function foldToolCall(state, event, limits) {
  const data = event.data
  if (data === null || typeof data !== 'object') return state
  const name = typeof data.name === 'string' ? data.name : ''
  if (name.length === 0) return state
  const args = parseArguments(data.arguments)
  const callId = typeof data.callId === 'string' ? data.callId : ''

  const callsByName = { ...state.callsByName, [name]: (state.callsByName[name] ?? 0) + 1 }
  let files = state.files
  let truncatedFiles = state.truncated.files

  if (FILE_TOOLS.has(name)) {
    const rawPath = pickString(args, ['file_path', 'path'])
    if (rawPath !== undefined) {
      const path = normalizeFileKey(rawPath)
      if (path.length > 0) {
        const previous = files[path]
        files = {
          ...files,
          [path]: {
            path,
            writes: (previous?.writes ?? 0) + (name === 'write' ? 1 : 0),
            edits: (previous?.edits ?? 0) + (name === 'write' ? 0 : 1),
            lastSeq: event.seq,
            lastTool: name,
          },
        }
        if (Object.keys(files).length > limits.maxFiles) {
          const keep = Object.values(files)
            .sort((left, right) => right.lastSeq - left.lastSeq)
            .slice(0, limits.maxFiles)
          files = Object.fromEntries(keep.map((entry) => [entry.path, entry]))
          truncatedFiles = true
        }
      }
    }
  }

  let pending = state.pending
  if (callId.length > 0) {
    const command = SHELL_TOOLS.has(name)
      ? clamp(redactSecrets(pickString(args, ['command', 'cmd']) ?? ''), limits.textCommandMaxChars)
      : ''
    pending = {
      ...pending,
      [callId]: {
        name,
        callId,
        turn: Number(data.turn) || state.turns,
        step: Number(data.step) || state.steps,
        seq: event.seq,
        command,
      },
    }
    if (Object.keys(pending).length > 400) {
      const keep = Object.values(pending)
        .sort((left, right) => right.seq - left.seq)
        .slice(0, 400)
      pending = Object.fromEntries(keep.map((entry) => [entry.callId, entry]))
    }
  }

  return {
    ...state,
    toolCalls: state.toolCalls + 1,
    callsByName,
    files,
    pending,
    truncated: { ...state.truncated, files: truncatedFiles },
  }
}

function foldToolResult(state, event, limits) {
  const data = event.data
  const callId = data?.message?.source?.callId
  if (typeof callId !== 'string' || callId.length === 0) return state
  const pendingCall = state.pending[callId]
  if (pendingCall === undefined) return state

  const isError = data?.message?.isError === true || data?.error !== undefined
  const summary = clamp(redactSecrets(textFromContent(data?.message?.content)), limits.textErrorMaxChars)
  let commands = state.commands
  let errors = state.errors
  let truncatedCommands = state.truncated.commands
  let truncatedErrors = state.truncated.errors

  if (pendingCall.command.length > 0) {
    commands = [
      ...commands,
      {
        seq: event.seq,
        turn: pendingCall.turn,
        step: pendingCall.step,
        text: pendingCall.command,
        ok: !isError,
      },
    ]
    if (commands.length > limits.maxCommandLog) {
      commands = commands.slice(commands.length - limits.maxCommandLog)
      truncatedCommands = true
    }
  }

  if (isError) {
    errors = [
      ...errors,
      {
        seq: event.seq,
        turn: pendingCall.turn,
        step: pendingCall.step,
        tool: pendingCall.name,
        summary: summary.length > 0 ? summary : 'tool failed without text output',
      },
    ]
    if (errors.length > limits.maxErrors) {
      errors = errors.slice(errors.length - limits.maxErrors)
      truncatedErrors = true
    }
  }

  const pending = { ...state.pending }
  delete pending[callId]

  return {
    ...state,
    commands,
    errors,
    pending,
    truncated: { ...state.truncated, commands: truncatedCommands, errors: truncatedErrors },
  }
}

/** Workspace-relative, forward-slash file key used by the file map. */
export function normalizeFileKey(rawPath) {
  if (typeof rawPath !== 'string') return ''
  const text = rawPath.trim().replace(/\\/g, '/')
  if (text.length === 0) return ''
  return text
}

/**
 * Build the `facts.json` payload from the folded projection plus the shipped
 * projections that describe the rest of the session (stats, todos, goal,
 * plan, context pressure and title). Every optional read is guarded: a missing
 * projection degrades to `null`/`[]` and is named in `unavailable`.
 */
export function buildFactsSnapshot({ state, session, getProjection, now = new Date() }) {
  const read = (key) => {
    try {
      return getProjection?.(key)
    } catch {
      return undefined
    }
  }

  const unavailable = []
  const readRequired = (key) => {
    const value = read(key)
    if (value === undefined) unavailable.push(key)
    return value
  }

  const stats = readRequired('sessionStats')
  const pressure = readRequired('contextPressure')
  const todos = readRequired('todos')
  const goalState = readRequired('goal')
  const planState = read('plan')
  const titleState = readRequired('title')
  const headline = typeof titleState === 'string' && titleState.length > 0 ? titleState : undefined

  const workspace = typeof session?.header?.cwd === 'string' ? session.header.cwd : ''
  const seen = new Map()
  for (const entry of Object.values(state.files ?? {})) {
    const path = displayPath(workspace, entry.path)
    const previous = seen.get(path)
    seen.set(path, {
      path,
      writes: (previous?.writes ?? 0) + entry.writes,
      edits: (previous?.edits ?? 0) + entry.edits,
      lastSeq: Math.max(previous?.lastSeq ?? 0, entry.lastSeq),
      lastTool: entry.lastSeq >= (previous?.lastSeq ?? 0) ? entry.lastTool : previous?.lastTool,
    })
  }
  const files = [...seen.values()].sort((left, right) => right.lastSeq - left.lastSeq)

  const currentGoal = goalState?.current ?? null
  const goal = currentGoal?.goal
    ? {
        objective: currentGoal.goal.objective,
        phase: currentGoal.goal.phase,
        roundsStarted: currentGoal.roundsStarted ?? 0,
        maxGoalRounds: currentGoal.goal.maxGoalRounds ?? null,
        blockedReason: currentGoal.goal.blockedReason?.message ?? null,
      }
    : null

  const steps = Math.max(Number(stats?.steps) || 0, Number(state.steps) || 0)
  const turns = Math.max(Number(stats?.turns) || 0, Number(state.turns) || 0)

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    asOfSeq: Math.max(-1, Number(session?.seq ?? 0) - 1),
    workspace,
    title: headline ?? '',
    session: {
      id: typeof session?.id === 'string' ? session.id : '',
      title: headline ?? '',
      turns,
      steps,
      toolCalls: Number(state.toolCalls) || 0,
      toolErrors: Array.isArray(state.errors) ? state.errors.length : 0,
      callsByName: { ...(state.callsByName ?? {}) },
      pressureTokens: numberOrNull(pressure?.projectedTokens ?? pressure?.pressureTokens),
      contextWindow: numberOrNull(pressure?.contextWindow),
    },
    goal,
    plan: planState === undefined ? null : { active: planState.active === true },
    todos: Array.isArray(todos)
      ? todos
          .filter((item) => item !== null && typeof item === 'object' && typeof item.content === 'string')
          .map((item) => ({ content: item.content, status: item.status ?? 'pending' }))
      : [],
    firstAction: typeof state.firstUserText === 'string' ? state.firstUserText : '',
    recentUserMessages: [...(state.users ?? [])],
    recentAssistantMessages: [...(state.assistants ?? [])],
    files,
    recentTurnsChanged: [...(state.changedTurns ?? [])],
    commands: [...(state.commands ?? [])],
    errors: [...(state.errors ?? [])],
    truncated: { ...(state.truncated ?? {}) },
    unavailable,
  }
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Workspace-relative display path; absolute paths outside the workspace stay absolute. */
export function displayPath(workspace, rawPath) {
  const normalized = toPosixPath(rawPath)
  if (!isAbsolute(normalized) || workspace.length === 0) return normalized
  const rel = relative(workspace, normalized)
  if (rel.length === 0) return normalized
  if (rel.startsWith('..') || isAbsolute(rel)) return normalized
  return toPosixPath(rel)
}

/**
 * Read the folded state through the projection registry. Returns `undefined`
 * when the registry is absent; callers then fall back to a one-shot scan of
 * the session log.
 */
export function readFactsState(ctx, session) {
  try {
    const registry = ctx?.sessionProjections
    if (registry === undefined || session === undefined) return undefined
    return registry.stateOf(session, FACTS_KEY)
  } catch {
    return undefined
  }
}

/**
 * One-shot fold over the session log, used only when the projection registry
 * is unavailable (older Harness builds or a disabled seam).
 */
export function foldSessionEvents(events, limits = DEFAULT_FACT_LIMITS) {
  let state = createEmptyFacts()
  for (const event of events ?? []) state = applyFactsEvent(state, event, limits)
  return state
}
