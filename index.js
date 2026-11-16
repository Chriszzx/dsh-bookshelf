import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAudiobookService } from './audiobook.js'
import { createAppleBooksRoutes } from './host/apple-books-routes.js'
import { createAssetRoutes } from './host/assets-route.js'
import { createAudiobookRoutes } from './host/audiobook-routes.js'
import { createDiscussionRoutes } from './host/discussion-routes.js'
import { ROUTE_PREFIX, createHttp } from './host/http.js'
import { createLibraryHandlers } from './host/library.js'
import { createLinkRoutes } from './host/link-routes.js'
import { createBookkeepingRoutes, createRouteHandler } from './host/routes.js'
import { createStore } from './host/store.js'
import { createTtsRoutes, createTtsSecrets } from './host/tts-routes.js'
import { ShelfSidebarSnapshotController, sidebarSnapshotProjection, createSidebarSnapshotCommand } from './sidebar.js'
import { createTagStore } from './tags.js'
import { createTtsService } from './tts.js'

/**
 * Local bookshelf library for the DSH Web GUI.
 *
 * The Host half owns the durable library: imported files live under
 * `$DSH_HOME/bookshelf/books`, metadata lives in `$DSH_HOME/bookshelf/library.json`,
 * and a small HTTP surface under `/bookshelf` serves the shelf and the file
 * bytes the browser readers need. The browser route is local-only: the web
 * carrier binds loopback, and every response reflects a loopback Origin only.
 *
 * This entry point only composes the pieces: `host/**` holds the requests and
 * durable stores, `tts.js` and `audiobook.js` hold the speech services.
 */

export const inject = ['webServer', 'directoryPickerController', 'commands', 'sessionProjections']

export function apply(ctx, options = {}) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const rootDir = join(home, 'bookshelf')
  const assetsDir = fileURLToPath(new URL('./assets', import.meta.url))

  const http = createHttp({ webServer: ctx.webServer })
  const store = createStore({ rootDir, tagStore: createTagStore({ rootDir }), logger: ctx.logger })
  const ttsSecrets = createTtsSecrets({
    rootDir,
    getService: (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined),
  })
  const tts = createTtsService({
    rootDir,
    resolveSecret: ttsSecrets.resolveSecret,
    logger: ctx.logger,
    ...(options.tts || {}),
  })
  const audiobooks = createAudiobookService({ rootDir, tts, logger: ctx.logger })

  const library = createLibraryHandlers({ http, store, audiobooks, logger: ctx.logger })
  const appleBooks = createAppleBooksRoutes({ http, store, logger: ctx.logger })

  // Dispatch order mirrors the original Host if-chain: link and Apple Books
  // routes first, then the bookkeeping endpoints, then read-aloud and
  // audiobook routes, then the book records and finally static assets.
  const routes = [
    ...createLinkRoutes({ http, store, directoryPickerController: ctx.directoryPickerController, logger: ctx.logger }),
    ...appleBooks.routes,
    ...createBookkeepingRoutes({ http, store }),
    ...createTtsRoutes({ http, tts, secrets: ttsSecrets }),
    ...createAudiobookRoutes({ http, audiobooks, findBook: library.findBook }),
    ...createDiscussionRoutes(),
    ...library.routes,
    ...createAssetRoutes({ http, assetsDir }),
  ]
  const handler = createRouteHandler({ http, routes, logger: ctx.logger })

  // The Host composition injects both services. Tests that mount only the HTTP
  // shelf pass a minimal context, so keep the sidebar capability optional there.
  if (ctx.sessionProjections && ctx.commands) {
    const sidebarSnapshots = new ShelfSidebarSnapshotController(ctx.sessionProjections, rootDir)
    ctx.effect(() => ctx.sessionProjections.register(sidebarSnapshotProjection), 'bookshelf: sidebar snapshot projection')
    ctx.effect(() => ctx.commands.register(createSidebarSnapshotCommand(sidebarSnapshots)), 'bookshelf: sidebar snapshot command')
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
    'bookshelf: http routes',
  )
  void tts.load().catch((error) => ctx.logger.warn(error instanceof Error ? error : new Error(String(error))))
  ctx.logger.info(`bookshelf: library at ${rootDir}`)
  void appleBooks.migrateAppleLinks().catch((error) => {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  })
}
