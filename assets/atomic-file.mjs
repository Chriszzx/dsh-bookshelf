import { rename as renameFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// Windows scanners can briefly deny replacing an otherwise writable file.
// Retry the atomic rename itself; retain both files on permanent failure.
export async function replaceFile(source, target, {
  platform = process.platform,
  rename = renameFile,
  sleep = delay,
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt >= 6) throw error
      await sleep(25 * 2 ** attempt)
    }
  }
}
