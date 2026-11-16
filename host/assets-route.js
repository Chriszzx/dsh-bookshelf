import { createReadStream, promises as fs } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

import { ASSET_PREFIX, ASSET_TYPES, HttpError } from './http.js'
import { prefixRoute } from './routes.js'

// Static package assets used by the browser readers (parsers, CMaps, fonts,
// WASM). Paths are confined to the package `assets` directory.

export function createAssetRoutes({ http, assetsDir } = {}) {
  const { baseHeaders } = http

  async function sendAsset(request, response, pathname) {
    let relative
    try {
      relative = decodeURIComponent(pathname.slice(ASSET_PREFIX.length + 1))
    } catch {
      throw new HttpError(400, 'malformed asset path')
    }
    if (relative.includes('\0')) throw new HttpError(400, 'malformed asset path')
    const target = resolve(assetsDir, relative)
    if (target !== assetsDir && !target.startsWith(`${assetsDir}${sep}`)) {
      throw new HttpError(403, 'asset path outside the package')
    }
    let stat
    try {
      stat = await fs.stat(target)
    } catch {
      throw new HttpError(404, 'asset not found')
    }
    if (!stat.isFile()) throw new HttpError(404, 'asset not found')
    const extension = extname(target).toLowerCase()
    response.writeHead(200, {
      ...baseHeaders(request),
      'Content-Type': ASSET_TYPES.get(extension) || 'application/octet-stream',
      'Content-Length': stat.size,
      // Browser code is revalidated so a refreshed page picks up a changed
      // parser; large binary data (CMaps, fonts, WASM) stays cacheable.
      'Cache-Control': extension === '.mjs' || extension === '.js' ? 'no-cache' : 'public, max-age=3600',
    })
    const stream = createReadStream(target)
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  }

  return [
    prefixRoute(`${ASSET_PREFIX}/`, {
      GET: (request, response, context) => sendAsset(request, response, context.url.pathname),
    }),
  ]
}
