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
import { parseInput } from './argv.js'
import {
  buildFactsSnapshot,
  foldSessionEvents,
  readFactsState,
  resolveProjectionRegistry,
  DEFAULT_FACT_LIMITS,
} from './facts.js'
import { buildHandoffInstruction } from './instruction.js'
import { renderBrief, splitSections } from './render.js'
import { pickResumeTask } from './resume-select.js'
import { isoLocal } from './util.js'

const COMMAND_NAME = 'handoff'
const SOURCE_KIND = 'plugin:handover'

const USAGE = [
  '/handoff                   向当前模型发送交接指令，由它写出 HANDOFF.md',
  '/handoff status            查看当前任务状态',
  '/handoff list              列出本工作区的交接任务',
  '/handoff resume [taskId]   在新会话中接续（--latest 取最新，--wake 立即唤醒模型）',
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
    input: { hint: '[status|list|resume [taskId]|archive <taskId>] [--new] [--latest] [--wake]' },
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
        })
        await store.init()
        // Migrate away from facts.json/history/resume-log: HANDOFF.md is the
        // only per-task content file from this version on.
        await store.pruneAllLegacy().catch(() => {})

        // Lazy retention: every command run is a cleanup point, so stale task
        // folders do not accumulate just because no timer is mounted.
        if (config.retentionDays > 0) {
          try {
            const cleanup = await store.cleanupExpired({ retentionMs: config.retentionDays * 86_400_000 })
            for (const warning of cleanup.warnings) ctx.logger?.warn?.(`[handover] ${warning}`)
          } catch (error) {
            ctx.logger?.warn?.(`[handover] cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

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

async function commandWrite({ ctx, config, store, invocation, session, parsed }) {
  const facts = await collectFacts(ctx, session, config)
  const { index } = await store.readIndex()
  const existing = parsed.newTask ? undefined : store.findTaskForSession(index, session.id)
  const title = chooseTitle(facts, existing)
  const taskId = existing?.taskId ?? (await store.allocateTaskId(title))
  const now = new Date()
  const createdAt = existing?.createdAt ?? isoLocal(now)
  const updatedAt = isoLocal(now)
  const steps = facts.session?.steps ?? 0
  const turns = facts.session?.turns ?? 0
  const docPath = store.docPath(taskId)

  await store.ensureTaskDir(taskId)
  await store.pruneLegacy(taskId)
  await store.upsertTask({
    taskId,
    title,
    status: 'pending',
    createdAt,
    updatedAt,
    workspace: store.cwd,
    docPath: `${taskId}/HANDOFF.md`,
    sourceSessionId: session.id,
    sourceSessionTitle: facts.session?.title ?? '',
    steps,
    turns,
    firstAction: facts.firstAction ?? '',
  })

  const instruction = buildHandoffInstruction({
    taskId,
    title,
    createdAt,
    updatedAt,
    workspace: store.cwd,
    sourceSession: session.id,
    steps,
    turns,
    docPath,
  })

  let sent = false
  let errorText
  try {
    invocation.agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: instruction }],
        source: { kind: SOURCE_KIND, form: 'notice', summary: `handoff write ${taskId}` },
      }),
    )
    sent = true
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error)
  }

  return {
    kind: sent ? 'success' : 'error',
    text: sent
      ? [
          `交接指令已发送给当前模型，文档将写到：${docPath}`,
          `任务：${taskId}（等待模型写完，写完后 /handoff resume 或一键交接才能读取）`,
          `来源会话：${session.id} · ${steps} 步 / ${turns} 轮`,
        ].join('\n')
      : `交接指令发送失败：${errorText ?? 'unknown'}`,
  }
}

async function commandStatus(store, session) {
  const { index, warning } = await store.readIndex()
  const task = store.findTaskForSession(index, session.id) ?? index.tasks[0]
  if (task === undefined) {
    return { kind: 'success', text: '本工作区还没有交接文档。执行 /handoff 生成第一份。' }
  }
  const doc = await store.readDoc(task.taskId)
  const frontmatter = doc === undefined ? {} : parseFrontmatter(doc)
  const lines = [
    `任务：${task.taskId}`,
    `标题：${task.title}`,
    `状态：${task.status}${frontmatter.status !== undefined && frontmatter.status !== task.status ? `（文档：${frontmatter.status}）` : ''}`,
    `更新：${task.updatedAt ?? '—'}`,
    `规模：${task.steps ?? 0} 步 / ${task.turns ?? 0} 轮`,
    `文档：${store.docPath(task.taskId)}${doc === undefined ? '（尚未生成）' : ''}`,
    `接续：${Array.isArray(task.resumedBy) && task.resumedBy.length > 0 ? `${task.resumedBy.length} 次` : '尚未被接续'}`,
  ]
  if (doc === undefined) lines.push('提示：交接指令已发送，但模型还没写出文档；等它写完再 resume。')
  else if (frontmatter.status === 'draft') lines.push('提示：文档仍是 draft，等待当前会话模型补齐。')
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
  const picked = pickResumeTask(index.tasks, session.id, parsed.taskId, {
    latest: parsed.latest === true,
    latestTaskId: index.latestTaskId,
  })

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
          .join('\n') +
        '\n（或直接用 /handoff resume --latest 接续更新时间最新的一条）',
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

  const doc = await store.readDoc(task.taskId)
  if (doc === undefined) {
    return { kind: 'error', text: `任务 ${task.taskId} 的 HANDOFF.md 尚未生成；请等旧会话模型写完后重试。` }
  }
  const frontmatter = parseFrontmatter(doc)
  if (frontmatter.task_id !== task.taskId) {
    return {
      kind: 'error',
      text: `交接文档不匹配：HANDOFF.md 的 task_id 是 ${JSON.stringify(frontmatter.task_id ?? null)}，当前任务是 ${task.taskId}。`,
    }
  }
  if (frontmatter.status === 'draft') {
    return { kind: 'error', text: `任务 ${task.taskId} 的文档仍是 draft；请等模型写完或重新执行 /handoff。` }
  }

  const narrative = narrativeFromDoc(doc, frontmatter, task)
  const facts = {
    session: {
      steps: Number(frontmatter.steps) || task.steps || 0,
      turns: Number(frontmatter.turns) || task.turns || 0,
    },
  }
  const brief = renderBrief({
    task,
    facts,
    narrative,
    docPath: store.docPath(task.taskId),
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

  if (parsed.wake) {
    try {
      invocation.agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: wakeInstruction(config.language) }],
          source: { kind: SOURCE_KIND, form: 'notice', summary: `handoff takeover ${task.taskId}` },
        }),
      )
    } catch (error) {
      return {
        kind: 'error',
        text: `交接摘要已注入，但自动唤醒模型失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
    return {
      kind: 'success',
      text: `已载入交接摘要，模型开始按 HANDOFF.md 接手（${brief.length} 字摘要）。`,
    }
  }

  const firstAction = String(narrative?.next?.[0] ?? task.firstAction ?? '').trim() || '按 HANDOFF.md 执行'
  return {
    kind: 'success',
    text: [
      `已接手任务：${task.taskId} — ${task.title}`,
      ...(picked.latest === true
        ? ['当时有多条待接续任务，已按更新时间最新的一条接续；要指定其他任务用 /handoff resume <taskId>。']
        : []),
      `接续摘要（${brief.length} 字）已注入，但不会自动开始新一轮；这是正常现象。`,
      `现在在输入框发送任意消息，模型就会带着摘要继续。第一件事：${firstAction}`,
      `完整文档：${store.docPath(task.taskId)}`,
      `提示：动手前先读 HANDOFF.md；完成一个阶段后回到本会话或原会话执行 /handoff 更新。`,
    ].join('\n'),
  }
}

function wakeInstruction(language) {
  if (language === 'en') {
    return [
      'Take over using section 12 ("Takeover reply format") of HANDOFF.md:',
      'read the whole document first, then output only the six Markdown list items.',
      'Do not run commands, do not modify files, and do not read the old Session by default.',
      'If section 12 is absent, reply with six one-line items: [Takeover], [State], [Next], [Key file], [Verify], [Confirm].',
    ].join('\n')
  }
  return [
    '请按 HANDOFF.md 第 12 节「新会话接手回复格式」接手：',
    '先完整读文档，然后只输出 6 个 Markdown 列表项；不要执行命令、不要改文件、不要默认读旧会话。',
    '如果文档没有第 12 节，按【接手】【状态】【下一步】【关键文件】【验证】【待确认】六项各一行回复。',
  ].join('\n')
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
  const registry = resolveProjectionRegistry(ctx)
  const getProjection = (key) => {
    try {
      return registry?.stateOf?.(session, key)
    } catch {
      return undefined
    }
  }
  return buildFactsSnapshot({ state, session, getProjection })
}

function narrativeFromDoc(doc, frontmatter, task) {
  const sections = Object.values(splitSections(doc))
  const statusBlock = sections[2] ?? ''
  const statusLine = statusBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('-') && !line.startsWith('#'))
  const progress = /(?:进度|Progress)[：:]\s*(.+)/.exec(statusBlock)?.[1]?.trim()
  const next = [...(sections[4] ?? '').matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((match) => match[1].trim())
  return {
    status_now: statusLine ?? frontmatter.status ?? task.status ?? 'pending',
    progress: progress ?? '—',
    next: next.length > 0 ? next : [frontmatter.first_action ?? task.firstAction ?? '—'],
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
