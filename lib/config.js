/**
 * Plugin configuration (`Config` in package.json terms) plus a tolerant
 * runtime resolver. The loader validates rows against `Config`; `resolveConfig`
 * keeps direct/in-process use safe as well.
 *
 * Every field is `.volatile()`: that metadata is what makes the Host Settings
 * service project a form for this plugin. Without it the settings page receives
 * no namespace and shows "no settings entry".
 */

import z from '@deepseek-ai/schemastery'

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  remindAfterSteps: 800,
  remindEverySteps: 200,
  remindAfterTokens: 120000,
  retentionDays: 1,
  recentRounds: 5,
  resumeBriefMaxChars: 2400,
  language: 'zh',
})

export const Config = z.object({
  enabled: z.boolean().default(true).volatile().description('Enable the handoff command and threshold reminders.'),
  remindAfterSteps: z
    .number()
    .step(1)
    .min(1)
    .default(800)
    .volatile()
    .description('First step count at which the session is reminded to create a handoff document.'),
  remindEverySteps: z
    .number()
    .step(1)
    .min(1)
    .default(200)
    .volatile()
    .description('Step interval for repeat reminders (one reminder per interval).'),
  remindAfterTokens: z
    .number()
    .step(1)
    .min(0)
    .default(120000)
    .volatile()
    .description('Projected context tokens that trigger a reminder; 0 disables the token reminder.'),
  retentionDays: z
    .number()
    .min(0)
    .default(1)
    .volatile()
    .description('Delete handoff task folders whose last update is older than this many days; 0 disables cleanup.'),
  recentRounds: z
    .number()
    .step(1)
    .min(0)
    .default(5)
    .volatile()
    .description('Recent user/assistant rounds copied verbatim into the handoff document; 0 disables the section.'),
  resumeBriefMaxChars: z
    .number()
    .step(1)
    .min(200)
    .default(2400)
    .volatile()
    .description('Maximum characters injected by /handoff resume.'),
  language: z
    .string()
    .default('zh')
    .volatile()
    .description('Document language: zh or en.'),
})

/** Unwrap schemastery volatile references (`{ get() }`) before reading values. */
function configValue(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

/** Merge defaults with the loader-provided config and clamp unsafe values. */
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const input = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, configValue(value)]))
  const integer = (value, fallback, minimum) => {
    const number = Number(value)
    return Number.isSafeInteger(number) && number >= minimum ? number : fallback
  }
  const days = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : fallback
  }
  return {
    enabled: input.enabled !== false,
    remindAfterSteps: integer(input.remindAfterSteps, DEFAULT_CONFIG.remindAfterSteps, 1),
    remindEverySteps: integer(input.remindEverySteps, DEFAULT_CONFIG.remindEverySteps, 1),
    remindAfterTokens: integer(input.remindAfterTokens, DEFAULT_CONFIG.remindAfterTokens, 0),
    retentionDays: days(input.retentionDays, DEFAULT_CONFIG.retentionDays),
    recentRounds: integer(input.recentRounds, DEFAULT_CONFIG.recentRounds, 0),
    resumeBriefMaxChars: integer(input.resumeBriefMaxChars, DEFAULT_CONFIG.resumeBriefMaxChars, 200),
    language: input.language === 'en' ? 'en' : 'zh',
  }
}
