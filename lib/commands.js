/**
 * The `/handoff` command family.
 *
 * Commands own the human-facing workflow:
 *
 *   /handoff                 → facts + draft skeleton, then ask the model to finish it
 *   /handoff update          → same (explicit spelling)
 *   /handoff status          → inspect the current task line
 *   /handoff list            → list tasks in this workspace
 *   /handoff resume [id]     → inject a resume brief into this session
 *   /handoff archive <id>    → hide a task from resume candidates
 *   /handoff --new           → start a new task line
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { HandoffStore, parseFrontmatter } from './store.js'
import { buildFactsSnapshot, foldSessionEvents, readFactsState, DEFAULT_FACT_LIMITS } from './facts.js'
import { renderBrief, renderDraft } from './render.js'
import { pickResumeTask } from './resume-select.js'
import { isoLocal } from './util.js'

const COMMAND_NAME = 'handoff'
const SOURCE_KIND = 'plugin:dsh-handoff'

const USAGE = [
  '/handoff                   生成/更新当前任务的交接文档',
  '/handoff status            查看当前任务状态',
  '/handoff list              列出本工作区的交接任务',
  '/handoff resume [taskId]   在新会话中接续（带 taskId 可指定）',
  '/handoff archive <taskId>  归档一个任务线',
  '/handoff --new             新开一条任务线',
].join('\n')

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config resolved plugin config
 */
