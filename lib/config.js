/**
 * Plugin configuration (`Config` in package.json terms) plus a tolerant
 * runtime resolver. The loader validates rows against `Config`; `resolveConfig`
 * keeps direct/in-process use safe as well.
 */

import z from '@deepseek-ai/schemastery'

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  handoffDir: '.dsh/handoff',
  remindAfterSteps: 800,
  remindEverySteps: 200,
  remindAfterTokens: 120000,
  maxUserMessages: 40,
  maxAssistantMessages: 12,
  maxCommandLog: 40,
  maxErrors: 30,
  keepHistory: 10,
  resumeBriefMaxChars: 2400,
  language: 'zh',
})

export const Config = z.object({
  enabled: z.boolean().default(true).description('Enable the handoff command, tools and threshold reminders.'),
  handoffDir: z
    .string()
    .default('.dsh/handoff')
    .description('Workspace-relative directory for handoff documents. Must stay inside the workspace.'),
  remindAfterSteps: z
    .number()
    .step(1)
    .min(1)
    .default(800)
    .description('First step count at which the session is reminded to create a handoff document.'),
  remindEverySteps: z
    .number()
    .step(1)
    .min(1)
    .default(200)
    .description('Step interval for repeat reminders (one reminder per interval).'),
  remindAfterTokens: z
    .number()
    .step(1)
    .min(0)
    .default(120000)
    .description('Projected context tokens that trigger a reminder; 0 disables the token reminder.'),
  maxUserMessages: z.number().step(1).min(0).default(40).description('Recent user messages kept in facts.json.'),
  maxAssistantMessages: z.number().step(1).min(0).default(12).description('Recent assistant messages kept in facts.json.'),
  maxCommandLog: z.number().step(1).min(0).default(40).description('Recent shell commands kept in facts.json.'),
  maxErrors: z.number().step(1).min(0).default(30).description('Recent failed tool calls kept in facts.json.'),
  keepHistory: z.number().step(1).min(0).default(10).description('Previous HANDOFF.md versions kept per task.'),
  resumeBriefMaxChars: z
    .number()
    .step(1)
    .min(200)
    .default(2400)
    .description('Maximum characters injected by /handoff resume.'),
  language: z
    .string()
    .default('zh')
    .description('Document language: zh or en.'),
})

/** Merge defaults with the loader-provided config and clamp unsafe values. */
export function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const integer = (value, fallback, minimum) => {
    const number = Number(value)
    return Number.isSafeInteger(number) && number >= minimum ? number : fallback
  }
  return {
    enabled: input.enabled !== false,
    handoffDir:
      typeof input.handoffDir === 'string' && input.handoffDir.trim().length > 0
        ? input.handoffDir.trim()
        : DEFAULT_CONFIG.handoffDir,
    remindAfterSteps: integer(input.remindAfterSteps, DEFAULT_CONFIG.remindAfterSteps, 1),
    remindEverySteps: integer(input.remindEverySteps, DEFAULT_CONFIG.remindEverySteps, 1),
    remindAfterTokens: integer(input.remindAfterTokens, DEFAULT_CONFIG.remindAfterTokens, 0),
    maxUserMessages: integer(input.maxUserMessages, DEFAULT_CONFIG.maxUserMessages, 0),
    maxAssistantMessages: integer(input.maxAssistantMessages, DEFAULT_CONFIG.maxAssistantMessages, 0),
    maxCommandLog: integer(input.maxCommandLog, DEFAULT_CONFIG.maxCommandLog, 0),
    maxErrors: integer(input.maxErrors, DEFAULT_CONFIG.maxErrors, 0),
    keepHistory: integer(input.keepHistory, DEFAULT_CONFIG.keepHistory, 0),
    resumeBriefMaxChars: integer(input.resumeBriefMaxChars, DEFAULT_CONFIG.resumeBriefMaxChars, 200),
    language: input.language === 'en' ? 'en' : 'zh',
  }
}
