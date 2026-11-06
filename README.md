# Bookshelf — DSH plugin

A local bookshelf panel for the DSH Web GUI. It adds a **书架 / Bookshelf** entry to the
left sidebar above the Workspace browser; selecting it opens the shelf in the main
panel. Books are linked from local folders or Apple Books under `$DSH_HOME/bookshelf`,
so the library does not depend on browser storage and survives page reloads and restarts.
This is a desktop DSH plugin; reading pagination is tuned for desktop windows and
keyboard/mouse navigation, not mobile or touch layouts.

## Features

- Link EPUB and PDF books from a folder chosen through the native folder
  picker. Imports are soft links: the shelf never copies or deletes originals.
- Import EPUB and PDF books from the local Apple Books library, with search,
  download availability, and duplicate detection against the shelf. Apple
  Books imports are soft links too (EPUB source folders are packed on demand).
- Cover grid with extracted EPUB covers (and a typographic fallback), title,
  author, reading progress, and delete. The format badge sits at the cover's
  top-left, delete at the top-right, and a more menu at the bottom-right with
  one rename action for title and author.
- Search by title, author, or file name; sort by recently added, recently read,
  title, or author.
- Reading progress and bookmarks per book, stored on the Host so they survive
  reloads, restarts, and browser-storage changes.
- Switching between the bookshelf and other DSH main panels preserves the open
  book, shelf search/sort, and shelf scroll position within the loaded client.
  Reopening waits for pending per-book saves before restoring reading progress.
  The reader's Back button explicitly returns to the shelf; a full Web-page
  reload starts at the shelf, with per-book progress still stored on the Host.
- Shelf-level default reading settings for EPUB (typeface, size, line height,
  page margins, theme, and scroll/paged mode) behind a settings button next to
  **Import**. Defaults are stored on the Host and apply to books that do not
  yet have individual settings; per-book settings still win.
- PDF reading with PDF.js: fit-page, fit-width, and 25%–300% custom zoom,
  lazy page rendering, a live page counter, previous/next page buttons and
  keyboard paging, page bookmarks, and progress restore. Fit-page uses the
  current page's aspect, so mixed portrait/landscape/tall pages each fit;
  fit mode and single-page/continuous layout persist per book, and both keep
  the current page across resize and reopen.
- EPUB 2/3 reading: scroll or paged mode, spine chapters, the book's navigation
  document or NCX TOC, chapter navigation, progress bar with seeking, bookmarks,
  per-book typography (font, size, line height, page margins: 8px fill /
  32px compact / 40px standard on each side, with compact matching DSH's
  32px content clearance), page themes
  (auto, light, dark), and an immersive/fullscreen reading mode. Paged
  mode uses CSS multi-column layout with text anchors; each page turn advances
  one actual reading viewport and horizontal trackpad scrolling cannot leave a
  partial page. Experimental **Auto two-page / Always single** layout uses the
  actual reading area and text size: auto needs at least 24em per column and
  eight available lines. Two-page mode turns a spread and displays page ranges;
  an odd chapter tail has an unnumbered blank partner. The choice is stored per
  book or as a shelf default. Container resize, typography changes and TOC
  toggles retain the same text anchor across reflows. The toolbar shows the **full-book** page
  (a hidden iframe measures every chapter with the current layout), recomputed
  on resize, while progress remains percentage based.
  Tall images, wide tables, code blocks, footnotes/cross-page links, and
  cover/blank chapters have explicit handling; page labels use `aria-live`
  and turn buttons expose keyboard shortcuts.
- Localized UI (English and Chinese) through the Client locale service.
- **页面讨论 / Discuss this page** (EPUB only): freeze the currently visible
  text, choose a workspace, create a fresh native DSH conversation, write the
  page to `.dsh-bookshelf/<snapshotId>.md` in that workspace, and place an
  `@file` reference in the new composer without sending anything. The user
  writes the actual question and submits it. The Books tab in the right sidebar
  shows the same page statically. Workspace choice is explicit; the original
  reading position, pagination and the rest of the book remain independent.

## Page discussion and Books

The **Discuss this page** toolbar button captures only text that is actually
visible in the current reading viewport (single page, two-page spread, or
scroll mode). Images, off-page content and generated content are not included;
offset semantics are rendered-DOM text, not canonical EPUB/CFI coordinates, and
the capture is explicitly not a complete physical page. PDFs do not show this
button.

The handoff is one operation. A preset workspace can be chosen in **Bookshelf
settings**; when one is set, the button freezes the page and jumps straight to a
new conversation there, skipping the picker (choose **Ask every time** to keep
the picker). DSH creates a new conversation under an operation-owned identity,
and this plugin's Host verifies that the snapshot still matches the raw linked EPUB
bytes. It then writes the rendered visible text to
`.dsh-bookshelf/<snapshotId>.md` inside the conversation workspace and records a
display-only snapshot in the session projection. No message is sent, no hidden
context is injected, and no initialization turn is created. The shelf writes a
persisted composer draft before opening the conversation: a localized starting
instruction plus `@.dsh-bookshelf/<id>.md`, with the file as a reference chip.
The user edits that prompt, adds the actual question, and sends it manually. The
draft is also mirrored as a one-time composer-dock seed, so a runtime that does
not restore the persisted draft still shows the file reference.

