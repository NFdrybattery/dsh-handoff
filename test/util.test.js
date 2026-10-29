import test from 'node:test'
import assert from 'node:assert/strict'
import { clamp, firstLine, isoLocal, parseArguments, redactSecrets, slugify, stampCompact, taskCreatedAt, textFromContent } from '../lib/util.js'

test('redactSecrets removes common credential shapes', () => {
  const input = [
    'export TOKEN=sk-abcdefgh12345678',
    'Authorization: Bearer abcdefgh12345678',
    'API_KEY=supersecretvalue',
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n')
  const output = redactSecrets(input)
  assert.ok(!output.includes('sk-abcdefgh12345678'))
  assert.ok(!output.includes('abcdefgh12345678'))
  assert.ok(!output.includes('supersecretvalue'))
  assert.ok(!output.includes('MIIEowIBAAKCAQEA'))
  assert.ok(output.includes('TOKEN=***'))
  assert.ok(output.includes('Bearer ***'))
  assert.ok(output.includes('API_KEY=***'))
})

test('textFromContent keeps only text blocks', () => {
  assert.equal(
    textFromContent([
      { type: 'text', text: ' hello ' },
      { type: 'image', source: {} },
      { type: 'text', text: 'world' },
      null,
    ]),
    'hello \nworld',
  )
  assert.equal(textFromContent(undefined), '')
})

test('clamp and firstLine are bounded', () => {
  assert.equal(clamp('abcdef', 4), 'abc…')
  assert.equal(clamp('abc', 4), 'abc')
  assert.equal(clamp('abc', 0), '')
  assert.equal(firstLine('\n\n  hello world  \nsecond', 8), 'hello w…')
  assert.equal(firstLine('   '), '')
})

test('slugify drops non-ASCII characters', () => {
  assert.equal(slugify('Long Session Handoff!'), 'long-session-handoff')
  assert.equal(slugify('长会话交接'), '')
  assert.equal(slugify('  A  B  '), 'a-b')
})

test('parseArguments tolerates invalid JSON', () => {
  assert.deepEqual(parseArguments('{"a":1}'), { a: 1 })
  assert.deepEqual(parseArguments('{bad'), {})
  assert.deepEqual(parseArguments('[]'), {})
  assert.deepEqual(parseArguments(null), {})
})

test('timestamps are local ISO strings and compact ids', () => {
  const date = new Date(2026, 9, 29, 17, 5, 9)
  assert.match(isoLocal(date), /^2026-10-29T17:05:09[+-]\d{2}:\d{2}$/)
  assert.equal(stampCompact(date), '20261029-1705')
})

test('taskCreatedAt keeps the original task birthday on updates', () => {
  assert.equal(
    taskCreatedAt('2026-10-29T18:02:24+08:00', '2026-10-29T19:09:09+08:00'),
    '2026-10-29T18:02:24+08:00',
  )
  assert.equal(taskCreatedAt(undefined, '2026-10-29T19:09:09+08:00'), '2026-10-29T19:09:09+08:00')
  assert.equal(taskCreatedAt('  ', ''), isoLocal(new Date()))
  const date = new Date(2026, 9, 29, 17, 5, 9)
  assert.equal(taskCreatedAt('', '', date), isoLocal(date))
})
