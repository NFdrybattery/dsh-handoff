/**
 * Model-facing tools:
 *
 *   handoff_write — render the complete HANDOFF.md from the model's narrative
 *   handoff_read  — read the document or one section back into the context
 *
 * Both tools resolve the workspace from the calling agent's session and write
 * only through `HandoffStore`, which confines every path to the workspace.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { HandoffStore } from './store.js'
import { renderDocument, splitSections } from './render.js'
import { isoLocal } from './util.js'

const SECTION_NAMES = {
  summary: 0,
  goal: 1,
  status: 2,
  done: 3,
  next: 4,
  decisions: 5,
  files: 6,
  pitfalls: 7,
  verify: 8,
  env: 9,
  questions: 10,
  related: 11,
}

const WRITE_DESCRIPTION = [
  'Write or update the workspace handoff document (HANDOFF.md) for this task.',
  'Call it after /handoff has created the skeleton: first read HANDOFF.md and facts.json, then pass the complete narrative.',
  'facts.json is authoritative for steps, touched files, commands and failures; do not invent changes that are not there.',
  'Paths in `files` are workspace-relative. The tool verifies them and marks missing/outside paths instead of failing.',
  'It writes only inside the configured handoff directory. Never put API keys, tokens, passwords or private keys in any field.',
].join(' ')

const READ_DESCRIPTION = [
  'Read this workspace handoff document or one section of it.',
  'Use it to continue an existing task without loading the whole old conversation: section=summary for the 60-second summary + next steps, next for the todo list, files for the file map, facts for the machine snapshot, all for the full document.',
  'Omit task_id to read the handoff of the current session (or the latest task when this session has none).',
].join(' ')

/**
 * Register both tools on a context that provides `tools`.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config - resolved plugin config
 */