export function registerHandoffCommands(ctx, config) {
  ctx.commands.register({
    name: COMMAND_NAME,
    description:
      'Create or continue a workspace handoff document: /handoff writes the document, /handoff resume continues it in a new session.',
    input: { hint: '[status|list|resume [taskId]|archive <taskId>] [--new]' },
    async handler(invocation) {
      try {
        const session = invocation.agent?.session
        if (session === undefined) return { kind: 'error', text: '/handoff requires an owning agent session' }
        const workspace = session.header?.cwd
        if (typeof workspace !== 'string' || workspace.length === 0) {
          return { kind: 'error', text: '/handoff cannot resolve the workspace: this session has no absolute cwd' }
        }
        const parsed = parseInput(invocation.rawInput)
        if (parsed.help) return { kind: 'success', text: USAGE }

        const store = new HandoffStore({
          cwd: workspace,
          dir: config.handoffDir,
          keepHistory: config.keepHistory,
        })
        await store.init()

        switch (parsed.subcommand) {
          case 'status':
            return await commandStatus(store, session)
          case 'list':
            return await commandList(store)
          case 'resume':
            return await commandResume({ ctx, config, store, invocation, session, parsed })
          case 'archive':
            return await commandArchive(store, parsed)
          case 'update':
            return await commandWrite({ ctx, config, store, invocation, session, parsed })
          default:
            return {
              kind: 'error',
              text: `未知子命令 "${parsed.subcommand}"。\n${USAGE}`,
            }
        }
      } catch (error) {
        return { kind: 'error', text: `handoff: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

function parseInput(rawInput) {
  const tokens = String(rawInput ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const flags = new Set(tokens.filter((token) => token.startsWith('--')))
  const words = tokens.filter((token) => !token.startsWith('--'))
  const subcommand = (words[0] ?? 'update').toLowerCase()
  return {
    subcommand,
    taskId: words[1],
    force: flags.has('--force'),
    newTask: flags.has('--new'),
    help: subcommand === 'help' || flags.has('--help'),
  }
}

async function commandWrite({ ctx, config, store, invocation, session, parsed }) {
  const facts = await collectFacts(ctx, session, config)
  const { index } = await store.readIndex()
  const existing = parsed.newTask ? undefined : store.findTaskForSession(index, session.id)
  const title = chooseTitle(facts, existing)
  const taskId = existing?.taskId ?? (await store.allocateTaskId(title))
  const now = new Date()
  const createdAt = existing?.createdAt ?? isoLocal(now)
  facts.taskId = taskId
  facts.title = title
  facts.status = 'draft'
  facts.generatedAt = isoLocal(now)
  facts.workspace = store.cwd

  const files = await draftFileRows(store, facts)
  const meta = {
    taskId,
    title,
    status: 'draft',
    createdAt,
    updatedAt: isoLocal(now),
    workspace: store.cwd,
    sourceSession: session.id,
    sourceSessionTitle: facts.session?.title ?? '',
    factsAsOfSeq: facts.asOfSeq,
    steps: facts.session?.steps ?? 0,
    turns: facts.session?.turns ?? 0,
    firstAction: facts.firstAction ?? '',
  }
  const markdown = renderDraft({ meta, facts, files, language: config.language })

  await store.writeDoc(taskId, markdown)
  await store.writeFacts(taskId, facts)
  await store.upsertTask({
    taskId,
    title,
    status: 'draft',
    createdAt,
    updatedAt: meta.updatedAt,
    workspace: store.cwd,
    docPath: `${taskId}/HANDOFF.md`,
    factsPath: `${taskId}/facts.json`,
    sourceSessionId: session.id,
    sourceSessionTitle: meta.sourceSessionTitle,
    steps: meta.steps,
    turns: meta.turns,
    firstAction: meta.firstAction,
  })

  const docPath = store.docPath(taskId)
  const factsPath = store.factsPath(taskId)
  let followupOk = false
  let followupError
  try {
    invocation.agent.followup(
      createUserMessage({
        content: [
          {
            type: 'text',
            text:
              `[dsh-handoff] 交接骨架已写到 ${docPath}，机械事实在 ${factsPath}（截至 seq ${facts.asOfSeq}）。` +
              `请先读这两份文件，然后调用 handoff_write 补齐全部叙事章节；每条事实以 facts.json 为准，不要臆造未发生的改动；` +
              `无法确定的写进「未决问题」。task_id=${taskId}。`,
          },
        ],
        source: { kind: SOURCE_KIND, form: 'notice', summary: `handoff write ${taskId}` },
      }),
    )
    followupOk = true
  } catch (error) {
    followupError = error instanceof Error ? error.message : String(error)
  }

  const lines = [
    `交接骨架已生成：${docPath}`,
    `机械事实：${factsPath}（${meta.steps} 步 / ${meta.turns} 轮 / ${facts.files?.length ?? 0} 个被修改文件）`,
    `任务：${taskId}（status: draft）`,
    followupOk
      ? '已把「补齐叙事」作为一次后续请求交给当前模型；完成后文档状态会变为 pending。'
      : `自动补齐请求未能发出（${followupError ?? 'unknown'}）。请手动对模型说：按 HANDOFF.md 骨架补齐交接文档。`,
    '查看进度：/handoff status',
  ]
  return { kind: 'success', text: lines.join('\n') }
}

async function commandStatus(store, session) {
  const { index, warning } = await store.readIndex()
  const task = store.findTaskForSession(index, session.id) ?? index.tasks[0]
  if (task === undefined) {
    return { kind: 'success', text: '本工作区还没有交接文档。执行 /handoff 生成第一份。' }
  }
  const facts = await store.readFacts(task.taskId)
  const doc = await store.readDoc(task.taskId)
  const frontmatter = doc === undefined ? {} : parseFrontmatter(doc)
  const lines = [
    `任务：${task.taskId}`,
    `标题：${task.title}`,
    `状态：${task.status}${frontmatter.status !== undefined && frontmatter.status !== task.status ? `（文档：${frontmatter.status}）` : ''}`,
    `更新：${task.updatedAt ?? '—'}`,
    `规模：${facts?.session?.steps ?? task.steps ?? 0} 步 / ${facts?.session?.turns ?? task.turns ?? 0} 轮`,
    `文档：${store.docPath(task.taskId)}`,
    `事实：${store.factsPath(task.taskId)}（asOfSeq ${facts?.asOfSeq ?? '—'}）`,
    `接续：${Array.isArray(task.resumedBy) && task.resumedBy.length > 0 ? `${task.resumedBy.length} 次` : '尚未被接续'}`,
  ]
  if (frontmatter.status === 'draft') lines.push('提示：文档仍是 draft，等待当前会话模型补齐；可再次执行 /handoff 重试。')
  if (warning !== undefined) lines.push(`告警：${warning}`)
  return { kind: 'success', text: lines.join('\n') }
}

async function commandList(store) {
  const { index, warning } = await store.readIndex()
  if (index.tasks.length === 0) return { kind: 'success', text: '本工作区还没有交接文档。' }
  const lines = ['本工作区交接任务（按更新时间倒序）：']
  for (const task of index.tasks.slice(0, 20)) {
    lines.push(
      `- [${task.status}] ${task.taskId} — ${task.title}（${task.steps ?? 0} 步，更新 ${task.updatedAt ?? '—'}）` +
        ` → ${task.docPath ?? `${task.taskId}/HANDOFF.md`}`,
    )
  }
  if (index.tasks.length > 20) lines.push(`… 其余 ${index.tasks.length - 20} 条已省略`)
  const pending = index.tasks.filter((task) => task.status === 'pending')
  lines.push('', pending.length > 0 ? `待接续：${pending.length} 条（在新会话执行 /handoff resume）` : '待接续：0 条')
  if (warning !== undefined) lines.push(`告警：${warning}`)
  return { kind: 'success', text: lines.join('\n') }
}

async function commandResume({ config, store, invocation, session, parsed }) {
  const { index } = await store.readIndex()
  const picked = pickResumeTask(index.tasks, session.id, parsed.taskId)

  if (picked.kind === 'missing') {
    return { kind: 'error', text: `没有找到交接任务：${picked.taskId}` }
  }
  if (picked.kind === 'many') {
    return {
      kind: 'error',
      text:
        '有多个待接续任务，请带 taskId 再执行：\n' +
        picked.tasks
          .map((entry) => `- ${entry.taskId} — ${entry.title}（${entry.steps ?? 0} 步，${entry.updatedAt ?? ''}）`)
          .join('\n'),
    }
  }
  if (picked.kind === 'none') {
    return { kind: 'error', text: '没有待接续文档。先执行 /handoff 生成，再用 /handoff list 查看。' }
  }
  if (picked.kind === 'already') {
    return { kind: 'success', text: alreadyResumedText(store, picked.task) }
  }

  const task = picked.task
  if (task.status === 'draft') {
    return { kind: 'error', text: `任务 ${task.taskId} 仍是 draft；请在原会话用 /handoff 补齐后再接续。` }
  }
  if (task.status === 'archived') {
    return { kind: 'error', text: `任务 ${task.taskId} 已归档；如需接续请先取消归档（手工改 index.json）。` }
  }

  const already = Array.isArray(task.resumedBy) && task.resumedBy.includes(session.id)
  if (already && !parsed.force) {
    return { kind: 'success', text: alreadyResumedText(store, task) }
  }

  const facts = await store.readFacts(task.taskId)
  if (facts === undefined) return { kind: 'error', text: `任务 ${task.taskId} 缺少 facts.json；请回原会话重新 /handoff。` }
  const doc = await store.readDoc(task.taskId)
  if (doc === undefined) {
    return { kind: 'error', text: `任务 ${task.taskId} 缺少 HANDOFF.md；请回原会话执行 /handoff update。` }
  }

  const brief = renderBrief({
    task,
    facts,
    narrative: facts.narrative,
    docPath: store.docPath(task.taskId),
    factsPath: store.factsPath(task.taskId),
    maxChars: config.resumeBriefMaxChars,
    language: config.language,
  })

  invocation.agent.inject(
    createUserMessage({
      content: [{ type: 'text', text: brief }],
      source: { kind: SOURCE_KIND, form: 'notice', summary: `handoff resume ${task.taskId}` },
    }),
  )

  const now = isoLocal()
  await store.updateTask(task.taskId, {
    status: 'resumed',
    resumedAt: now,
    resumedBy: [...new Set([...(task.resumedBy ?? []), session.id])],
  })
  await store.appendResumeLog(task.taskId, {
    at: now,
    sessionId: session.id,
    title: facts.session?.title ?? '',
  })

  const firstAction = String(facts.narrative?.next?.[0] ?? task.firstAction ?? '').trim() || '按 HANDOFF.md 执行'
  return {
    kind: 'success',
    text: [
      `已接手任务：${task.taskId} — ${task.title}`,
      `接续摘要（${brief.length} 字）已注入，但不会自动开始新一轮；这是正常现象。`,
      `现在在输入框发送任意消息，模型就会带着摘要继续。第一件事：${firstAction}`,
      `完整文档：${store.docPath(task.taskId)}`,
      `提示：动手前先读 HANDOFF.md；完成一个阶段后回到本会话或原会话执行 /handoff 更新。`,
    ].join('\n'),
  }
}

function alreadyResumedText(store, task) {
  return [
    `本会话已经接手过 ${task.taskId}（${task.title}）。`,
    '接续摘要已在会话上下文中，直接发送消息即可继续，不需要重复执行 /handoff resume。',
    `如需重新注入：/handoff resume ${task.taskId} --force`,
    `文档：${store.docPath(task.taskId)}`,
  ].join('\n')
}

async function commandArchive(store, parsed) {
  const taskId = typeof parsed.taskId === 'string' ? parsed.taskId.trim() : ''
  if (taskId.length === 0) return { kind: 'error', text: '用法：/handoff archive <taskId>' }
  const { index } = await store.readIndex()
  const task = index.tasks.find((entry) => entry.taskId === taskId)
  if (task === undefined) return { kind: 'error', text: `没有找到交接任务：${taskId}` }
  await store.updateTask(taskId, { status: 'archived', updatedAt: isoLocal() })
  return { kind: 'success', text: `已归档 ${taskId}（${task.title}）。它不会再出现在 /handoff resume 候选中。` }
}

async function collectFacts(ctx, session, config) {
  const limits = {
    ...DEFAULT_FACT_LIMITS,
    maxUserMessages: config.maxUserMessages,
    maxAssistantMessages: config.maxAssistantMessages,
    maxCommandLog: config.maxCommandLog,
    maxErrors: config.maxErrors,
  }
  let state = readFactsState(ctx, session)
  if (state === undefined) {
    let events = []
    try {
      events = session.snapshotEvents?.() ?? []
    } catch {
      events = []
    }
    state = foldSessionEvents(events, limits)
  }
  const registry = safeRegistry(ctx)
  const getProjection = (key) => {
    try {
      return registry?.stateOf?.(session, key)
    } catch {
      return undefined
    }
  }
  return buildFactsSnapshot({ state, session, getProjection })
}

function safeRegistry(ctx) {
  try {
    return ctx?.sessionProjections ?? ctx?.get?.('sessionProjections')
  } catch {
    return undefined
  }
}

function chooseTitle(facts, existing) {
  if (typeof existing?.title === 'string' && existing.title.trim().length > 0 && existing.title !== existing.taskId) {
    return existing.title
  }
  if (typeof facts.title === 'string' && facts.title.trim().length > 0) return facts.title.trim()
  if (typeof facts.firstAction === 'string' && facts.firstAction.trim().length > 0) {
    return facts.firstAction.trim().slice(0, 80)
  }
  return `任务交接 ${isoLocal().slice(0, 10)}`
}

async function draftFileRows(store, facts) {
  const rows = []
  for (const file of facts.files ?? []) {
    const inspected = await store.inspectPath(file.path)
    const state = inspected.exists ? `writes: ${file.writes}, edits: ${file.edits}` : 'writes: 0, edits: 0 [缺失]'
    rows.push({ path: inspected.display || file.path, purpose: '', state })
  }
  return rows
}
