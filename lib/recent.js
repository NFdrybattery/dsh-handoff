/**
 * Build the "last N rounds" transcript that the old model copies into the
 * handoff document's section 12. The text is the Session's own user/assistant
 * display text, kept verbatim: section 12 must reproduce it, never summarize
 * it, so the formatter already writes the final `用户：` / `回复：` lines.
 */

import { clamp, textFromContent } from './util.js'

/**
 * Per-message safety cap. It only guards against a pathological single
 * message; ordinary prompts and replies stay whole.
 */
const MAX_MESSAGE_CHARS = 20000

/** The text one committed user/assistant event carries. */
function eventText(event) {
  const message = event.type === 'user/message' ? event.data : (event.data?.message ?? event.data)
  return textFromContent(message?.content).trim()
}

/** Whether a committed `user/message` event is a real user turn. */
function isUserEvent(event) {
  return event?.type === 'user/message' && event.data?.source?.kind === 'user'
}

/**
 * Every user/assistant message in one Session log, in UI order.
 *
 * @param {Array<object>} events committed Session events
 * @returns {Array<{role:'user'|'assistant',seq:number,text:string}>}
 */
export function transcriptFromEvents(events) {
  const messages = []
  for (const event of events ?? []) {
    if (event === null || typeof event !== 'object') continue
    const user = event.type === 'user/message'
    if (!user && event.type !== 'assistant/message') continue
    if (user && !isUserEvent(event)) continue
    const text = eventText(event)
    if (text.length === 0) continue
    messages.push({ role: user ? 'user' : 'assistant', seq: Number(event.seq) || 0, text })
  }
  return messages.sort((left, right) => left.seq - right.seq)
}

/**
 * Keep every message from the `rounds`-th-from-last user message onward.
 *
 * @param {Array<{role:string,seq:number,text:string}>} messages UI-ordered messages
 * @param {number} rounds number of user rounds to keep
 */
function lastRounds(messages, rounds) {
  const count = Math.max(0, Math.floor(Number(rounds) || 0))
  if (count === 0) return []
  const userIndexes = messages.map((message, index) => (message.role === 'user' ? index : -1)).filter((index) => index >= 0)
  if (userIndexes.length === 0) return []
  const start = userIndexes.length > count ? userIndexes[userIndexes.length - count] : 0
  return messages.slice(start).map((message) => ({ ...message, text: clamp(message.text, MAX_MESSAGE_CHARS) }))
}

/**
 * Transcript from the facts snapshot. The projection already clamped older
 * text at fold time, so `buildRecentDialogFromEvents` is the faithful source
 * when the Session log is available.
 *
 * @param {object} facts facts snapshot returned by collectFacts
 * @param {number} rounds number of user rounds to keep
 * @returns {Array<{role:'user'|'assistant',seq:number,text:string}>}
 */
export function buildRecentDialog(facts, rounds) {
  const messages = [
    ...(Array.isArray(facts?.recentUserMessages) ? facts.recentUserMessages : []).map((message) => ({
      role: 'user',
      seq: Number(message?.seq) || 0,
      text: String(message?.text ?? '').trim(),
    })),
    ...(Array.isArray(facts?.recentAssistantMessages) ? facts.recentAssistantMessages : []).map((message) => ({
      role: 'assistant',
      seq: Number(message?.seq) || 0,
      text: String(message?.text ?? '').trim(),
    })),
  ].filter((message) => message.text.length > 0)

  return lastRounds(messages.sort((left, right) => left.seq - right.seq), rounds)
}

/**
 * Transcript straight from the Session log: the UI display text itself,
 * unsummarized and in its original order.
 *
 * @param {Array<object>} events committed Session events
 * @param {number} rounds number of user rounds to keep
 * @returns {Array<{role:'user'|'assistant',seq:number,text:string}>}
 */
export function buildRecentDialogFromEvents(events, rounds) {
  return lastRounds(transcriptFromEvents(events), rounds)
}

/**
 * Render the transcript in the handoff document's section-12 form: one
 * `用户：…` line per user input, its following assistant output as `回复：…`.
 *
 * @param {Array<{role:'user'|'assistant',seq:number,text:string}>} messages
 * @returns {string}
 */
export function formatRecentDialog(messages) {
  return messages
    .map((message) => `${message.role === 'user' ? '用户' : '回复'}：${message.text}`)
    .join('\n\n')
}
