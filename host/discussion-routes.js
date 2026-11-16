/**
 * Discussion handoff routes.
 *
 * The discussion handoff is currently implemented entirely in the browser:
 * `assets/discussion.mjs` builds the request and the client bridge opens the
 * session. The Host therefore serves no discussion endpoint yet.
 *
 * This module is the seam for the planned Host coordination surface: add route
 * descriptors here and spread them into the table in `index.js`, exactly like
 * the other `host/*-routes.js` modules. It stays empty for now so the split
 * itself changes no behaviour.
 */
export function createDiscussionRoutes() {
  return []
}
