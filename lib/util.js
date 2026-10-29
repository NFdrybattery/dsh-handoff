/**
 * Small, dependency-free helpers shared by the handoff modules.
 *
 * Everything here is synchronous and side-effect free so it can be unit
 * tested with plain `node --test`, without a running Harness.
 */

import { relative as relativePath } from 'node:path'

/** Replace credential-looking fragments before text enters facts or a brief. */
export function redactSecrets(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  let out = text
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]',
  )
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
  out = out.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
  out = out.replace(
    /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*)\s*[:=]\s*(["']?)([^\s"'`]+)\2/gi,
    '$1=***',
  )
  return out
}

/** Concatenate the text blocks of a message content array. */
export function textFromContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/** First non-empty line, trimmed to `max` characters. */
export function firstLine(text, max = 160) {
  if (typeof text !== 'string') return ''
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return clamp(trimmed, max)
  }
  return ''
}

/** Keep at most `max` characters, marking a cut with an ellipsis. */
export function clamp(text, max) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  if (!Number.isFinite(max) || max <= 0) return ''
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + '…'
}

/** Parse a tool call's JSON argument string into an object, or return `{}`. */
export function parseArguments(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || value.length === 0) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** First string value among the given keys. */
export function pickString(object, keys) {
  if (object === null || typeof object !== 'object') return undefined
  for (const key of keys) {
    if (typeof object[key] === 'string' && object[key].length > 0) return object[key]
  }
  return undefined
}

/** Local-time ISO-8601 timestamp with an explicit UTC offset. */
export function isoLocal(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  )
}

/** `YYYYMMDD-HHmm` used in task ids. */
export function stampCompact(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

/** `YYYYMMDD-HHmmss` used for history file names. */
export function stampFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${stampCompact(date)}${pad(date.getSeconds())}`
}

/** ASCII-only slug safe inside a directory name; empty when the title has none. */
export function slugify(title) {
  if (typeof title !== 'string') return ''
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  return slug
}

/** Normalize a user/model supplied path to forward slashes. */
export function toPosixPath(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

/** Whether `target` is `root` or lies inside it (both absolute, native spelling). */
export function isInside(root, target) {
  const rel = relativePath(root, target)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel))
}