The temp file begins with the original book address, the shelf soft link, and a
bilingual instruction asking the model to confirm three choices before answering:
whether to use web/network tools, whether to read the whole book, and whether to
use its own world knowledge. The captured page follows that preamble. The file
is an `@file` reference, not an uploaded attachment. Its contents are not
inlined into the model context; the model must call `read` when it needs the
page. The conversation remains a native blank session until the user sends
the first message, so the ordinary "new conversation" flow may reuse it while
it is empty; this is accepted for this flow. Files are retained under the
workspace's `.dsh-bookshelf/` directory for the draft and later reference, and
are not automatically deleted.

The right sidebar's **Books (Shelf)** tab is registered by this plugin itself;
no external Books plugin is required for page discussion or the static
sidebar. It is intentionally a static view: no Apple Books detection, no
page-turn controls, no auto-sync, and no infinite surrounding text. **回书架阅读 / Continue in bookshelf** returns to the shelf and reopens
the same book at its saved reading position. A failed creation or page-file
preparation keeps the exact pending snapshot and target session so retrying
reuses the same file and conversation instead of creating another. If the page
Navigation changes during the operation, the saved conversation and its
composer seed remain available from the conversation list. Closing and
reopening a conversation restores the preserved snapshot from its session log,
even if the source EPUB has moved or changed.

## Apple Books import

The shelf can read the local Apple Books library without modifying it. This
import is **macOS only**; on Windows the button and setting are hidden and the
Host rejects the route. On macOS it is enabled by default (toggle it under
Bookshelf settings). Open the **Apple Books** button in the shelf header,
search the library, and import a downloaded EPUB or PDF. Listing reads only metadata. A selected book is linked
on explicit import; Apple Books keeps EPUB sources as unpacked directories, so
the Host repacks the folder into an EPUB on each file request rather than
copying the book into the shelf.

If the picker reports that the library is unavailable, grant DSH **Full Disk
Access** in System Settings → Privacy & Security. Books that are not downloaded
show as unavailable. A book already on the shelf with the same Apple Books
asset, or the same format/title/author, is marked as already imported.

The imported record stores a `link` to the source and a symbolic link under
`books/`; deleting the shelf entry removes only the link, cover copy, and reading
state. The source book is never deleted or modified.

## Platform compatibility

| Platform | Shelf, readers and Books (Shelf) sidebar | Apple Books import |
|---|---|---|
| macOS | Supported | Available; enabled by default and can be turned off in Bookshelf settings |
| Windows | Supported | Hidden and unavailable |
| Linux | Not declared in `package.json` | Hidden |

The package declares `os: ["darwin", "win32"]`. The core bookshelf, EPUB/PDF
readers and page-snapshot sidebar are platform-neutral; only the Apple Books
import is macOS-specific. On Windows the Host routes return `501` and the
client hides the Apple Books button and its setting. On macOS the feature is
on by default; turning it off hides the button until it is re-enabled in
Bookshelf settings.

## Scope

The reader targets **desktop DSH**: area-based EPUB pages (CSS multi-column +
text anchors), PDF.js fitting and paging, keyboard/mouse navigation, and a
static page-snapshot sidebar. Mobile/touch layouts, page-turn animation,
WebView/Safari compatibility, headless fullscreen acceptance, and a
progress-bar current-page highlight are out of scope. Fullscreen is intended
for interactive desktop use; immersive mode is covered by tests.

## Privacy

The plugin does not send book data to a network service and contains no
telemetry. It reads local book files and, only when you explicitly import from
Apple Books, local Apple Books metadata. Reading progress and page snapshots
live in DSH's local session log; a page file is created under
`.dsh-bookshelf/` in the selected workspace and can be deleted at any time.
The Books sidebar does not put book text into a model context until you send a
message in that conversation, and a model can only read the referenced file if
its tools are permitted to do so.

## Development

The pure Host/bridge tests need only Node:

```text
node --test tests/sidebar-snapshot.mjs tests/discussion-bridge.mjs tests/platform-compatibility.mjs
```

The browser regressions need Chrome and React UMD fixtures. Set
`BOOKSHELF_TEST_FIXTURES` to a directory containing
`node_modules/react/umd/react.development.js` and
`node_modules/react-dom/umd/react-dom.development.js`; set `CHROME_BIN` if
Chrome is not at its default macOS path. Run `node tests/pagination-geometry.mjs`,
`node tests/tab-persistence.mjs`, `node tests/reading-snapshot.mjs`, or
`node tests/discussion-handoff.mjs`. They use isolated temporary homes and
Chrome profiles and do not touch a personal library.

