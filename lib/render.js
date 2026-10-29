/**
 * Markdown rendering for HANDOFF.md and the resume brief.
 *
 * Pure functions: existence checks for the file map happen before rendering,
 * so the output is deterministic and unit-testable.
 */

import { clamp, firstLine, toPosixPath } from './util.js'

export const HANDOFF_VERSION = 1

const LABELS = {
  zh: {
    title: '任务交接',
    sections: [
      '0. 60 秒摘要',
      '1. 目标与需求 / 验收标准',
      '2. 当前状态',
      '3. 已完成',
      '4. 待办与下一步',
      '5. 关键决策与理由',
      '6. 文件地图',
      '7. 坑与失败尝试',
      '8. 验证方式与命令',
      '9. 环境与依赖',
      '10. 未决问题',
      '11. 相关会话与资料',
    ],
    none: '无',
    todo: '> TODO(模型补写)',
    first: '第一件事',
    next: '接下来',
    status: '当前状态',
    progress: '进度',
    blockers: '阻塞',
    fileTableHead: '| 路径 | 作用 | 状态 |',
    fileTableSep: '| --- | --- | --- |',
    acceptance: '**验收标准**',
    brief: {
      head: '【交接续接】',
      sep: '：',
      id: 'ID',
      source: '来源',
      scale: '规模',
      updated: '更新',
      state: '状态',
      progress: '进度',
      doc: '文档',
      facts: '事实',
      first: '第一件事',
      next: '接下来',
      rule: '规则',
      ruleText: '完整读文档与 facts.json；先 git status 核对工作区；未确认前不要改文件。',
    },
  },
  en: {
    title: 'Task handoff',
    sections: [
      '0. 60-second summary',
      '1. Goal and acceptance criteria',
      '2. Current state',
      '3. Completed',
      '4. Next steps',
      '5. Key decisions',
      '6. File map',
      '7. Pitfalls and failed attempts',
      '8. Verification',
      '9. Environment and dependencies',
      '10. Open questions',
      '11. Related sessions and references',
    ],
    none: 'None',
    todo: '> TODO(write this section)',
    first: 'First action',
    next: 'Next',
    status: 'Current state',
    progress: 'Progress',
    blockers: 'Blockers',
    fileTableHead: '| Path | Purpose | State |',
    fileTableSep: '| --- | --- | --- |',
    acceptance: '**Acceptance criteria**',
    brief: {
      head: '[Handoff resume]',
      sep: ': ',
      id: 'ID',
      source: 'Source',
      scale: 'Size',
      updated: 'Updated',
      state: 'State',
      progress: 'Progress',
      doc: 'Document',
      facts: 'Facts',
      first: 'First action',
      next: 'Next',
      rule: 'Rules',
      ruleText: 'Read the document and facts completely; run git status first; do not modify files before confirmation.',
    },
  },
}

/** Labels for the configured document language, defaulting to Chinese. */
export function labelsFor(language) {
  return language === 'en' ? LABELS.en : LABELS.zh
}

/** YAML-safe scalar: JSON strings for strings, plain for numbers/booleans. */
function yamlScalar(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(String(value ?? ''))
}

function listOrNone(items, none) {
  const values = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
  if (values.length === 0) return none
  return values.map((item) => `- ${item.trim()}`).join('\n')
}

function numbered(items, none) {
  const values = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
  if (values.length === 0) return none
  return values.map((item, index) => `${index + 1}. ${item.trim()}`).join('\n')
}

