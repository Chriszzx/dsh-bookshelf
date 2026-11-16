# 计划：纯逻辑模块化 + 标注 / 朗读反色 / 右键菜单

状态：**已按 2026-11-17 的确认更新**（拆分方式、渲染引擎、锚点、样式作用域、重定位语义已定）
适用版本：0.6.1 之后、0.6.2 之前

---

## 0. 已确认的决策

| 决策 | 选择 |
| --- | --- |
| 客户端大文件拆分 | **不做构建步骤**：纯逻辑外置到 `assets/lib/*.mjs`，`client.js` 保持手写单文件，只留 React 胶水 |
| 高亮/下划线渲染 | **CSS Custom Highlight API**（`::highlight()`），不可用时回退旧 overlay |
| 标注锚点 | **章节文本偏移 + 原文/上下文**（chapterIndex + normalized offset + quote/prefix/suffix） |
| 标注样式设置 | **每本书记忆 + 全局默认**（`state.settings.annotationStyle`） |
| 选区朗读后继续 | **从选区最后一句重新读起**（该句会被再读一次），然后正常连续朗读 |
| 右键菜单 | 去掉「全选本章」；保留 复制 / 复制并附出处 / 朗读选中文字，新增 高亮 / 下划线 |

> 取舍说明：DSH 以 classic script 方式加载 `exports['./client']` 单文件，客户端不能用静态 `import`。在不引入构建的前提下，**算法、模型、渲染计划、词条、纯函数测试**全部进入 `assets/lib`，`client.js` 预计从 9782 行降到 ~8200 行（其中约 500 行是必须留在文件里的样式字符串与 React 组件）。可维护性来自「逻辑有独立文件 + 单元测试」，而不是把 React 也搬出去。

---

## 1. 目标

1. 大文件拆分：`client.js` 的逻辑外置、`index.js`（1488 行）与 `tts.js`（956 行）拆成 Host ESM 子模块。
2. 右键菜单精简 + 「朗读选中文字」成为 TTS 重定位点 + 该次朗读不进缓存。
3. 下划线/高亮标注：创建、持久化、与整页书签混排、图标区分、排序与搜索。
4. 阅读器书签按钮右侧新增标注样式按钮（颜色/强度/粗细/样式）。
5. 朗读高亮改为页面反色；带标注的句子由标注覆盖朗读效果。

## 2. 非目标

- PDF 文本标注（canvas 无文本层）；PDF 仍只有整页书签。
- 标注导出/同步；不引入打包器；不改插件对外 API。

---

## 3. 阶段 R：模块拆分

### 3.1 客户端：纯逻辑外置（无构建）

保留 `client.js` 作为唯一交付文件（classic script + `window.__ModuleLoader__`）。逻辑通过既有机制加载：客户端已经用 `import(absoluteServiceUrl(base, '/assets/xxx.mjs?v=ASSET_VERSION'))` 动态加载 `epub.mjs` / `tts-sentences.mjs` 等模块，Host 的 `/bookshelf/assets/**` 路由也已支持 `.mjs`（`text/javascript`、`no-cache`）。新模块沿用这一模式，**用同一个 Host 路由同时供 Host 静态 `import` 和客户端动态 `import`**，因此纯函数能在 Node 单测里直接测。

新增/迁移的模块：

```
assets/lib/text-index.mjs      章节文本索引、句子范围、分页度量、rangePage、DOM 点 ↔ 文本偏移
assets/lib/palette.mjs         READING_THEMES、DSH token 解析（跟随/浅色/深色）
assets/lib/annotations.mjs     标注模型：id、锚点编解码、清洗、去重、默认样式
assets/lib/reading-list.mjs    书签+标注合并列表：排序、搜索、分组
assets/lib/highlights.mjs      渲染计划：反色取色、标注样式、优先级、回退判定（DOM 应用在此模块）
assets/lib/selection-speech.mjs 选区朗读：句子切分、重定位目标句计算、缓存策略标记
assets/lib/styles-reader.mjs   阅读器/分页/浮层样式字符串（可在客户端首次打开时注入）
assets/locales/<domain>.mjs    按领域拆分的 en/zh 词条（annotations/selection/reading-list/reader）
```

`assets/lib/styles-reader.mjs` 的视频：样式在客户端 `apply` 后异步注入。为避免首帧无样式，**主样式表仍在 `client.js`**，只有新增功能样式进入模块并按需注入（打开阅读器前必然已完成）。

`client.js` 内保留并按区块加 banner（`// ===== [chrome] =====`），方便定位与人工合并：

```
[prelude] [styles:base] [ui:icons] [ui:primitives] [hooks:state] [hooks:read-aloud]
[chrome:reader-shell] [chrome:reader-aside] [chrome:tts-dock] [chrome:selection]
[frame:epub] [reader:epub] [reader:pdf] [shelf:*] [locales:loader] [apply]
```

### 3.2 Host 拆分（纯 ESM，静态 import，低风险）