## Third-party notices

The plugin's own source is MIT-licensed ([LICENSE](LICENSE)). Bundled PDF.js
JavaScript, CMaps, standard fonts, and WebAssembly assets retain their upstream
notices under [`assets/licenses`](assets/licenses), [`assets/wasm`](assets/wasm),
and [`assets/standard_fonts`](assets/standard_fonts). ZIP handling uses
[`assets/fflate.mjs`](assets/fflate.mjs); see
[`assets/licenses/FFLATE-LICENSE`](assets/licenses/FFLATE-LICENSE). The PDF.js
distribution also includes a QuickJS-based sandbox bundle; see
[`assets/licenses/QUICKJS-LICENSE`](assets/licenses/QUICKJS-LICENSE).

## Install

Install this directory as a bundle in the current profile:

```text
plugin_manager install_bundle target=/absolute/path/to/bookshelf-plugin
```

The bundle inserts one Host row, `ui-bookshelf`. Its client half loads through
`dsh.client` and registers:

- `sidebar.panellist` id `bookshelf` (the sidebar entry),
- `main` key `bookshelf` (the shelf page),
- `sidebar.right.pane.tab` key `@local/dsh-bookshelf/reader` (the static
  Books page tab),
- `conversation.session.header.utilities` (the Books reopen button),
- `conversation.composer.dock` (the one-time page-file prompt seed).

The Host half registers the `shelfPageSnapshot` session projection and the
`bookshelf-snapshot` command.

## Storage

The Host half stores the library under `$DSH_HOME/bookshelf`:

```text
$DSH_HOME/bookshelf/
  library.json        # metadata, link descriptors, cover metadata
  books/<id>.<pdf|epub>  # symlink for linked imports; legacy copies stay regular files
  state.json          # per-book progress, bookmarks, and reading settings
  defaults.json       # shelf-level default EPUB reading settings
  covers/<id>.<jpg|png|gif|webp|svg>
```

`DSH_HOME` defaults to `~/.dsh`. Deleting a book from the shelf removes its
record, a symbolic link or legacy shelf copy, its cover copy, and its reading
state. It never follows or removes a linked source. The HTTP surface is
registered under `/bookshelf` on the local Web carrier and only reflects
loopback origins; it is not part of `/api` and needs no browser session cookie.

## API

| Route | Meaning |
|---|---|
| `GET /bookshelf/api/capabilities` | Report the Host platform and whether Apple Books import is available. |
| `GET /bookshelf/api/books` | List imported books. |
| `POST /bookshelf/api/books?name=&title=&author=&format=` | Legacy body-upload import (not used by the current UI; copies bytes). |
| `POST /bookshelf/api/links/pick` | Open the native folder picker and list EPUB/PDF files. |
| `POST /bookshelf/api/links/import` | Create a soft link for one file in the chosen folder. |
| `PATCH /bookshelf/api/books/<id>` | Rename the shelf title/author without touching the file. |
| `GET /bookshelf/api/books/<id>/file` | Serve the file; EPUB responses expose `X-Bookshelf-Source-Revision`, PDF supports byte ranges. |
| `GET /bookshelf/api/apple-books?query=&offset=&limit=` | List local Apple Books metadata (no book content). |
| `POST /bookshelf/api/apple-books/import?assetID=` | Copy one Apple Books EPUB/PDF into the shelf. |
| `GET /bookshelf/api/books/<id>/state` | Read progress, bookmarks, and settings. |
| `GET /bookshelf/api/settings` | Read shelf-level default reading settings. |
| `PUT /bookshelf/api/settings` | Save shelf-level default reading settings. |
| `PUT /bookshelf/api/books/<id>/state` | Merge a partial state update. |
| `GET /bookshelf/api/books/<id>/cover` | Serve the stored cover image. |
| `PUT /bookshelf/api/books/<id>/cover` | Store a JPEG, PNG, GIF, WebP, or SVG cover. |
| `DELETE /bookshelf/api/books/<id>` | Delete the record, file, state, and cover. |
| `GET /bookshelf/assets/*` | PDF.js, its worker, CMaps, standard fonts, fflate, and the EPUB parser. |

Imports are capped at 256 MiB per file; only PDF and EPUB are accepted.

## Third-party software

- [PDF.js](https://github.com/mozilla/pdf.js) 6.3.289, Apache-2.0. The vendored
  build, worker, CMaps, standard fonts, and WASM decoders live in `assets/`.
- [fflate](https://github.com/101arrowz/fflate) 0.8.3, MIT, served as
  `assets/fflate.mjs` and used for EPUB ZIP inflation.

License texts are in `assets/licenses/`.

## Verification limits

The package is a plain-JavaScript Local bundle. Syntax and manifest checks cover the
bundle itself; the rendering of the shelf and readers is verified in the running Web
GUI. Client files are not rebuilt by a Host-only reload: reload the Web page after
replacing `client.js` or a served asset.