function tableCell(value) {
  return toPosixPath(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function fileTable(rows, labels) {
  if (!Array.isArray(rows) || rows.length === 0) return labels.none
  const lines = [labels.fileTableHead, labels.fileTableSep]
  for (const row of rows) {
    lines.push(`| \`${tableCell(row.path)}\` | ${tableCell(row.purpose ?? '')} | ${tableCell(row.state ?? '')} |`)
  }
  return lines.join('\n')
}

function frontmatter(meta) {
  const fields = [
    ['handoff_version', HANDOFF_VERSION],
    ['task_id', meta.taskId],
    ['title', meta.title],
    ['status', meta.status],
    ['created_at', meta.createdAt],
    ['updated_at', meta.updatedAt],
    ['workspace', meta.workspace],
    ['source_session', meta.sourceSession],
    ['source_session_title', meta.sourceSessionTitle ?? ''],
    ['facts_as_of_seq', meta.factsAsOfSeq ?? -1],
    ['steps', meta.steps ?? 0],
    ['turns', meta.turns ?? 0],
    ['first_action', meta.firstAction ?? ''],
  ]
  return ['---', ...fields.map(([key, value]) => `${key}: ${yamlScalar(value)}`), '---'].join('\n')
}

function headingBlock(index, labels, body) {
  return `## ${labels.sections[index]}\n\n${body}`
}

/**
 * Render the mechanically prefilled draft written by `/handoff`.
 *
 * @param {object} options
 * @param {object} options.meta - frontmatter fields (status `draft`).
 * @param {object} options.facts - facts snapshot.
 * @param {Array<{path,purpose,state}>} options.files - checked file rows.
 * @param {string} [options.language] - `zh` or `en`.
 */
export function renderDraft({ meta, facts, files, language = 'zh' }) {
  const labels = labelsFor(language)
  const errors = Array.isArray(facts.errors) ? facts.errors : []
  const commands = Array.isArray(facts.commands) ? facts.commands : []
  const completedTodos = (facts.todos ?? []).filter((todo) => todo.status === 'completed')
  const failed = errors.slice(-5).map((error) => `seq ${error.seq} · \`${error.tool}\`：${error.summary}`)
  const recentOk = commands
    .filter((command) => command.ok)
    .slice(-5)
    .map((command) => `seq ${command.seq}：\`${clamp(command.text, 160)}\``)

  const summary = [
    labels.todo,
    '',
    language === 'en'
      ? `Mechanical snapshot: ${facts.session?.turns ?? 0} turns / ${facts.session?.steps ?? 0} steps, ${files.length} touched files, ${errors.length} failed tool calls.`
      : `机械摘要：本会话 ${facts.session?.turns ?? 0} 轮 / ${facts.session?.steps ?? 0} 步，记录到 ${files.length} 个被修改文件、${errors.length} 条失败工具调用。`,
  ].join('\n')

  const parts = [
    frontmatter({ ...meta, status: 'draft' }),
    '',
    `# ${labels.title}：${meta.title}`,
    '',
    headingBlock(0, labels, summary),
    '',
    headingBlock(
      1,
      labels,
      `${labels.todo}\n\n${facts.goal?.objective ? `- 现有目标：${facts.goal.objective}` : labels.none}`,
    ),
    '',
    headingBlock(
      2,
      labels,
      [
        language === 'en'
          ? 'Status: draft — the skeleton is written, narrative sections are waiting for the current session model.'
          : '状态：draft —— 骨架已生成，叙事章节等待当前会话模型补齐。',
        '',
        `- ${labels.progress}：${facts.session?.steps ?? 0} steps`,
        `- ${labels.blockers}：${errors.length > 0 ? `${errors.length} failed tool calls (see section 7)` : labels.none}`,
      ].join('\n'),
    ),
    '',
    headingBlock(
      3,
      labels,
      completedTodos.length > 0 ? completedTodos.map((todo) => `- ${todo.content}`).join('\n') : `${labels.todo}\n\n${labels.none}`,
    ),
    '',
    headingBlock(
      4,
      labels,
      `${labels.todo}\n\n- ${labels.first}：${language === 'en' ? 'read facts.json and finish this document with handoff_write' : '读取 facts.json，调用 handoff_write 补齐本交接文档'}`,
    ),
    '',
    headingBlock(5, labels, labels.todo),
    '',
    headingBlock(6, labels, fileTable(files, labels)),
    '',
    headingBlock(7, labels, listOrNone(failed, labels.none)),
    '',
    headingBlock(8, labels, `${labels.todo}\n\n${listOrNone(recentOk, labels.none)}`),
    '',
    headingBlock(
      9,
      labels,
      [
        `- workspace: \`${meta.workspace}\``,
        `- platform: ${process.platform} ${process.arch}`,
        `- node: ${process.version}`,
        `- generated: ${meta.createdAt}`,
      ].join('\n'),
    ),
    '',
    headingBlock(10, labels, labels.todo),
    '',
    headingBlock(
      11,
      labels,
      [
        `- source session: \`${meta.sourceSession}\``,
        `- document: \`${meta.taskId}/HANDOFF.md\``,
        `- facts: \`${meta.taskId}/facts.json\``,
      ].join('\n'),
    ),
    '',
  ]
  return parts.join('\n')
}

/**
 * Build a complete, model-free narrative from the mechanical facts. This is
 * the fast path: the document is immediately resumable, without waiting for a
 * model turn to read two files and write ten sections.
 *
 * @param {object} options
 * @param {object} options.facts - facts snapshot.
 * @param {Array<{path,purpose,state}>} options.files - checked file rows.
 * @param {object} options.meta - frontmatter fields.
 * @param {string} [options.language] - `zh` or `en`.
 * @returns {object} narrative compatible with `renderDocument`.
 */
export function mechanicalNarrative({ facts, files, meta, language = 'zh' }) {
  const english = language === 'en'
  const errors = Array.isArray(facts.errors) ? facts.errors : []
  const commands = Array.isArray(facts.commands) ? facts.commands : []
  const todos = Array.isArray(facts.todos) ? facts.todos : []
  const lastAssistant = facts.recentAssistantMessages?.at(-1)?.text ?? ''
  const first = (facts.firstAction ?? '').trim()
  const steps = facts.session?.steps ?? 0
  const turns = facts.session?.turns ?? 0

  const summary = []
  if (first) summary.push(english ? `Starting request: ${clamp(first, 240)}` : `起始需求：${clamp(first, 240)}`)
  summary.push(
    english
      ? `Mechanical progress: ${turns} turns / ${steps} steps, ${files.length} touched files, ${errors.length} failed tool calls.`
      : `机械进度：${turns} 轮 / ${steps} 步，${files.length} 个被修改文件，${errors.length} 个失败工具调用。`,
  )
  if (lastAssistant) {
    summary.push(english ? `Latest model output: ${clamp(lastAssistant, 700)}` : `最近一次模型输出：${clamp(lastAssistant, 700)}`)
  }

  const completed = todos
    .filter((todo) => todo?.status === 'completed' && typeof todo.content === 'string')
    .map((todo) => (english ? `Completed: ${todo.content}` : `已完成：${todo.content}`))
  const touched = files
    .slice(0, 8)
    .map((file) => (english ? `Touched \`${file.path}\` (${file.state})` : `修改 \`${file.path}\`（${file.state}）`))

  return {
    summary: summary.join('\n\n'),
    goal: facts.goal?.objective
      ? facts.goal.objective
      : first || (english ? 'No goal was recorded; verify with the user before continuing.' : '未记录明确目标；继续前请与用户核对。'),
    acceptance: [],
    status_now: english
      ? `A mechanical handoff is ready and can be resumed immediately. It was generated from the session log without a model turn, so narrative decisions may be missing.`
      : `机械交接已生成，可直接续接。它由会话日志自动生成，没有经过模型叙事，因此关键决策等内容可能缺失。`,
    progress: `${steps} steps`,
    blockers: errors.length > 0 ? [english ? `${errors.length} failed tool calls (see section 7)` : `${errors.length} 个失败工具调用（见第 7 节）`] : [],
    done: [...completed, ...touched],
    next: [
      english ? 'Review the workspace, then continue from the latest model output and the file map.' : '先核对工作区现状，再从最近一次模型输出和文件地图继续。',
      english ? 'Read facts.json for exact steps, commands and failures.' : '读取 facts.json 获取准确的步数、命令和失败记录。',
      english ? 'Run /handoff --narrative when a model-written summary is needed.' : '如需模型叙事的完整总结，执行 /handoff --narrative。',
    ],
    decisions: [],
    pitfalls: errors.slice(-8).map((error) => `seq ${error.seq} · \`${error.tool}\`：${error.summary}`),
    verify: commands
      .filter((command) => command.ok)
      .slice(-5)
      .map((command) => `seq ${command.seq}: \`${clamp(command.text, 160)}\``),
    env: [
      `workspace: ${meta.workspace}`,
      `platform: ${process.platform} ${process.arch}`,
      `node: ${process.version}`,
      `generated: ${meta.createdAt}`,
    ],
    open_questions: [
      english
        ? 'This is a mechanical handoff; run /handoff --narrative if model-written reasoning is required.'
        : '这是机械版交接；如需模型叙事的推理，执行 /handoff --narrative。',
    ],
    related: [
      `source session: \`${meta.sourceSession}\``,
      `document: \`${meta.taskId}/HANDOFF.md\``,
      `facts: \`${meta.taskId}/facts.json\``,
    ],
    status: 'pending',
  }
}

/**
 * Render the fast, model-free handoff document.
 */
export function renderMechanical({ meta, facts, files, language = 'zh' }) {
  const narrative = mechanicalNarrative({ facts, files, meta, language })
  return {
    markdown: renderDocument({
      meta: { ...meta, status: 'pending', firstAction: narrative.next[0] },
      narrative,
      files,
      commands: facts.commands ?? [],
      language,
    }),
    narrative,
  }
}

/**
 * Render the completed document from the model's narrative.
 *
 * @param {object} options
 * @param {object} options.meta - frontmatter fields (status from `narrative.status`).
 * @param {object} options.narrative - model-provided sections.
 * @param {Array<{path,purpose,state}>} options.files - checked file rows.
 * @param {Array<{text,ok,seq}>} [options.commands] - recent commands for section 8.
 * @param {string} [options.language] - `zh` or `en`.
 */
export function renderDocument({ meta, narrative, files, commands = [], language = 'zh' }) {
  const labels = labelsFor(language)
  const verifyItems = [...(narrative.verify ?? [])]
  const okCommands = commands
    .filter((command) => command.ok)
    .slice(-3)
    .map((command) => `seq ${command.seq}: \`${clamp(command.text, 160)}\``)
  const verify = [...new Set([...verifyItems, ...okCommands])]
  const blockers = Array.isArray(narrative.blockers) ? narrative.blockers.filter(Boolean) : []
  const blockerLines =
    blockers.length === 0
      ? [`- ${labels.blockers}：${labels.none}`]
      : [`- ${labels.blockers}：`, ...blockers.map((item) => `  - ${item}`)]

  const parts = [
    frontmatter({ ...meta, status: meta.status ?? 'pending' }),
    '',
    `# ${labels.title}：${meta.title}`,
    '',
    headingBlock(0, labels, (narrative.summary ?? '').trim() || labels.none),
    '',
    headingBlock(
      1,
      labels,
      [
        (narrative.goal ?? '').trim() || labels.none,
        '',
        labels.acceptance,
        '',
        listOrNone(narrative.acceptance, labels.none),
      ].join('\n'),
    ),
    '',
    headingBlock(
      2,
      labels,
      [
        (narrative.status_now ?? '').trim() || labels.none,
        '',
        `- ${labels.progress}：${(narrative.progress ?? '').trim() || labels.none}`,
        ...blockerLines,
      ].join('\n'),
    ),
    '',
    headingBlock(3, labels, listOrNone(narrative.done, labels.none)),
    '',
    headingBlock(
      4,
      labels,
      [
        ...(narrative.next ?? []).map((item, index) => `${index + 1}. ${item}`),
        '',
        `**${labels.first}**：${(narrative.next ?? [])[0] ?? labels.none}`,
      ].join('\n'),
    ),
    '',
    headingBlock(5, labels, listOrNone(narrative.decisions, labels.none)),
    '',
    headingBlock(6, labels, fileTable(files, labels)),
    '',
    headingBlock(7, labels, listOrNone(narrative.pitfalls, labels.none)),
    '',
    headingBlock(8, labels, listOrNone(verify, labels.none)),
    '',
    headingBlock(9, labels, listOrNone(narrative.env, labels.none)),
    '',
    headingBlock(10, labels, listOrNone(narrative.open_questions, labels.none)),
    '',
    headingBlock(11, labels, listOrNone(narrative.related, labels.none)),
    '',
  ]
  return parts.join('\n')
}

/**
 * Render the injected resume brief, capped to `maxChars`.
 */
export function renderBrief({ task, facts, narrative, docPath, factsPath, maxChars = 2400, language = 'zh' }) {
  const labels = labelsFor(language).brief
  const oneLine = (value, max) => clamp(String(value ?? '').replace(/\s+/g, ' ').trim(), max)
  const firstSentence = (value) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    const match = text.match(/^[^。！？]*[。！？]/) ?? text.match(/^.*?[.!?](?=\s|$)/)
    return match?.[0] ?? text
  }
  const next = Array.isArray(narrative?.next) ? narrative.next.filter((item) => typeof item === 'string' && item.trim()) : []
  const firstAction = oneLine(next[0] ?? task.firstAction ?? '—', 140)
  const statusNow = oneLine(firstSentence((narrative?.status_now ?? '').trim() || task.status || 'pending'), 160)
  const progress = oneLine((narrative?.progress ?? '').trim() || '—', 80)
  const sourceTitle = typeof task.sourceSessionTitle === 'string' ? task.sourceSessionTitle.trim() : ''
  const source = `${task.sourceSessionId ?? '—'}${sourceTitle.length > 0 ? ` · ${oneLine(sourceTitle, 60)}` : ''}`
  const followUps = next.slice(1, 4)
  const sep = labels.sep
  const stepUnit = language === 'en' ? 'steps' : '步'
  const turnUnit = language === 'en' ? 'turns' : '轮'
  const lines = [
    `${labels.head} ${oneLine(task.title ?? task.taskId, 80)}`,
    `${labels.id}${sep}${task.taskId} · ${labels.state}${sep}${statusNow}`,
    `${labels.source}${sep}${source}`,
    `${labels.scale}${sep}${facts?.session?.steps ?? task.steps ?? 0} ${stepUnit} / ${facts?.session?.turns ?? task.turns ?? 0} ${turnUnit} · ${labels.updated}${sep}${task.updatedAt ?? '—'}`,
    `${labels.progress}${sep}${progress}`,
    `${labels.doc}${sep}${docPath}`,
    ...(factsPath ? [`${labels.facts}${sep}${factsPath}（asOf seq ${facts?.asOfSeq ?? '—'}）`] : []),
    `${labels.first}${sep}${firstAction}`,
    `${labels.next}${sep}`,
    ...(followUps.length > 0 ? followUps.map((item, index) => `${index + 1}. ${oneLine(item, 120)}`) : ['—']),
    `${labels.rule}${sep}${labels.ruleText}`,
  ]
  return clamp(lines.join('\n'), maxChars)
}

/**
 * Split a HANDOFF.md into frontmatter and `## heading` sections.
 */
export function splitSections(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  const sections = {}
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const match = /^## (.+?)\s*$/.exec(line)
    if (match) {
      current = match[1]
      sections[current] = []
    } else if (current !== null) {
      sections[current].push(line)
    }
  }
  const compact = {}
  for (const [key, value] of Object.entries(sections)) compact[key] = value.join('\n').trim()
  return compact
}

export { firstLine }
