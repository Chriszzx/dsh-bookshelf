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
- **Shelf**: cover grid, search, sort, rename, delete.
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
clean up. Covered by simulated tests on macOS, not real Windows hardware.

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

Pure Node tests:

```sh
node --test tests/manifest.mjs tests/sidebar-snapshot.mjs \
  tests/discussion-bridge.mjs tests/platform-compatibility.mjs \
  tests/link-fallback.mjs tests/link-import-mode.mjs
```

Browser regressions need Chrome and React UMD fixtures. Set
`BOOKSHELF_TEST_FIXTURES` to a directory containing the React/React DOM UMD
files; set `CHROME_BIN` if Chrome is not at its default macOS path. Run
`node tests/file-import.mjs`, `tests/pagination-geometry.mjs`,
`tests/tab-persistence.mjs`, `tests/reading-snapshot.mjs`, or
`tests/discussion-handoff.mjs`. They use isolated temporary homes and Chrome
profiles and do not touch a personal library.

## License

MIT — see [LICENSE](LICENSE). Bundled PDF.js, fflate, fonts, CMaps and WebAssembly
assets retain their upstream notices under [`assets/licenses`](assets/licenses),
[`assets/wasm`](assets/wasm) and [`assets/standard_fonts`](assets/standard_fonts).

Developed and tested on macOS. Windows folder linking is covered by simulated
failure tests; the real Windows symlink-denial path has not been exercised on
Windows hardware. Shelf rendering is verified in the running Web GUI.
