# dsh-bookshelf

A local PDF and EPUB bookshelf for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
Web GUI. It adds a **Bookshelf** entry to the left sidebar and a shelf in the main
panel. Library, covers, progress, bookmarks and settings live under
`$DSH_HOME/bookshelf`, so they survive reloads and restarts.

## Features

- **One Import books menu**: **Import book files…** (picker or drag-and-drop,
  copies into the shelf) and **Link a folder…** (soft links; on Windows a staged
  copy when symlink creation is denied). Originals are never deleted.
- **Apple Books import** (macOS): search the local library and link a downloaded
  EPUB/PDF; EPUB source folders are packed on demand.
- **Shelf**: left-aligned, stable-size cover grid that adapts to the panel width; search, sort, rename, delete.
- **PDF.js reader**: fit page/width/custom zoom, single/continuous pages, page
  bookmarks, progress restore.
- **EPUB reader**: paged/scroll, TOC, typography, light/dark themes, automatic
  two-page layout, fullscreen, bookmarks, progress restore.
- **Page discussion** (EPUB): capture the visible page into
  `.dsh-bookshelf/<id>.md` in a chosen workspace, open a native conversation with
  an `@file` draft (nothing is sent), and show the page in the static **Books**
  sidebar tab.
- English/Chinese UI.

## Install

Requires DSH `>=0.2.0-rc.2 <0.3.0`, Node `^22.19.0 || >=24.0.0`, on macOS or
Windows.

From GitHub:

```sh
dsh plugin --profile web add github:Chriszzx/dsh-bookshelf
```

From a local checkout:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-bookshelf
```

The bundle inserts `ui-bookshelf`; reload the Web page after replacing client
files.

## Usage

Open **Bookshelf** in the sidebar, then **Import books**:

- **Import book files…** — choose one or several EPUB/PDF files, or drop files
  on the shelf.
- **Link a folder…** — choose a folder, review its books, and add them as soft
  links (or copies on the Windows fallback).
- **Apple Books** (macOS) — search the local library and link a downloaded book.

EPUB settings separate **Font** from **Typography**. Choose an available common font, or use **Detect system fonts** to include installed custom fonts. Full detection requires browser support and a user-granted font-access permission; denial or unsupported browsers retain the common list. Native font metadata supplies weights and italics, including variable weights. The font inventory stays in browser memory; only the selected family and style are saved. Missing fonts use a fallback without discarding the saved selection. PDF pages keep their document fonts.

Progress and bookmarks are stored on the Host. Switching panels preserves the
open book, search/sort and scroll; a page reload returns to the shelf with
progress intact.

## Platform

| Platform | Shelf + readers | File import | Folder linking | Apple Books |
|---|---|---|---|---|
| macOS | Yes | Yes | Soft links | Yes |
| Windows | Yes | Yes | Soft links with Developer Mode; otherwise copy | No |
| Linux | Not declared | — | — | No |

**Windows.** Folder linking needs `SeCreateSymbolicLinkPrivilege`. Without it,
the Host automatically saves a staged copy and labels it **copy**; enable
**Settings → Privacy & security → For developers → Developer Mode** (then sign
out/in) or run DSH elevated for true soft links. File import and drag-and-drop
need no symlink privilege. Unrelated errors are reported, and failed copies
clean up. Automated tests cover permission failures and the copy fallback.

**Apple Books.** macOS only; on Windows the button, setting and routes are
unavailable (`501`). If the library is unavailable, grant DSH **Full Disk
Access**. Books that are not downloaded show as unavailable.

## Data and privacy

```text
$DSH_HOME/bookshelf/{library.json,books,state.json,defaults.json,covers}
```

Deleting an entry removes its shelf file, cover and reading state; it never
follows or deletes a linked source. The plugin has no telemetry and does not
upload books. Page-discussion files stay in the selected workspace under
`.dsh-bookshelf/` and are not added to a model context until you send a message
that references them.

## Development

Use the Node range above and pnpm 11.28.5 (pinned in `packageManager`):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run test:syntax
pnpm test
pnpm run test:browser
```

Node tests need no browser. Browser regressions automatically locate Chrome,
Chromium or Edge, use pinned React 18 development dependencies, and generate
synthetic EPUB/PDF fixtures. Set `CHROME_BIN` to an executable path if detection
fails. Each suite owns a temporary book library, browser profile and fixtures;
cleanup never touches the running DSH instance or a personal library.

Run one browser regression with `pnpm run test:browser file-import` (also:
`reading-snapshot`, `discussion-handoff`, `tab-persistence`,
`pagination-geometry`, `layout-fonts`). `BOOKSHELF_TEST_FIXTURES` optionally supplies an existing
fixture directory instead of generated resources. Windows without symlink
privileges skips only the true-symlink success case; fallback and source
verification still run. CI covers Windows/macOS with Node 22 and 24, and browser
regressions with Node 24.

Install this checkout as a **local directory** in DSH's Plugins page to develop
against these files; a GitHub installation does not track local edits. Keep only
one selected bookshelf bundle. Host changes require reload/restart; refresh the
page for Client changes. These standalone regression suites check the real plugin
code in an isolated harness; they do not establish live DSH GUI acceptance.
See [development and testing notes (中文)](docs/DEVELOPMENT.md).

## License

MIT — see [LICENSE](LICENSE). Bundled PDF.js, fflate, fonts, CMaps and WebAssembly
assets retain their upstream notices under [`assets/licenses`](assets/licenses),
[`assets/wasm`](assets/wasm) and [`assets/standard_fonts`](assets/standard_fonts).

The automated regression suite is configured for Windows and macOS. Copy
fallback is tested without requiring symlink privileges. Native folder-picker
and live DSH interaction acceptance should also be checked when releasing.
