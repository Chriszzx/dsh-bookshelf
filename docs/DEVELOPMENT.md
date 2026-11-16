# 本地开发与测试

下一版从本仓库的 `next` 分支继续开发。插件正式名称保持 `dsh-bookshelf`；0.5.0 在
0.4.0 的基础上加入标签与阅读状态（0.5.1 补上读完确认与「已读完 100%」显示，0.5.2 加入列表排列，0.6.0 加入朗读：系统音色、Edge、DeepSeek、OpenAI 兼容、本地占位，按书籍语言自动选音色，设置窗口与音频缓存；0.6.1 加入整书语音：任意可用语音服务、字数/时长/体积与 DeepSeek 费用估算、Host 后台合成、阅读器直接播放已生成文件），功能变更在发布时递增版本号。

## 开发安装

在 DSH 当前 profile 的「插件」中，选择本仓库的绝对目录进行本地安装，例如：

```text
D:\Github\dsh-bookshelf
```

DSH 会将插件链接到工作目录。GitHub 安装是独立的安装副本，不会跟随这里的编辑；`@local/dsh-bookshelf` 这个旧别名也不代表本地目录。

当前 profile 应只选择一个书架 bundle。旧别名可以保留为停用状态；将正式名称从 GitHub 来源切换为本地来源时，通过 DSH 插件管理器卸载原安装、添加本地目录，不要手工改 profile 的配置或 node_modules。

安装后检查：正式包的来源是本地目录，运行条目只有一个 `include:ui-bookshelf`，该条目处于 active 状态。包的链接最终应解析到本仓库。

修改 Host 代码后重启 DSH，确保加载新的模块；修改 Client 或浏览器资源后刷新现有 DSH 页面。当前仓库没有 DSH 源码开发 watcher，不能假定编辑后自动热更新。插件本身是直接加载的 JavaScript，无须构建单独的网页服务器。

本地开发安装继续使用当前 DSH 的现有书库。以下自动化测试则使用独立临时书库；它们不会安装插件、调用个人 Apple Books 书库、修改当前 profile 或使用个人浏览器配置。

## 书库数据格式

书库元数据继续保存在 `$DSH_HOME/bookshelf`：

- `library.json`：书籍记录。每本书可带 `status`（`unread` / `reading` / `finished`，
  仅表示用户的手动覆盖）和 `tags`（自定义标签 id 数组）。
- `tags.json`（0.5.0 新增）：自定义标签定义 `{ version, tags: [{ id, name, createdAt }] }`。
  标签名在写入前统一做 NFKC 归一化查重，并与内置三态的中英文名冲突检查。
- `state.json`：进度、书签、阅读设置。
- `tts.json`（0.6.0 新增）：朗读设置 `{ version, settings }`，含默认 provider、音色、
  语速、自动翻页，以及 OpenAI 兼容服务的 baseUrl/model/voice/format。
- `tts-secrets.json`（0.6.0 新增，0600）：朗读用的 API Key。也可以改用
  `DEEPSEEK_API_KEY` / `BOOKSHELF_TTS_OPENAI_KEY` 环境变量；两者都没有时再尝试
  DSH 凭据服务。密钥不会出现在任何 HTTP 响应里。
- `tts-cache/`（0.6.0 新增）：按「provider + 音色 + 语速 + 文本」哈希缓存的音频，
  LRU 上限 512 MB；损坏或缺目录时朗读继续，只是不再命中缓存。
  `POST /tts/synthesize` 只回 `{ url, mime, cached }`，`GET /tts/audio/<hash>.<ext>`
  直接送出缓存字节：浏览器不再用 `blob:`（主窗口 CSP 只允许 `self`/`data:`），
  也就能走 `<audio>` 的流式播放。命名是内容哈希，所以能设长缓存头。
