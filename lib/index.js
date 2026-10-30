/**
 * handoff — long-session handoff and task continuation for DeepSeek
 * Harness.
 *
 * Host-only M1:
 *   - `/handoff` command family (write / status / list / resume / archive)
 *   - a host-only `handoffFacts` projection used for task metadata
 *   - step/context threshold reminders at message boundaries
 *
 * Documents live under `<workspace>/.dsh/handoff/<taskId>/`.
 */

import { Config, resolveConfig } from './config.js'
import { createFactsProjection, DEFAULT_FACT_LIMITS } from './facts.js'
import { registerHandoffCommands } from './commands.js'
import { registerHandoffNotices } from './notice.js'

export const name = 'handoff'

export { Config }

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return

  const limits = {
    ...DEFAULT_FACT_LIMITS,
    maxUserMessages: resolved.maxUserMessages,
    maxAssistantMessages: resolved.maxAssistantMessages,
    maxCommandLog: resolved.maxCommandLog,
    maxErrors: resolved.maxErrors,
  }

  // Optional seams: each contribution activates when its service exists.
  // This keeps the plugin loadable in minimal compositions (e.g. a CLI spine
  // without commands) and degrades the feature rather than the process.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(createFactsProjection(limits))
  })
  ctx.inject(['commands'], (commandCtx) => {
    registerHandoffCommands(commandCtx, resolved)
  })

  registerHandoffNotices(ctx, resolved)
}
