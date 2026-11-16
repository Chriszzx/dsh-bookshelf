# dsh-bookshelf

A local PDF and EPUB bookshelf for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI: a **Bookshelf** entry in the sidebar, covers, progress, bookmarks, tags and a reader, all stored under `$DSH_HOME/bookshelf`.

DeepSeek Harness Web GUI 的本地 PDF / EPUB 书架：侧栏新增**书架**入口，管理封面、进度、书签、标签并内置阅读器，数据保存在 `$DSH_HOME/bookshelf`。

## Features / 功能

- **Import**: one menu for file picking or drag-and-drop (copied into the shelf) and folder links; originals are never modified.
  **导入**：统一菜单支持文件选择/拖拽（复制进书架）与链接文件夹，原始文件不会被修改。
- **Shelf**: stable-size cover grid with search, sort, rename, delete, or a list view that remembers your choice.
  **书架**：尺寸稳定的封面网格，支持搜索、排序、重命名、删除，可切换为列表模式并记住选择。
- **Tags and status**: Unread / Reading / Finished plus custom tags, switched with tabs; finished books show **Finished 100%** and drop the status when you read past the end again.
  **标签与状态**：未读 / 正在阅读 / 已读完，外加自定义标签与分类页签；已读完显示「100%」，重新往后读会取消状态。
- **PDF and EPUB readers**: zoom, paged/scroll modes, TOC, themes, bookmarks and progress restore.
  **阅读器**：PDF 与 EPUB 均支持缩放、分页/滚动、目录、主题、书签和进度恢复。
- **Page discussion** (EPUB): snapshots the visible page into a chosen workspace and opens a native conversation with an `@file` draft.
  **页面讨论**（EPUB）：把当前页快照写入所选工作区，并打开一个带 `@file` 草稿的原生会话。
- **English / Chinese UI.**
  **中英文界面。**

## Read aloud / 朗读

Play the current chapter with automatic page turns and chapter advance, a sentence caption, speed control and a disk cache. Backends: system voices (macOS `say`, Windows SAPI, offline), **Edge speech** (no key), **DeepSeek speech**, any **OpenAI-compatible** `/audio/speech`, and a **local model** section that is UI-only for now.

朗读当前章节，支持自动翻页、自动进入下一章、字幕、语速与磁盘缓存。后端包括系统音色（macOS `say`、Windows SAPI，离线）、**Edge 语音**（无需 Key）、**DeepSeek 语音**、任意 **OpenAI 兼容** `/audio/speech`，以及目前只有配置界面的**本地模型**占位。

The voice picker's first option is **Automatic (book language)**, which is the default: EPUB metadata (or a script count for PDFs) selects a matching voice, and picking a concrete voice pins it. Voice ids are locale-specific, so a shared name never silently switches language.

音色下拉第一项是**「自动（按书籍语言）」**且默认选中：EPUB 元数据（PDF 按文字统计）匹配对应语言的音色；选具体音色即固定。音色 id 按语言唯一，不会因为同名而静默换语言。

The **Test** button aborts after 12 seconds and sentence requests time out as well; failures are shown in the player instead of hanging.

「测试」按钮 12 秒超时中断，单句请求也有超时保护；失败原因直接显示在播放条，不会卡住。

## Whole-book audio / 整书语音

Each book's **More** menu offers **Generate audiobook**. The dialog extracts the whole book (EPUB or PDF), then shows the character and sentence counts, estimated length and file size. **Speech service** defaults to DeepSeek TTS; system voices, Edge and OpenAI-compatible services are selectable too, and **Change voice settings…** jumps to the Read-aloud tab of Shelf settings. Only DeepSeek shows an estimated bill and billed characters, because only it publishes a per-character price. **Generate** renders the book sentence by sentence on the Host into one file under `$DSH_HOME/bookshelf/audiobooks/<book id>/` — WAV for DeepSeek/system voices, MP3 for Edge/OpenAI-compatible services. Rendering runs on the Host, so the dialog may be closed; reopen it to watch progress or download the finished file.

Once a book has rendered audio, the reader's read-aloud menu offers **Play generated audio** after a confirmation. It plays the single file without following pages, and switching back to live read-aloud stops the file again.

生成后打开这本书的阅读器，朗读菜单会出现「播放已生成音频」；确认后直接播放该文件，不跟随页码，也可随时切回逐句朗读。

Billing follows the official rules: a Chinese character counts as two billed characters, and pricing is ¥1.5 per 10,000 billed characters at the current limited-time 50% rate (list ¥3). The estimate is approximate; actual duration, size and bill may differ.

每本书的**「更多」**菜单里有**「生成整书语音」**。弹窗先提取整本 EPUB/PDF 文本，展示字数、句数、预计时长与文件大小。**语音服务**默认 DeepSeek TTS，也可选系统音色、Edge 或 OpenAI 兼容服务；**「修改朗读设置…」**会跳到书架设置的朗读标签页。只有 DeepSeek 显示预估费用和计费字符，因为只有它公开按字符计价。点**「开始生成」**后 Host 逐句合成并合并为一个文件，保存在 `$DSH_HOME/bookshelf/audiobooks/<书籍 id>/`——DeepSeek 与系统音色输出 WAV，Edge/OpenAI 兼容服务输出 MP3。生成在 Host 后台进行，可以关闭弹窗；再次打开可查看进度或下载成品。

