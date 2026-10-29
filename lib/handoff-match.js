/**
 * Identity checks for a handoff document before it is injected into a new
 * Session. The brief is model-facing context; loading the wrong task's
 * document silently is worse than refusing to resume.
 */

/**
 * @param {object} options
 * @param {object} options.task index row selected for resume
 * @param {object} options.frontmatter parsed HANDOFF.md frontmatter
 * @param {object} options.facts parsed facts.json
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateHandoffMatch({ task, frontmatter, facts }) {
  const errors = []
  if (task === null || typeof task !== 'object' || typeof task.taskId !== 'string') {
    return { ok: false, errors: ['task row has no task id'] }
  }
  const taskId = task.taskId
  if (frontmatter === null || typeof frontmatter !== 'object' || frontmatter.task_id !== taskId) {
    errors.push(`HANDOFF.md task_id ${JSON.stringify(frontmatter?.task_id ?? null)} does not match ${taskId}`)
  }
  if (facts === null || typeof facts !== 'object') {
    errors.push('facts.json is not an object')
  } else if (facts.taskId !== undefined && facts.taskId !== taskId) {
    errors.push(`facts.json taskId ${JSON.stringify(facts.taskId)} does not match ${taskId}`)
  }
  if (typeof frontmatter?.status === 'string' && frontmatter.status === 'draft') {
    errors.push('HANDOFF.md is still a draft')
  }
  if (typeof task.docPath === 'string' && task.docPath !== `${taskId}/HANDOFF.md`) {
    errors.push(`index docPath ${JSON.stringify(task.docPath)} does not belong to ${taskId}`)
  }
  if (typeof task.factsPath === 'string' && task.factsPath !== `${taskId}/facts.json`) {
    errors.push(`index factsPath ${JSON.stringify(task.factsPath)} does not belong to ${taskId}`)
  }
  return { ok: errors.length === 0, errors }
}