```
index.js              ~250 行：imports + apply() + 路由表装配
host/http.js          HttpError / readJsonBody / readTextBody / sendJson / mime
host/store.js         library.json / state.json / tags.json 读写、原子替换、锁
host/library.js       导入 / 删除 / 重命名 / 封面
host/states.js        每本书 state 的 sanitize（progress / bookmarks / annotations / settings）
host/assets-route.js  /bookshelf/assets 服务与字体探测
host/tts-routes.js    capabilities / settings / secrets / synthesize / audio
host/audiobook-routes.js
host/apple-books-routes.js
host/link-routes.js
host/discussion-routes.js
host/routes.js        分发表
```

`tts.js` → `tts/{settings,cache,providers,service}.js`，`tts.js` 保留 re-export 门面（现有 import 与测试不变）。
`audiobook.js` 的 WAV/MP3 合并、计费拆到 `assets/lib/audiobook-audio.mjs`、`assets/lib/audiobook-pricing.mjs`。
`tags.js` / `sidebar.js` / `apple-books.js` 已经是独立模块，不动。

### 3.3 验收

- 行为零变化：48 语法 / 80 单元 / 13 浏览器套件全绿。
- `docs/DEVELOPMENT.md` 记录模块地图与「逻辑放 assets/lib、React 胶水留 client.js」的约定。

---

## 4. 标注（下划线 / 高亮）

### 4.1 数据模型（`state.json`，与 bookmarks 同层）

```js
annotations: [{
  id: 'an_<base36>',
  type: 'highlight' | 'underline',
  chapterIndex: 3,
  start: 1234, end: 1300,        // 章节归一化文本字符偏移（end 不含）
  quote: '选中原文…',             // ≤ 500 字
  prefix: '前 40 字', suffix: '后 40 字',
  color: '#ffd23f',              // '#rgb' | '#rrggbb' | 'theme'
  strength: 0.35,                // 0.05–0.9
  thickness: 2,                  // 1–6 px（下划线）
  underlineStyle: 'solid',       // solid | dashed | dotted | wavy
  createdAt: 1710000000000,
  label: '面板显示用摘要…'
}]
```

- Host `sanitizeAnnotations`：每本 ≤ 1000 条；字段截断/范围校验；颜色白名单；非法条目丢弃（不整批 400）。
- 样式默认：`state.settings.annotationStyle = { mode, color, strength, thickness, underlineStyle }`；缺省回落全局常量。
- 去重：同 chapter+start+end+type 的新标注替换旧标注。

### 4.2 渲染：CSS Custom Highlight（`assets/lib/highlights.mjs`）

| 层 | 高亮名 | 样式 | priority |
| --- | --- | --- | --- |
| 朗读当前句 | `bb-ra` | `color: <palette.bg>; background-color: <palette.fg>` | 0 |
| 标注 | `bb-an-<id>` | 高亮：`background-color: color-mix(in srgb, <color> <strength>%, transparent)`；下划线：`text-decoration-*` | 100 |

- 反色 = 文字色当底、底色当字色；`auto` 模式取 DSH token 真实底色，浅色页黑底白字、深色页白底黑字。
- 标注优先级更高：重叠区域由标注样式覆盖，满足「经过带标注句子时盖掉朗读效果」。
- 重绘时机：句子切换、章节切换、分页重排、字号/字体变化、标注增删。
- 回退：无 `CSS.highlights` 时用现有 overlay 色带（朗读退化为荧光笔、标注用半透明带/伪下划线），功能不丢。

### 4.3 创建 / 删除

- 选区右键菜单「高亮 / 下划线」按当前样式创建。
- 面板条目可删除、点击跳转。

---

## 5. 标注样式面板（阅读器内）

- 位置：工具条**书签按钮右侧**的新按钮（标记笔图标），下拉浮层 `.bs-annotation-menu`。
- 内容：样式（高亮/下划线）· 彩虹取色条（hue slider）· 取色框（`input[type=color]`）· 强度条 · 粗细条 · 下划线样式（实线/虚线/点线/波浪）· 实时预览。
- 写入 `state.settings.annotationStyle`；无记录时用默认值。

---

## 6. 右键菜单与 TTS 重定位

### 6.1 菜单

复制 · 复制并附出处 · 朗读选中文字 · 高亮 · 下划线（去掉「全选本章」）。

### 6.2 重定位

1. 选区 → 切句 → 临时句列，`cache: false` 播放。
2. 选区结束句 = 新锚点；播放结束后取当前章节批次，定位到「包含选区末尾的句子」，**从该句重新开始**连续朗读。
3. 跨章选区只取当前章节部分；章节推进仍由 driver 负责。
4. 重定位后暂停/上下一句仍作用于重定位后的批次。

### 6.3 不缓存

- 客户端 `audioFor(text, { cache: false })` 跳过内存缓存。
- `POST /tts/synthesize` 支持 `cache: false`；`tts/service.js` 跳过磁盘缓存读写，音频写 `tts-scratch/`（启动时与每次合成时清理 >10 分钟旧文件），URL 仍走 `/tts/audio/...`，不计入 LRU。
- 其余朗读保持缓存。

---

## 7. 书签 / 标注面板

