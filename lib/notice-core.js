/**
 * Pure threshold decision for the handoff reminder. Kept separate from the
 * event wiring so the banding rules can be tested without a Harness process.
 */

/**
 * @param {{steps:number,tokens:number,window:number}} metrics
 * @param {{remindAfterSteps:number,remindEverySteps:number,remindAfterTokens:number}} config
 * @param {Set<string>} delivered already-delivered band keys for one session
 * @returns {{key:string,text:string}|undefined}
 */
export function nextReminder(metrics, config, delivered) {
  const steps = Number(metrics?.steps) || 0
  const tokens = Number(metrics?.tokens) || 0
  const window = Number(metrics?.window) || 0

  if (steps >= config.remindAfterSteps) {
    const band = Math.floor(steps / config.remindEverySteps) * config.remindEverySteps
    const key = `steps:${band}`
    if (!delivered.has(key)) {
      const context =
        tokens > 0 && window > 0
          ? `（上下文约 ${Math.round(tokens / 1000)}k/${Math.round(window / 1000)}k）`
          : tokens > 0
            ? `（上下文约 ${Math.round(tokens / 1000)}k）`
            : ''
      return {
        key,
        text:
          `本会话已 ${steps} 步${context}。建议现在执行 /handoff 生成交接文档，` +
          `然后在新会话用 /handoff resume 继续；若继续当前会话，注意后续改动准确率会下降。`,
      }
    }
  }

  if (config.remindAfterTokens > 0 && tokens >= config.remindAfterTokens) {
    const key = 'tokens'
    if (!delivered.has(key)) {
      return {
        key,
        text:
          `本会话上下文压力约 ${Math.round(tokens / 1000)}k token` +
          `${window > 0 ? `（窗口 ${Math.round(window / 1000)}k）` : ''}。` +
          `建议执行 /handoff 生成交接文档，并在新会话用 /handoff resume 继续。`,
      }
    }
  }

  return undefined
}