export function registerHandoffTools(ctx, config) {
  ctx.tools.register(
    defineTool({
      name: 'handoff_write',
      description: WRITE_DESCRIPTION,
      parameters: {
        task_id: {
          type: 'string',
          description: 'Task id from /handoff. Omit it to use the current session task.',
        },
        title: {
          type: 'string',
          required: true,
          description: 'Short title of the task or work line.',
        },
        status: {
          type: 'string',
          required: true,
          enum: ['pending', 'blocked', 'done'],
          description: 'Handoff state: pending (ready to continue), blocked, or done.',
        },
        summary: {
          type: 'string',
          required: true,
          description: '60-second summary: what this task is, where it stands, and the next single action.',
        },
        goal: {
          type: 'string',
          required: true,
          description: 'The goal and requirements, including what counts as done.',
        },
        acceptance: {
          type: 'array',
          items: { type: 'string' },
          description: 'Acceptance criteria as short bullets.',
        },
        status_now: {
          type: 'string',
          required: true,
          description: 'One paragraph describing the current state and any blocker.',
        },
        progress: {
          type: 'string',
          description: 'Short progress line, e.g. "3 of 5 steps done".',
        },
        blockers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Current blockers; empty when unblocked.',
        },
        done: {
          type: 'array',
          items: { type: 'string' },
          description: 'Completed work with artifacts and verification results.',
        },
        next: {
          type: 'array',
          required: true,
          items: { type: 'string' },
          description: 'Ordered next steps. The first item becomes the "first action" in the resume brief.',
        },
        decisions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key decisions and why they were made.',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', required: true, description: 'Workspace-relative path.' },
              purpose: { type: 'string', description: 'What this file is for.' },
              state: { type: 'string', description: 'Current state, e.g. "done", "WIP", "unchanged".' },
            },
          },
          description: 'File map. When omitted, the mechanically recorded files are used.',
        },
        pitfalls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Failed attempts and traps; say explicitly what should not be retried.',
        },
        verify: {
          type: 'array',
          items: { type: 'string' },
          description: 'Commands or checks that verify the work, with expected output or baseline.',
        },
        env: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment and dependency facts (paths, versions). No secrets.',
        },
        open_questions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Questions for the user or unknowns that the next session must resolve.',
        },
        related: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related sessions, documents or links.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
            status: { type: 'string', required: true },
            first_action: { type: 'string', required: true },
            warnings: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              `Wrote ${value.bytes} bytes to ${value.path} (status: ${value.status}).\n` +
              `First action: ${value.first_action}\n` +
              (value.warnings.length > 0 ? `Warnings:\n${value.warnings.map((item) => `- ${item}`).join('\n')}` : 'No warnings.'),
          },
        ],
      },
      async execute(args, exec) {
        const session = exec.agent?.session
        if (session === undefined) throw new Error('handoff_write requires an owning agent session')
        const workspace = session.header?.cwd
        if (typeof workspace !== 'string' || workspace.length === 0) {
          throw new Error('handoff_write cannot resolve the workspace: the session has no absolute cwd')
        }
        const store = new HandoffStore({ cwd: workspace, dir: config.handoffDir, keepHistory: config.keepHistory })
        await store.init()

        const located = await locateTask(store, session, args.task_id)
        const facts = located.facts
        const narrative = normalizeNarrative(args)
        if (narrative.summary.length === 0) throw new Error('handoff_write: `summary` must not be empty')
        if (narrative.goal.length === 0) throw new Error('handoff_write: `goal` must not be empty')
        if (narrative.status_now.length === 0) throw new Error('handoff_write: `status_now` must not be empty')
        if (narrative.next.length === 0) throw new Error('handoff_write: `next` must contain at least one step')

        if (typeof args.title !== 'string' || args.title.trim().length === 0) {
          throw new Error('handoff_write: `title` must not be empty')
        }
        const title = args.title.trim()
        const warnings = []
        const { rows, warnings: fileWarnings } = await buildFileRows(store, args.files, facts)
        warnings.push(...fileWarnings)

        if (narrative.done.length === 0 && Number(facts.session?.steps) > 60) {
          warnings.push('`done` is empty although the source session is already long; the next session may repeat completed work.')
        }
        if (narrative.decisions.length === 0) warnings.push('`decisions` is empty; record at least the load-bearing choices.')
        if (narrative.pitfalls.length === 0 && Number(facts.errors?.length) > 0) {
          warnings.push('`pitfalls` is empty but facts.json records failed tool calls; say what must not be retried.')
        }
        if (Array.isArray(facts.unavailable) && facts.unavailable.length > 0) {
          warnings.push(`some projections were unavailable while facts.json was written: ${facts.unavailable.join(', ')}`)
        }

        const now = new Date()
        const status = args.status
        const statusNow = `状态：${status}。${narrative.status_now}`
        const meta = {
          taskId: located.taskId,
          title,
          status: 'pending',
          createdAt: typeof facts.generatedAt === 'string' ? facts.generatedAt : isoLocal(now),
          updatedAt: isoLocal(now),
          workspace,
          sourceSession: facts.session?.id ?? session.id,
          sourceSessionTitle: facts.session?.title ?? '',
          factsAsOfSeq: facts.asOfSeq,
          steps: facts.session?.steps ?? 0,
          turns: facts.session?.turns ?? 0,
          firstAction: narrative.next[0],
        }
        const markdown = renderDocument({
          meta,
          narrative: { ...narrative, status_now: statusNow },
          files: rows,
          commands: facts.commands ?? [],
          language: config.language,
        })

        const written = await store.writeDoc(located.taskId, markdown)
        if (written.written === false && written.previous === false) {
          // Keep this branch explicit: an identical rewrite is harmless.
        }

        const nextFacts = {
          ...facts,
          title,
          status: 'pending',
          narrative: { ...narrative, status },
          updatedAt: meta.updatedAt,
          updatedBySession: session.id,
          firstAction: narrative.next[0],
        }
        await store.writeFacts(located.taskId, nextFacts)
        await store.upsertTask({
          taskId: located.taskId,
          title,
          status: 'pending',
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          workspace,
          docPath: `${located.taskId}/HANDOFF.md`,
          factsPath: `${located.taskId}/facts.json`,
          sourceSessionId: meta.sourceSession,
          sourceSessionTitle: meta.sourceSessionTitle,
          steps: meta.steps,
          turns: meta.turns,
          firstAction: meta.firstAction,
        })

        return {
          path: store.docPath(located.taskId),
          bytes: Buffer.byteLength(markdown, 'utf8'),
          status: 'pending',
          first_action: narrative.next[0],
          warnings,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'handoff_read',
      description: READ_DESCRIPTION,
      parameters: {
        task_id: {
          type: 'string',
          description: 'Task id from /handoff. Omit it to use the current session task or the latest one.',
        },
        section: {
          type: 'string',
          enum: ['all', 'summary', 'next', 'files', 'facts', 'status', 'done', 'verify'],
          description: 'Which part to return. Defaults to all.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            content: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.content }],
      },
      async execute(args, exec) {
        const session = exec.agent?.session
        if (session === undefined) throw new Error('handoff_read requires an owning agent session')
        const workspace = session.header?.cwd
        if (typeof workspace !== 'string' || workspace.length === 0) {
          throw new Error('handoff_read cannot resolve the workspace: the session has no absolute cwd')
        }
        const store = new HandoffStore({ cwd: workspace, dir: config.handoffDir, keepHistory: config.keepHistory })
        await store.init()

        const located = await locateTask(store, session, args.task_id)
        const doc = await store.readDoc(located.taskId)
        if (doc === undefined) throw new Error(`handoff_read: HANDOFF.md is missing for task ${located.taskId}`)

        const section = typeof args.section === 'string' ? args.section : 'all'
        let content
        if (section === 'all') {
          content = doc
        } else if (section === 'facts') {
          content = JSON.stringify(located.facts, null, 2)
        } else {
          const sections = Object.values(splitSections(doc))
          if (section === 'summary') {
            content = [sections[0], sections[4]].filter(Boolean).join('\n\n')
          } else {
            const index = SECTION_NAMES[section]
            content = index === undefined ? doc : sections[index] ?? ''
          }
          if (content.length === 0) content = doc
        }
        return {
          path: store.docPath(located.taskId),
          content: content.length > 40_000 ? `${content.slice(0, 39_999)}…` : content,
        }
      },
    }),
  )
}

