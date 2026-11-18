import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const npm = process.env.npm_execpath
if (!npm || basename(npm) !== 'npm-cli.js') {
  throw new Error('Run npm run pack:release from the repository root.')
}

const root = fileURLToPath(new URL('../', import.meta.url))
const { name, version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const releases = join(root, '.local', 'release')
await mkdir(releases, { recursive: true })
const staging = await mkdtemp(join(releases, '.pack-'))
try {
  execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--loglevel=error', '--pack-destination', staging], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const filename = `${name}-${version}.tgz`
  const digest = createHash('sha256').update(await readFile(join(staging, filename))).digest('hex')
  await writeFile(join(staging, `${filename}.sha256`), `${digest}  ${filename}\n`)
  const destination = join(releases, `v${version}`)
  await rename(staging, destination)
  console.log(join(destination, filename))
  console.log(join(destination, `${filename}.sha256`))
} finally {
  await rm(staging, { recursive: true, force: true })
}