- TOC / 书签 tab 条**下方**新增工具行：排序下拉（位置 / 时间 / 类型）+ 搜索框（对 quote/label/章节名不区分大小写匹配）。
- 行首图标三类：整页书签（书签实心）、高亮（标记笔）、下划线（下划线图标）。
- 行内容：图标 + 主文本（书签「第 N 页 · x%」/ 标注摘要）+ 次信息（章节 / 时间）+ 删除。
- tab 标题带数量。

---

## 8. 任务图（并发 + 写作用域）

> 任务创建在 Team 共享任务板。Wave 0 两条线文件互斥可并行；Wave 1 全部是**新文件**可并行；Wave 2 的 client.js 胶水通过 **git worktree** 隔离并行，由 Lead 合并。

### Wave 0 —— 拆分（并行 2）

| ID | 内容 | 写作用域 |
| --- | --- | --- |
| R1 | 客户端逻辑外置：`assets/lib/*`（text-index、palette、utils、clipboard、speech 计算等）+ locale 拆分与加载器 + `client.js` 区块 banner + 文档 | `client.js`、`assets/lib/**`、`assets/locales/**`、`docs/DEVELOPMENT.md` |
| R2 | Host 拆分：`host/**` + 薄 `index.js` + `tts/**`（门面保留）+ audiobook 纯函数外置 | `index.js`、`host/**`、`tts.js`、`tts/**`、`audiobook.js`、`assets/lib/audiobook-*.mjs` |

### Wave 1 —— 新模块（并行 5，全部新文件）

| ID | 内容 | 写作用域 | 依赖 |
| --- | --- | --- | --- |
| M1 | 标注模型与清洗（Host/Client 共用）+ 单测 | `assets/lib/annotations.mjs`、`tests/annotations-model.mjs` | R1 |
| M2 | 渲染计划：反色取色、标注样式、优先级、DOM 应用、回退判定 | `assets/lib/highlights.mjs`、`tests/highlights-plan.mjs` | R1 |
| M3 | 选区朗读：句子切分、重定位目标句、缓存策略 | `assets/lib/selection-speech.mjs`、`tests/selection-speech.mjs` | R1 |
| M4 | Host 持久化与不缓存：`sanitizeAnnotations`、`cache:false` 管道、scratch 目录 | `host/states.js`、`tts/cache.js`、`tts/service.js`、`host/tts-routes.js`、`tests/annotations-api.mjs`、`tests/tts-no-cache.mjs` | R2 |
| M5 | 面板列表模型：合并、排序、搜索 | `assets/lib/reading-list.mjs`、`tests/reading-list.mjs` | R1 |

### Wave 2 —— client.js 胶水（worktree 隔离，并行 2）

| ID | 内容 | 写作用域 | 依赖 |
| --- | --- | --- | --- |
| G1 | 阅读器 chrome 与面板：书签右侧标注按钮 + 样式浮层 + 选区菜单项 + aside 排序/搜索/图标 + 功能样式 | `client.js`（chrome/aside/selection 区块）、`tests/annotations-ui.mjs`、`tests/annotations-panel.mjs`、`tests/selection-menu.mjs` | M1,M3,M5 |
| G2 | 绘制与朗读接线：反色高亮、标注绘制调用点、重定位/不缓存接线 | `client.js`（frame/read-aloud 区块）、`tests/highlights-browser.mjs`、`tests/selection-speech-browser.mjs` | M2,M3,M4 |

> G1 与 G2 分处 `client.js` 两端，各自在独立 worktree 中完成并提交，Lead 依次合并（3-way 冲突预期为 0；若出现，Lead 手工裁决）。

### Wave 3 —— 集成（Lead）

全量回归（语法/单元/全部浏览器套件 + 新增 6 个套件）、README 与 DEVELOPMENT、版本号与发布整理。

---

## 9. 测试计划

- 单元：`annotations-model`、`highlights-plan`、`selection-speech`、`reading-list`、`annotations-api`、`tts-no-cache`。
- 浏览器：`annotations-ui`（样式面板、创建/删除、持久化）、`annotations-panel`（图标/排序/搜索）、`selection-menu`（菜单项、去掉全选、重定位后可续读）、`highlights-browser`（反色色值、标注覆盖、回退）、`selection-speech-browser`（不缓存请求、续读）。
- `tests/run-browser.mjs` 注册新套件；CI 矩阵不变。

---

## 10. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `::highlight` 样式属性受限（如粗细/样式不支持） | 先做能力探测；不支持时下划线退化为 `border-bottom` 伪元素层，反色退化为荧光笔 |
| 高亮 ranges 在分页重排后失效 | 与现有 `paintSpeechGlass` 相同的重绘触发点；每帧重建 Range |
| 每本标注过多导致面板卡顿 | ≤1000 条 + 搜索/排序在模型层做，列表窗口化留待后续 |
| worktree 合并 client.js 冲突 | 区块 banner + 两端修改；冲突由 Lead 裁决 |
| 逻辑外置后 HMR 双源（`assets/lib` 改动需要刷新） | 文档说明：改 `assets/lib` 后刷新页面；Host 侧文件改动需要重启/重载插件 |