/** Resolve a task by explicit id, current session, or latest index row. */
async function locateTask(store, session, requested) {
  const requestedId = typeof requested === 'string' ? requested.trim() : ''
  if (requestedId.length > 0) {
    if (!(await store.taskExists(requestedId))) throw new Error(`unknown handoff task: ${requestedId}`)
    const facts = await store.readFacts(requestedId)
    if (facts === undefined) throw new Error(`handoff task ${requestedId} has no facts.json`)
    return { taskId: requestedId, facts }
  }
  const { index } = await store.readIndex()
  const current = store.findTaskForSession(index, session.id)
  const latest = index.tasks.filter((task) => task.status !== 'archived')[0]
  const task = current ?? latest
  if (task === undefined) throw new Error('no handoff document exists yet in this workspace; run /handoff first')
  const facts = await store.readFacts(task.taskId)
  if (facts === undefined) throw new Error(`handoff task ${task.taskId} has no facts.json; run /handoff again`)
  return { taskId: task.taskId, facts }
}

function normalizeNarrative(args) {
  const strings = (value) =>
    Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : []
  return {
    summary: String(args.summary ?? '').trim(),
    goal: String(args.goal ?? '').trim(),
    acceptance: strings(args.acceptance),
    status_now: String(args.status_now ?? '').trim(),
    progress: String(args.progress ?? '').trim(),
    blockers: strings(args.blockers),
    done: strings(args.done),
    next: strings(args.next),
    decisions: strings(args.decisions),
    pitfalls: strings(args.pitfalls),
    verify: strings(args.verify),
    env: strings(args.env),
    open_questions: strings(args.open_questions),
    related: strings(args.related),
    status: typeof args.status === 'string' ? args.status : 'pending',
  }
}

async function buildFileRows(store, provided, facts) {
  const rows = []
  const warnings = []
  const source =
    Array.isArray(provided) && provided.length > 0
      ? provided
      : (Array.isArray(facts.files) ? facts.files : []).map((file) => ({
          path: file.path,
          purpose: '',
          state: `writes: ${file.writes}, edits: ${file.edits}`,
        }))

  for (const raw of source.slice(0, 50)) {
    const entry = typeof raw === 'string' ? { path: raw } : raw
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string' || entry.path.trim().length === 0) {
      continue
    }
    const inspected = await store.inspectPath(entry.path)
    const stateParts = [typeof entry.state === 'string' ? entry.state.trim() : '']
    if (inspected.outside) {
      stateParts.push('[路径越界]')
      warnings.push(`file path escapes the workspace and was not checked: ${entry.path}`)
    } else if (!inspected.exists) {
      stateParts.push('[缺失]')
      warnings.push(`file does not exist (marked [缺失]): ${inspected.display || entry.path}`)
    }
    rows.push({
      path: inspected.display || entry.path,
      purpose: typeof entry.purpose === 'string' ? entry.purpose.trim() : '',
      state: stateParts.filter(Boolean).join(' '),
    })
  }

  if (rows.length === 0 && Array.isArray(facts.files) && facts.files.length > 0) {
    warnings.push('the file map is empty even though facts.json records touched files')
  }
  return { rows, warnings }
}
