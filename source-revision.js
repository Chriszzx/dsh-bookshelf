import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Keep this small contract identical in the bookshelf and Books packages.
export const SOURCE_LIMITS = Object.freeze({ maxFiles: 5000, maxBytes: 256 * 1024 * 1024 });
const changed = () => new Error('Bookshelf source changed while fingerprinting.');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Hash registered source bytes only; callers resolve bookshelf membership first. */
export async function sourceRevision(file) {
  const root = await realpath(file);
  const first = await stat(root);
  const budget = { files: 0, bytes: 0 };
  async function hashFile(path) {
    if (++budget.files > SOURCE_LIMITS.maxFiles) throw new Error('Bookshelf source exceeds the file limit.');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new Error('Bookshelf source is not a regular file.');
      if (budget.bytes + before.size > SOURCE_LIMITS.maxBytes) throw new Error('Bookshelf source exceeds the byte limit.');
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let count = 0;
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        count += bytesRead;
        budget.bytes += bytesRead;
        if (budget.bytes > SOURCE_LIMITS.maxBytes) throw new Error('Bookshelf source exceeds the byte limit.');
        hash.update(buffer.subarray(0, bytesRead));
      }
      if (count !== before.size || !same(before, await handle.stat()) || !same(before, await stat(path))) throw changed();
      return hash.digest('hex');
    } finally { await handle.close(); }
  }
  let result;
  if (first.isFile()) result = `shelf-file-v1:${await hashFile(root)}`;
  else if (first.isDirectory()) {
    async function inventory(directory, prefix = '') {
      const paths = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) paths.push(...await inventory(join(directory, entry.name), relative));
        else if (entry.isFile()) paths.push(relative);
        if (paths.length > SOURCE_LIMITS.maxFiles) throw new Error('Bookshelf source exceeds the file limit.');
      }
      return paths.sort();
    }
    const files = await inventory(root);
    const hash = createHash('sha256');
    for (const relative of files) hash.update(`${JSON.stringify([relative, await hashFile(join(root, relative))])}\n`);
    if (JSON.stringify(files) !== JSON.stringify(await inventory(root))) throw changed();
    result = `shelf-directory-v1:${hash.digest('hex')}`;
  } else throw new Error('Bookshelf source must be an EPUB file or directory.');
  if (await realpath(file) !== root || !same(first, await stat(root))) throw changed();
  return result;
}
