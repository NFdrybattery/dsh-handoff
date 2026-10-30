/**
 * Threshold reminders: once per configured step band (and once for the token
 * threshold), insert a plugin-sourced notice at the next message boundary.
 *
 * Delivery uses the framework's native `notice` channel — the same pattern the
 * shipped multi-folder plugin uses — and never interrupts an in-flight tool
 * call or appends to the session log outside the normal message push.
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { projectedPressureTokens, resolveProjectionRegistry } from './facts.js'
import { nextReminder } from './notice-core.js'

const SOURCE_KIND = 'plugin:handover'
const MAX_SESSIONS = 200

export function registerHandoffNotices(ctx, config) {
  const delivered = new Map()

  // Read the registry through `ctx.get`: a plain `ctx.sessionProjections`
  // property read is rejected for services this plugin never injected.
  const registry = () => resolveProjectionRegistry(ctx)

  const check = (session) => {
    if (session === undefined || typeof session?.id !== 'string') return undefined
    const projections = registry()
    if (projections === undefined) return undefined
    let stats
    let pressure
    try {
      stats = projections.stateOf(session, 'sessionStats')
      pressure = projections.stateOf(session, 'contextPressure')
    } catch {
      return undefined
    }
    const steps = Number(stats?.steps) || 0
    const tokens = Number(projectedPressureTokens(pressure)) || 0
    const window = Number(pressure?.contextWindow) || 0
    const bands = delivered.get(session.id) ?? new Set()
    const reminder = nextReminder({ steps, tokens, window }, config, bands)
    if (reminder === undefined) return undefined

    bands.add(reminder.key)
    delivered.set(session.id, bands)
    if (delivered.size > MAX_SESSIONS) {
      const oldest = delivered.keys().next().value
      delivered.delete(oldest)
    }
    return reminder.text
  }

  const notice = (text, summary) =>
    createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: SOURCE_KIND, form: 'notice', summary: String(summary).slice(0, 120) },
    })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const text = check(payload.agent?.session)
    if (text === undefined) return decision
    return { ...decision, messages: [notice(text, 'handoff reminder'), ...decision.messages] }
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const text = check(exec.agent?.session)
    if (text === undefined) return decision
    const message = notice(text, 'handoff reminder')
    const contexts = decision.additionalContexts ?? []
    return { ...decision, additionalContexts: [message, ...contexts] }
  })
}
