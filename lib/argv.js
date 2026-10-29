/**
 * `/handoff` argument parsing, kept pure and separate from the command wiring so
 * flag handling (including `--latest`) is covered by unit tests.
 */

/**
 * @param {string} rawInput everything the caller typed after `/handoff `
 * @returns {{subcommand:string,taskId:string|undefined,force:boolean,latest:boolean,newTask:boolean,narrative:boolean,help:boolean}}
 */
export function parseInput(rawInput) {
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
    latest: flags.has('--latest'),
    newTask: flags.has('--new'),
    narrative: flags.has('--narrative') || flags.has('--full'),
    help: subcommand === 'help' || flags.has('--help'),
  }
}
