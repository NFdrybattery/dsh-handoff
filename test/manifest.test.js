import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'package.json')

test('package.json is BOM-free JSON', () => {
  const bytes = readFileSync(manifestPath)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  assert.equal(
    hasBom,
    false,
    'package.json must not start with a UTF-8 BOM: the host reads a bundle manifest with JSON.parse(readFileSync(file, "utf8")), ' +
      'and a BOM makes that throw, which denies the plugin row and shows "包不可用" / "Package unavailable".',
  )
  assert.doesNotThrow(() => JSON.parse(bytes.toString('utf8')))
})

test('the manifest declares a Host bundle patch that exists', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const declared = manifest.dsh?.bundle?.patch
  assert.ok(declared !== undefined, 'dsh.bundle.patch is required for a bundle')
  const files = typeof declared === 'string' ? [declared] : declared
  for (const file of files) assert.ok(existsSync(join(root, file)), `missing bundle patch file: ${file}`)
})

test('the manifest and bundle patch use the dsh-handoff name', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.name, 'dsh-handoff')
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id:\s*dsh-handoff/)
  assert.match(patch, /name:\s*'dsh-handoff'/)
})

test('locale metadata relies on the package name instead of a custom title', () => {
  for (const locale of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8'))
    assert.equal(meta.meta?.title, undefined)
    assert.equal(typeof meta.meta?.description, 'string')
  }
})

test('the manifest declares a client entry that exists', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.ok(existsSync(join(root, manifest.exports['./client'])), 'client entry declared in exports["./client"] must exist')
})

test('every module the host entry imports exists', () => {
  const entry = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  const relatives = [...entry.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1])
  assert.ok(relatives.length > 0, 'expected relative imports in lib/index.js')
  for (const relative of relatives) assert.ok(existsSync(join(root, 'lib', relative)), `missing module: ${relative}`)
})
