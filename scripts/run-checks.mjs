import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Use this Node executable directly: Desktop may supply pnpm as a JS entry
// without putting a pnpm executable on PATH. Keep the unit-suite list here.
const tasks = {
  syntax: ['scripts/check-syntax.mjs'],
  unit: ['--test',
    'tests/manifest.mjs', 'tests/sidebar-snapshot.mjs', 'tests/discussion-bridge.mjs',
    'tests/platform-compatibility.mjs', 'tests/link-fallback.mjs', 'tests/link-import-mode.mjs',
    'tests/reading-fonts.mjs',
  ],
  browser: ['tests/run-browser.mjs'],
}
const mode = process.argv[2] || 'all'
if (mode !== 'all' && !Object.hasOwn(tasks, mode)) throw new Error(`Unknown check mode: ${mode}`)
for (const task of mode === 'all' ? Object.keys(tasks) : [mode]) {
  console.log(`\nRunning ${task} checks`)
  const result = spawnSync(process.execPath, tasks[task], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
