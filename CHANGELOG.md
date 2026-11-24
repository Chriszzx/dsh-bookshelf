# Changelog / 变更记录

## Unreleased / 未发布

- 浏览器回归的完整输出同时写入 `.local/browser/`，日志开头记录平台、Node 与 Chrome 版本；失败时在失败步骤留下指向套件文件的 `::error` 注释。\
  Tee browser regression output into `.local/browser/`, record platform, Node and Chrome versions at the top, and annotate the failing suite file.
- CI 失败时打印并上传该日志（`browser-log-<os>-node<n>` artifact），不必再用步骤耗时推断是哪个套件失败。\
  Print and upload that log when CI fails, so a failing suite is named instead of inferred from step timing.
- CI 只在分支推送与 PR 上运行，发布标签不再触发整套矩阵。\
  Run CI on branch pushes and pull requests only; a release tag no longer starts the full matrix.

## [0.6.6](https://github.com/Chriszzx/dsh-bookshelf/releases/tag/v0.6.6) · 2026-11-19

- 将 EPUB 阅读位置的编解码从阅读器拆到独立模块，兼容 0.6.5 保存的进度。\
  Extract EPUB location encoding and decoding into a module compatible with progress saved by 0.6.5.
- 将 EPUB 的分栏、页数计算和跨页定位移至同一模块，供阅读页和全书页数统计共用。\
  Share EPUB column layout, page counting, and spread positioning between the reader and the book-wide page count.
- 修复 EPUB 重排后总页数相同但原文已换页时，阅读器仍停在旧页的问题。\
  Follow the reading position to its new page when EPUB reflow leaves the total page count unchanged.
- 新建 EPUB 书签跟随原文位置，切换字体或单双页后仍能跳回原处。书签和标注按正文顺序混排。\
  New EPUB bookmarks follow the original passage across font and spread changes. Bookmarks and annotations sort together in reading order.

## [0.6.5](https://github.com/Chriszzx/dsh-bookshelf/releases/tag/v0.6.5) · 2026-11-18

- 修复窄窗口下滚动条占位造成的阅读工具栏错位。\
  Keep reader toolbar buttons aligned when a scrollbar occupies space in a narrow window.
- 修复 EPUB 单双页切换时可能回到上一栏的问题，重新分页时以当前可见正文定位。\
  Keep the current passage in view when switching between single pages and spreads.
- 修复刚打开 PDF 就翻页时，初始定位可能覆盖所选页码并导致重开回到旧页的问题。\
  Keep an early page turn when opening a PDF and restore that page on reopen.

## [0.6.4](https://github.com/Chriszzx/dsh-bookshelf/releases/tag/v0.6.4) · 2026-11-18

- 书库、阅读记录、语音和阅读器资源统一通过 DSH Connection 检查。\
  Apply DSH Connection checks to bookshelf routes, including reader assets and speech.
- 读取失败后可重试恢复进度和书签，多窗口的书签与标注编辑按条目合并。整书语音复用同一次已确认估算的任务。\
  Restore progress and bookmarks on retry, merge independent edits across windows, and reuse the audio job for a previously confirmed estimate.
- EPUB 改用单页或自适应跨页，保留原书排版和可用的内嵌字体，缺失字面时回退。重新分页保留阅读位置和标注。\
  Use single pages or adaptive spreads for EPUBs, preserve publisher typography, and fall back for missing embedded font faces. Repagination retains reading position and annotations.
- 书架统一显示书名、作者与阅读状态，在读书籍另显示进度。阅读工具栏调整了返回、目录和「讨论此页」入口。\
  Show consistent title, author, status and progress in both shelf layouts. Align reader controls and update the page discussion icon.

## 0.6.3 · 2026-11-17

- 调整书架网格与阅读设置，固定目录和书签标签的位置。关闭朗读时清除高亮与字幕。\
  Refine the shelf grid and reader settings, pin reader sidebar tabs, and clear narration highlights and captions when closed.

## 0.6.2 · 2026-11-17

- 新增文本高亮与下划线，书签和标注统一在阅读侧栏管理。朗读支持选中文本并在对应位置继续。\
  Add text highlights and underlines, manage marks in a shared sidebar, and resume narration from a text selection.

## 0.6.1 · 2026-11-16

- 新增整书语音，支持预估时长和体积、后台生成以及在阅读器内播放。\
  Add whole-book audio with estimates, background rendering, and playback in the reader.

## 0.6.0 · 2026-11-16

- 新增逐句朗读与自动翻页，支持按书籍语言匹配音色，并提供系统音色、Edge、DeepSeek 和 OpenAI 兼容服务。\
  Add sentence-by-sentence narration with automatic page turns, language-based voice selection, and multiple speech providers.

## 0.5.2 · 2026-11-16

- 新增书架列表视图。\
  Add a list view for the bookshelf.

## 0.5.1 · 2026-11-16

- 在最后一页退出时确认是否标记为已读完。\
  Ask whether to mark a book as finished when leaving its last page.

## 0.5.0 · 2026-11-16

- 新增标签和阅读状态管理。\
  Add tags and reading statuses.

## 0.4.0 · 2026-11-15

- 提供本地 PDF／EPUB 书架、阅读器、导入及文件夹链接，支持恢复阅读位置和把页面带入 DSH 对话。\
  Provide a local PDF and EPUB bookshelf with imports, linked folders, reading position recovery, and page discussion in DSH.
