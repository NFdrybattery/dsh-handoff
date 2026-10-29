import test from 'node:test'
import assert from 'node:assert/strict'
import { labelsFor, renderBrief, renderDocument, renderMechanical, splitSections } from '../lib/render.js'

const meta = {
  taskId: '20261029-1705',
  title: 'Long session handoff',
  status: 'draft',
  createdAt: '2026-10-29T17:05:00+08:00',
  updatedAt: '2026-10-29T17:06:00+08:00',
  workspace: 'C:\\ws',
  sourceSession: 'session-1',
  sourceSessionTitle: 'Long session handoff',
  factsAsOfSeq: 42,
  steps: 812,
  turns: 96,
  firstAction: 'Build the plugin',
}

const facts = {
  session: { turns: 96, steps: 812 },
  asOfSeq: 42,
  firstAction: 'Build the plugin',
  recentAssistantMessages: [{ seq: 40, text: 'The store and tests are in place.' }],
  goal: { objective: 'Ship dsh-handoff' },
  todos: [{ content: 'write tests', status: 'completed' }],
  files: [{ path: 'src/a.ts', writes: 2, edits: 3 }],
  commands: [{ seq: 10, text: 'npm test', ok: true }],
  errors: [{ seq: 11, tool: 'pwsh', summary: 'exit code 1' }],
}

test('mechanical handoff renders all twelve sections without a model turn', () => {
  const { markdown, narrative } = renderMechanical({
    meta,
    facts,
    files: [{ path: 'src/a.ts', purpose: 'entry', state: 'writes: 2' }],
    language: 'zh',
  })
  assert.ok(markdown.startsWith('---\n'))
  assert.ok(markdown.includes('handoff_version: 1'))
  assert.ok(markdown.includes('task_id: "20261029-1705"'))
  assert.ok(markdown.includes('status: "pending"'))
  for (const label of labelsFor('zh').sections) assert.ok(markdown.includes(`## ${label}`), label)
  assert.ok(markdown.includes('| `src/a.ts` | entry | writes: 2 |'))
  assert.ok(markdown.includes('seq 11'))
  assert.ok(markdown.includes('最近一次模型输出'))
  assert.ok(!markdown.includes('TODO(模型补写)'))
  assert.equal(narrative.status, 'pending')
  assert.ok(narrative.next[0].includes('核对工作区'))
})

test('final document renders narrative sections and first action', () => {
  const narrative = {
    summary: 'A handoff plugin for long sessions.',
    goal: 'Make continuation cheap.',
    acceptance: ['a', 'b'],
    status_now: 'Core is implemented.',
    progress: '80%',
    blockers: ['client UI pending'],
    done: ['store', 'tests'],
    next: ['run end-to-end test', 'publish'],
    decisions: ['host-only first'],
    pitfalls: ['do not use absolute paths'],
    verify: ['npm test'],
    env: ['Node 24'],
    open_questions: ['GitHub repo name?'],
    related: ['session-1'],
    status: 'pending',
  }
  const markdown = renderDocument({
    meta: { ...meta, status: 'pending' },
    narrative,
    files: [{ path: 'src/a.ts', purpose: 'entry', state: 'done' }],
    commands: [{ seq: 10, text: 'npm test', ok: true }],
    language: 'zh',
  })
  assert.ok(markdown.includes('status: "pending"'))
  assert.ok(markdown.includes('Core is implemented.'))
  assert.ok(markdown.includes('**第一件事**：run end-to-end test'))
  assert.ok(markdown.includes('client UI pending'))
  assert.ok(markdown.includes('npm test'))
  assert.ok(!markdown.includes('TODO(模型补写)'))
})

test('brief is capped and carries the required fields', () => {
  const brief = renderBrief({
    task: {
      taskId: '20261029-1705',
      title: 'Long session handoff',
      sourceSessionId: 'session-1',
      sourceSessionTitle: 'Old session',
      steps: 812,
      turns: 96,
      status: 'pending',
      updatedAt: '2026-10-29T17:06:00+08:00',
    },
    facts: { asOfSeq: 42, session: { steps: 812, turns: 96 } },
    narrative: { status_now: 'Core done', progress: '80%', next: ['first', 'second', 'third'] },
    docPath: 'C:\\ws\\.dsh\\handoff\\20261029-1705\\HANDOFF.md',
    factsPath: 'C:\\ws\\.dsh\\handoff\\20261029-1705\\facts.json',
    maxChars: 2400,
    language: 'zh',
  })
  assert.ok(brief.length <= 2400)
  assert.ok(brief.includes('【交接续接】'))
  assert.ok(brief.includes('ID：20261029-1705'))
  assert.ok(brief.includes('文档：'))
  assert.ok(brief.includes('事实：'))
  assert.ok(brief.includes('第一件事：first'))
  assert.ok(brief.includes('HANDOFF.md'))
  assert.ok(brief.includes('进度：80%'))
  assert.ok(brief.includes('规则：'))
  assert.ok(!brief.includes('undefined'))
})

test('splitSections returns headings in order', () => {
  const sections = splitSections('---\na: 1\n---\n\n# T\n\n## A\n\nalpha\n\n## B\n\nbeta\n')
  assert.deepEqual(Object.keys(sections), ['A', 'B'])
  assert.equal(sections.A, 'alpha')
  assert.equal(sections.B, 'beta')
})
