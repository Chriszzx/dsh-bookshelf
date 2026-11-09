import { promises as fs } from 'node:fs'

// Windows requires SeCreateSymbolicLinkPrivilege for fs.symlink. Developer Mode
// grants it, but an ordinary process without it gets EPERM/EACCES. A copy keeps
// folder import usable there without asking the user to elevate or reboot.
const LINK_FALLBACK_CODES = new Set(['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'UNKNOWN'])

export function shouldCopyOnLinkFailure(error, platform = process.platform) {
  return (
    platform === 'win32' &&
    error !== null &&
    typeof error === 'object' &&
    LINK_FALLBACK_CODES.has(error.code)
  )
}

/**
 * Create the shelf link for one source file. Returns `symlink` when the native
 * link was created, or `copy` when Windows denied the link and the bytes were
 * copied instead. The copy is staged next to the target and renamed, so a
 * failed or interrupted fallback never leaves a partial book file behind.
 */
export async function createSourceLink(source, target, options = {}) {
  const platform = options.platform ?? process.platform
  const symlink = options.symlink ?? fs.symlink
  try {
    await symlink(source, target, 'file')
    return 'symlink'
  } catch (error) {
    if (!shouldCopyOnLinkFailure(error, platform)) throw error
  }
  const copyFile = options.copyFile ?? fs.copyFile
  const rename = options.rename ?? fs.rename
  const unlink = options.unlink ?? fs.unlink
  const temporary = `${target}.copy`
  await copyFile(source, temporary)
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return 'copy'
}