- `tts.json` 的 settings 字段：`provider`（`macos`/`windows`/`edge`/`deepseek`/`openai`/`local`）、
  `voice`、`autoVoice`、`speed`、`autoPageTurn`，以及 `openai`/`deepseek`/`edge`/`local` 子对象。
  其中 `edge` 只存手动音色与 pitch，`local` 四个占位字段只做持久化。跨平台加载时若 provider
  不属于当前系统（如把 macOS 的 `tts.json` 拷到 Windows），会回退到该平台默认（`windows`/`macos`，
  其他系统为 `edge`）。

有效阅读状态由 Host 计算：`status` 存在时以手动值优先，否则按进度推导（无进度为未读，
有进度为正在阅读）。**「已读完」不再由进度推断**：阅读器在最后一页退出时询问是否标记，
确认后才写入 `status: "finished"`；之后任何 `percent < 0.995` 的进度写入都会清除它，表示
重新开始阅读。标签定义放在独立文件，是因为 0.4.0 的 Host 重写 `library.json` 时会丢顶层
字段；回退旧版本不会破坏分类表，书籍上的 `status` / `tags` 也会随记录保留。

## 安装测试依赖

需要 Node `^22.19.0 || >=24.0.0`、pnpm `11.28.5`，以及运行浏览器测试时可用的 Chrome、Chromium 或 Edge。

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

React 18 和 React DOM 是固定版本的测试开发依赖。生产插件继续使用 DSH 提供的 React。

## 常用命令

```sh
pnpm run test:syntax
pnpm test
pnpm run test:browser
pnpm run test:all
```

- `test:syntax`：检查自有运行代码、测试辅助代码和测试脚本的语法。
- `test`：运行 manifest、Host、会话交接和平台／导入测试，无需浏览器。
- `test:browser`：依次运行可见文本捕获、文件导入、讨论交接、阅读状态恢复、分页几何、书架布局／字体设置、标签与阅读状态、读完确认、书架排列、朗读（含按书籍语言自动选音色、固定音色、分页只前进、关闭后不弹回），以及设置窗口测试。
- `test:all`：依次执行以上三类检查。

单独运行一组浏览器回归：

```sh
pnpm run test:browser file-import
pnpm run test:browser tab-persistence pagination-geometry
pnpm run test:browser layout-fonts
pnpm run test:browser shelf-tags
pnpm run test:browser finish-prompt
pnpm run test:browser list-layout
pnpm run test:browser tts-playback
pnpm run test:browser settings-dialog
```

## 浏览器与测试数据

测试会在公共安装位置和 PATH 中寻找浏览器。需要指定可执行文件时，在 PowerShell 中运行：

```powershell
$env:CHROME_BIN = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm run test:browser
```

每组测试创建独立临时目录，在其中准备临时 `DSH_HOME`、浏览器 profile、React UMD 文件和需要的合成 EPUB／PDF。端口由操作系统分配。测试结束后关闭浏览器和服务器，并清理本次创建的目录。

默认不需要提供任何电子书或 `/tmp/batch1-test` 目录。`BOOKSHELF_TEST_FIXTURES` 可选：指定它时，目录应有 `node_modules/react/umd/react.development.js`、`node_modules/react-dom/umd/react-dom.development.js`；状态恢复测试还需要 `paged-long.epub` 和至少三页的 `mixed.pdf`。外部 fixture 目录只读，测试不会删除它。

Windows 进程没有符号链接权限时，仅真实符号链接成功的用例会明确 skip。复制回退、失败处理和注册来源校验仍然执行。macOS CI 覆盖真实符号链接成功路径。

## 标签与阅读状态回归

`shelf-tags` 浏览器回归使用独立临时书库，覆盖：分类页签的数量与计数、内置三态推导、手动状态覆盖、
自定义标签的新建／改名／删除、标签删除后书籍归属被清除，以及刷新页面后状态与标签仍然存在。
Host 侧的标签规则与 HTTP 契约由 `tests/tags.mjs`、`tests/tags-api.mjs` 覆盖，不依赖浏览器。

## 读完确认回归

