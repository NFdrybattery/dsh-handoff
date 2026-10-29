/**
 * Pure resume-candidate selection, kept separate from the command wiring so
 * the "already resumed in this session" and "unrelated draft" cases are
 * testable without a Harness process.
 */

/**
 * Pick the task a `/handoff resume` invocation should act on.
 *
 * Explicit `taskId` wins. Otherwise only `pending` tasks are candidates:
 * one is used directly, several require an explicit id. When nothing is
 * pending, a task already resumed by this session is reported as `already`
 * instead of failing on an unrelated draft row.
 *
 * @param {Array<object>} tasks index rows
 * @param {string} sessionId receiving session
 * @param {string} [requested] optional explicit task id
 * @returns {{kind:'task',task:object}|{kind:'missing',taskId:string}|{kind:'many',tasks:object[]}|{kind:'none'}|{kind:'already',task:object}}
 */
export function pickResumeTask(tasks, sessionId, requested = '') {
  const list = Array.isArray(tasks) ? tasks : []
  const id = typeof requested === 'string' ? requested.trim() : ''

  if (id.length > 0) {
    const task = list.find((entry) => entry?.taskId === id)
    return task === undefined ? { kind: 'missing', taskId: id } : { kind: 'task', task }
  }

  const pending = list.filter((entry) => entry?.status === 'pending')
  if (pending.length > 1) return { kind: 'many', tasks: pending }
  if (pending.length === 1) return { kind: 'task', task: pending[0] }

  const mine = list.filter(
    (entry) => Array.isArray(entry?.resumedBy) && typeof sessionId === 'string' && entry.resumedBy.includes(sessionId),
  )
  if (mine.length > 0) {
    const task = [...mine].sort((left, right) => String(right.resumedAt ?? '').localeCompare(String(left.resumedAt ?? '')))[0]
    return { kind: 'already', task }
  }

  return { kind: 'none' }
}
