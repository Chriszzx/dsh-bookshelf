// Print the browser regression log a failed CI job (or a local run) left
// behind. The workflow calls this before uploading the artifact so the tail is
// visible without downloading anything.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const directory = process.argv[2] || '.local/browser'
if (!existsSync(directory)) {
  console.log(`No browser log at ${directory}`)
  process.exit(0)
}
for (const file of readdirSync(directory).sort()) {
  const lines = readFileSync(join(directory, file), 'utf8').split('\n')
  console.log(`\n--- ${file} (last 100 lines) ---`)
  console.log(lines.slice(-100).join('\n'))
}