`finish-prompt` 用一份五页 PDF 验证：停在最后一页退出时出现「标记为已读完？」弹窗；确认后
书架卡片显示「已读完 100%」且不再显示进度条；已标记的书再次在最后一页退出不会重复询问；
之后以更低进度重新阅读时，卡片回到「继续阅读 x%」，Host 同时清除 `status`。未读到最后一页
的书退出时任何情况下都不弹窗。

## 书架排列回归

书架支持封面网格和纵向列表两种排列，选择保存在 `localStorage` 的 `bookshelf.layout.v1`，
刷新页面后保持。列表行复用封面模式的副行与进度规则（已读完不显示进度条），行内「更多」
菜单提供重命名、标签和删除（删除在行内二次确认）。`list-layout` 浏览器回归覆盖：切换与
持久化、三种状态的文案和进度条、搜索／页签／排序在列表态生效、从阅读器返回保持列表、
行内菜单与删除确认、以及 480px 窄面板不横向溢出。

## 朗读回归

书架右上角的齿轮现在是带标签页的设置窗口（阅读／朗读／其他），朗读配置不再只藏在播放条的
音色面板里。朗读页里所有 provider 都可选（未配置时只标注，不禁用，否则 OpenAI 兼容项永远
选不到）；OpenAI 兼容项带常用服务预设，也可手填 Base URL／模型／音色／Key，并有「测试」按钮。

朗读播放要点：点 toolbar 的朗读按钮时先用一段静音 data URL 在同一手势里解锁媒体播放，否则
首个异步取回的句子会被浏览器按自动播放策略拒绝；分页朗读按「绝对页」计算（range rect 是
视口坐标，要加当前 scrollLeft），且只在向前时翻页；高度变化的重排不会把页面弹回上一页。

朗读的 provider 分三类：系统音色（macOS 用 `/usr/bin/say`，Windows 用 PowerShell 调
`System.Speech.Synthesis.SpeechSynthesizer`，SAPI rate `-10…10`）、云端（Edge 公开朗读
WebSocket、DeepSeek、任意 OpenAI 兼容 `/audio/speech`）以及占位（`local`，只存配置、
合成直接 501）。

**Edge 协议**（与 node-edge-tts / dsh-plugin-tts 一致，已实测可用）：连
`wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=…&Sec-MS-GEC=…&Sec-MS-GEC-Version=1-143.0.3650.75&ConnectionId=…`，
认证参数全在 **query** 里，所以用平台自带 `WebSocket` 即可，不需要自写 TLS 握手；`Sec-MS-GEC`
= SHA256(向下取整到 300 秒的 Windows ticks + token)，`Sec-MS-GEC-Version` 由
`BOOKSHELF_EDGE_GEC_VERSION` / `BOOKSHELF_EDGE_CHROMIUM` 覆盖。发两帧：
`Content-Type:application/json … Path:speech.config`（**不带 X-Timestamp**）和
`X-RequestId:… Content-Type:application/ssml+xml … Path:ssml`，SSML 的 `xml:lang` 取自音色
前两段；收二进制帧时在 `Path:audio\r\n` 标记之后取音频，收到文本帧含 `Path:turn.end` 即完成；
401/403/1007 不重试，其他失败（含 1006、超时）重试一次，单次超时 20 秒。

**音色标识**：macOS 的 `say -v '?'` 会跨语言复用显示名（`Reed (德语（德国）)` /
`Reed (英语（美国）)`），所以 id 用完整显示名而不是裸名字；裸名字会永远落到第一个语言，
这正是「强制说德语」的原因。Host 不再把合成失败静默回退到系统默认音色，而是报错。

