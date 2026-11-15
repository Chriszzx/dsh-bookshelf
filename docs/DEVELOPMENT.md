# 本地开发与测试

下一版从本仓库的 `next` 分支继续开发。插件正式名称保持 `dsh-bookshelf`；当前发布版本为 `0.4.0`，功能变更在发布时递增版本号。

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
- `test:browser`：依次运行可见文本捕获、文件导入、讨论交接、阅读状态恢复、分页几何，以及书架布局／字体设置测试。
- `test:all`：依次执行以上三类检查。

单独运行一组浏览器回归：

```sh
pnpm run test:browser file-import
pnpm run test:browser tab-persistence pagination-geometry
pnpm run test:browser layout-fonts
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

## 字体与布局回归

`layout-fonts` 保持窗口宽度不变，改变主面板宽度来模拟侧栏开合，验证卡片尺寸、左对齐与窄面板布局；同时检查 Windows／macOS 顶部安全区和设置弹窗位置。字体访问使用受控的成功／拒绝响应，验证点击手势、原生字重／斜体元数据、默认设置与单书设置隔离、重新打开后的恢复，以及换字体后的分页锚点。测试不授予真实系统字体访问权限；真实授权弹窗和字体渲染效果需要在现有 GUI 中人工验收。

## CI 与验收边界

GitHub Actions 配置了 Windows／macOS × Node 22／24 的语法及 Node 测试，并在 Node 24 上执行浏览器回归。首次 push 后才能观察远端 CI 结果。

浏览器测试使用真实书架 Host、Client 和阅读器代码，但 DSH 外壳与会话 transport 有测试替身。因此自动化测试通过后，仍需在当前 DSH 页面完成原生文件夹选择器、面板切换和真实会话侧栏的人工验收；不要把独立测试页通过当成整个 DSH 界面的视觉验收。