计费按官方规则：一个汉字计为 2 个计费字符；当前限时 5 折为 ¥1.5/万计费字符（原价 ¥3）。估算仅供参考，实际时长、体积和账单可能略有差异。

## Install / 安装

Requires DSH `>=0.2.0-rc.2 <0.3.0`, Node `^22.19.0 || >=24.0.0`, on macOS or Windows.

需要 DSH `>=0.2.0-rc.2 <0.3.0`、Node `^22.19.0 || >=24.0.0`，支持 macOS 与 Windows。

```sh
dsh plugin --profile web add github:Chriszzx/dsh-bookshelf
dsh plugin --profile web add /absolute/path/to/dsh-bookshelf   # local checkout
```

The bundle inserts `ui-bookshelf`; reload the Web page after replacing client files.

插件会注册 `ui-bookshelf`；替换客户端文件后刷新页面即可。

## Usage / 使用

The gear icon opens **Shelf settings** with three tabs: Reading (fonts, size, margins, mode, theme), Read aloud (backend, language-aware voice, speed, API fields, cache) and Other (discussion workspace, Apple Books import).

The page theme follows the desktop app: **Follow** uses the live DSH palette (including custom themes and user overrides), and the pinned **Light**/**Dark** options use the same DSH palettes rather than approximate colors. Switching the app between light and dark repaints the page immediately.

齿轮打开**书架设置**窗口，三个标签页：阅读（字体、字号、边距、模式、主题）、朗读（后端、按语言选音色、语速、API 字段、缓存）、其他（讨论工作区、Apple Books 导入）。

页面主题跟随桌面端：**跟随**直接使用 DSH 的实时调色板（含自定义主题与用户覆盖），**浅色/深色**也取 DSH 自己的两套配色而不是近似值。在桌面端切换明暗，页面会立即重绘。

In the reader, the speaker button opens a frosted-glass dock at the bottom of the page with start/pause, previous/next sentence, speed, voice and close. Opening the dock immediately selects the sentence at the reading position — the highlight and preview appear before any audio plays. In EPUB the sentence being read is marked with a translucent highlighter stroke laid over the original text, and a floating preview card repeats that sentence; after read-aloud stops both stay at the stopping point, which keeps the reading position visible. Moving to the previous/next sentence only moves the highlight and never starts playback — press play to continue from the selected sentence. PDF files have no text layer, so they show the floating card only. Everything floats above the page and never reflows it.

阅读器里点朗读按钮会在页面底部打开**毛玻璃**控制浮条，内含开始/暂停、上/下句、语速、音色与关闭。打开浮条就会立即选中当前阅读位置的句子，高亮与预览无需等音频开始即可显示。EPUB 中正在朗读的句子会用一层**半透明荧光笔高亮**盖在原句上（文字保持清晰），同时上方浮动预览卡片重复当前句子；停止朗读后两者都留在停止位置，方便定位阅读进度。切换上/下一句只移动高亮，不会自动播放；按播放才从选中句继续。PDF 没有文本层，只显示浮动卡片。浮条与高亮都浮在页面上方，不会引起重排。

Selecting book text and right-clicking opens the reader's own menu: **Copy**, **Copy with source** (adds the book title and chapter), **Select all** of the chapter and **Read selection** aloud without moving the reading position. Plain right-click without a selection keeps the normal app menu.

在书里选中文字后右键，会打开阅读器自己的菜单：**复制**、**复制并附出处**（附书名与章节）、**全选本章**、**朗读选中文字**（不会移动阅读位置）。没有选中文字时右键仍使用系统默认菜单。

## Data / 数据

Everything lives in `$DSH_HOME/bookshelf`: `library.json`, `state.json`, `tags.json`, `tts.json`, `tts-secrets.json` (0600, never echoed back) and `tts-cache/` (LRU, 512 MB). API keys can also come from `DEEPSEEK_API_KEY` / `BOOKSHELF_TTS_OPENAI_KEY`.

所有数据都在 `$DSH_HOME/bookshelf`：`library.json`、`state.json`、`tags.json`、`tts.json`、`tts-secrets.json`（0600，不会回显）和 `tts-cache/`（LRU，512 MB）。API Key 也可来自 `DEEPSEEK_API_KEY` / `BOOKSHELF_TTS_OPENAI_KEY`。

Edge speech sends the text to Microsoft's public read-aloud endpoint; system voices stay offline.

Edge 语音会把待朗读文本发送到微软公开的朗读接口；系统音色完全离线。

## Development / 开发

```sh
node scripts/run-checks.mjs all     # syntax + unit/API + browser regressions
node tests/run-browser.mjs tts-playback
```

Tests need Chrome and the React UMD fixtures; network speech providers are never called. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for data formats, the Edge protocol and the pre-release checklist.

测试需要 Chrome 与 React UMD 文件，不会访问真实语音服务。数据格式、Edge 协议与提交前检查见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## License / 许可

MIT.