**语言匹配**：客户端从 EPUB `dc:language`（缺失时按首章文字统计）或 PDF 首页文本推断
书籍语言，音色下拉的第一项「自动（按书籍语言）」是默认值（对应 `autoVoice: true`），按语言
挑音色（精确 lang → 同语系 → 回退）；选具体音色即固定（`autoVoice: false`），再选回「自动」
可恢复。播放条显示实际音色。设置里的 `autoVoice`、`edge`、`local` 都持久化在 `tts.json`，
跨系统迁移时会检测 provider 是否适用于当前平台并回退到默认（macOS↔Windows）。

**设置面板**：播放条里的音色面板按「打开时初始化一次」维护草稿——不要把返回的
controller 对象放进 effect 依赖（它每次渲染都是新对象，会让表单每次输入都重置）。测试按钮
12 秒超时中断，单句播放请求 30 秒超时。`settings-dialog` 浏览器回归覆盖：三个标签页、阅读设置的持久化、
音色下拉默认「自动（按书籍语言）」、选手动音色后保存并确认 `autoVoice: false`、语言筛选、Edge/本地/不可用
provider、缓存清理，以及让服务端故意不响应后 15 秒内出现超时提示。

`tts-playback` 用假 provider（注入的 `say`）在真实 Host 与客户端里验证：句子按顺序播放、
章节结束后自动进入下一章、暂停/继续/下一句、关闭即停、语速改动能持久化，以及 PDF 自动翻页。
它不会访问任何真实语音服务。Host 侧的切句、缓存、provider 请求形状与错误映射由
`tests/tts-sentences.mjs`、`tests/tts-cache.mjs`、`tests/tts-providers.mjs`、`tests/tts-api.mjs`
覆盖；`tests/tts-native.mjs` 在 macOS 上直接调用系统 `say` 生成 WAV（其他平台跳过）。

真实 DeepSeek 或第三方 TTS 的冒烟测试需要自己的 Key，默认不在 CI 中运行；人工验证时
在阅读器里选好 provider 与音色即可。

## 字体与布局回归

`layout-fonts` 保持窗口宽度不变，改变主面板宽度来模拟侧栏开合，验证卡片尺寸、左对齐与窄面板布局；同时检查 Windows／macOS 顶部安全区和设置弹窗位置。字体访问使用受控的成功／拒绝响应，验证点击手势、原生字重／斜体元数据、默认设置与单书设置隔离、重新打开后的恢复，以及换字体后的分页锚点。测试不授予真实系统字体访问权限；真实授权弹窗和字体渲染效果需要在现有 GUI 中人工验收。

## 提交前检查

正式发布或提交前按顺序确认：

1. `node scripts/run-checks.mjs all` 全绿（语法、单元/接口、全部浏览器回归）；网络类 provider 不参与自动化测试。
2. `npm pack --dry-run --json` 的文件列表包含 `tts.js`、`audiobook.js`、`assets/tts-sentences.mjs`，且不含 `tests/`、截图和本机路径。
3. 仓库内没有本机凭据：不提交 `.credentials*`、`tts-secrets.json`、`.env*`、API Key、绝对家目录路径；Edge 的
   `TRUSTED_CLIENT_TOKEN` 是公开客户端常量，但仍只在 `tts.js` 中出现。
4. 文档版本号与 `package.json` 一致（当前 `0.6.1`），README 中英两节同步描述 provider、自动音色、超时、整书语音与平台差异。
5. 需要真实 Edge `say` 冒烟时手动执行，失败不阻塞提交；DSH 重启后再做一次人工验收（朗读入口、设置窗口、自动音色）。
6. 未经确认不要推送到远端，也不要改动版本号。

## CI 与验收边界

GitHub Actions 配置了 Windows／macOS × Node 22／24 的语法及 Node 测试，并在 Node 24 上执行浏览器回归。首次 push 后才能观察远端 CI 结果。

浏览器测试使用真实书架 Host、Client 和阅读器代码，但 DSH 外壳与会话 transport 有测试替身。因此自动化测试通过后，仍需在当前 DSH 页面完成原生文件夹选择器、面板切换和真实会话侧栏的人工验收；不要把独立测试页通过当成整个 DSH 界面的视觉验收。
