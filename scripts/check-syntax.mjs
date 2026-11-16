import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = [
  'index.js', 'client.js', 'sidebar.js', 'apple-books.js', 'link-source.js', 'tags.js', 'tts.js',
  'source-revision.js', 'assets/reading-fonts.mjs', 'assets/epub.mjs', 'assets/discussion.mjs', 'assets/reading-snapshot.mjs', 'assets/tts-sentences.mjs',
]
async function collect(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const relative = join(directory, entry.name)
    if (entry.isDirectory()) await collect(relative)
    else if (/\.m?js$/.test(entry.name)) files.push(relative)
  }
}
// Optional module trees appear as the refactor lands; missing ones are skipped
// so this check keeps working in either half of a parallel branch.
for (const directory of ['scripts', 'tests', 'host', 'tts', 'assets/lib', 'assets/locales']) {
  try {
    await collect(directory)
  } catch (error) {
    if (error && error.code === 'ENOENT') continue
    throw error
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(`Syntax checks passed: ${files.length} project and test modules.`)
