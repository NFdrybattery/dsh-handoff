/**
 * Build the "last N rounds" excerpt that the old model writes into the handoff
 * document. The model sees this as raw UI-ordered material and may compress it,
 * but it must not invent lines that are not here.
 */

const MAX_MESSAGE_CHARS = 1200

/**
 * @param {object} facts facts snapshot returned by collectFacts
 * @param {number} rounds number of user rounds to keep
 * @returns {Array<{role:'user'|'assistant',seq:number,text:string}>}
 */
export function buildRecentDialog(facts, rounds) {
  const count = Math.max(0, Math.floor(Number(rounds) || 0))
  if (count === 0) return []
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
  ]
    .filter((message) => message.text.length > 0)
    .sort((left, right) => left.seq - right.seq)

  const userIndexes = messages.map((message, index) => (message.role === 'user' ? index : -1)).filter((index) => index >= 0)
  if (userIndexes.length === 0) return []
  const start = userIndexes.length > count ? userIndexes[userIndexes.length - count] : 0
  return messages.slice(start).map((message) => ({
    ...message,
    text:
      message.text.length > MAX_MESSAGE_CHARS
        ? `${message.text.slice(0, MAX_MESSAGE_CHARS - 1)}…`
        : message.text,
  }))
}

/** Render the excerpt for the handoff instruction. */
export function formatRecentDialog(messages) {
  return messages
    .map((message) => `[${message.role === 'user' ? '用户' : '助手'} seq=${message.seq}]\n${message.text}`)
    .join('\n\n')
}
