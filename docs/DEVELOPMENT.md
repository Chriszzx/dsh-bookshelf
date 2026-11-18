# 开发与发布

## 开发

每轮从最新的 `main` 开始，在 `next` 小步提交。日常开发通过分支推送运行 CI，单人维护默认省去自提 PR。

在 DSH 插件管理器中添加检出的仓库绝对路径，让 DSH 链接本地源码。修改 Host 后重启 DSH，修改客户端或浏览器资源后刷新页面。开发使用独立的 `DSH_HOME` 和样书，避免影响日常书库。已安装其他来源的同名插件时，通过插件管理器切换来源。

本地维护笔记放在 `docs/local/`，临时产物放在 `.local/`。两个目录和本地 `AGENTS.md`、`AGENTS.local.md` 已加入 Git 忽略规则。

需要 Node `^22.19.0 || >=24.0.0`、pnpm `11.28.5` 和 Chrome、Chromium 或 Edge。

```sh
pnpm install --frozen-lockfile --ignore-scripts
node tests/run-browser.mjs layout-fonts pagination-geometry
node scripts/run-checks.mjs all
```

## 验收

- 每次改动先跑相关测试。发布候选执行完整检查，覆盖语法、单元、接口和浏览器回归。远端 CI 验证 Windows、macOS 与 Node 22、24。
- 发布前用一份 EPUB 和一份 PDF 在 DSH 检查导入、阅读、标注和关书重开。EPUB 排版改动还要检查窄窗口、单双页切换和换字体后的位置。阅读记录改动还要检查加载失败后重试和多窗口同时编辑。
- 自动化使用隔离书库与测试替身。桌面验收使用本机系统朗读，讨论功能验到捕获页面及生成草稿为止。

## 发布

1. 更新 `package.json` 版本号和受影响的用户文档。日常把用户可感知的变更写入 [CHANGELOG.md](../CHANGELOG.md) 的「未发布」段，发版时移入对应版本，并据此准备中英文 Release 说明。确认提交里没有个人书库、阅读记录、密钥、机器路径和临时素材。
2. 获准后推送 `next`，等候选提交的远端 CI 通过。用独立的 `DSH_HOME` 通过 GitHub 安装同一提交，确认 `ui-bookshelf` 已加入配置，再启动 DSH 打开书架和样书。

   ```sh
   dsh plugin --profile web add 'github:Chriszzx/dsh-bookshelf#<commit-sha>'
   dsh --profile web --dump-config
   ```

3. 从干净的候选提交运行 `npm run pack:release`。在 `.local/release/vX.Y.Z/` 核对 `dsh-bookshelf-X.Y.Z.tgz` 和对应的 `.sha256`，确认包中含 Host、Client、Bundle 配置与阅读资源。需要重新打包同一版本时，先移开旧的本地产物。在另一个隔离的 `DSH_HOME` 中安装这份包，启动真实 DSH Web。从侧栏打开书架，导入 EPUB 和 PDF 样书，翻页并添加书签，关书重开后核对页码和书签。记录实际测试的 DSH 版本。

   ```sh
   dsh plugin --profile web add ./.local/release/vX.Y.Z/dsh-bookshelf-X.Y.Z.tgz
   dsh --profile web --dump-config
   dsh --profile web --host 127.0.0.1 --port 0 --no-open
   ```
4. 验收通过且获准发布后，以快进方式将该提交更新到 `main`，给同一提交打 `vX.Y.Z` 标签。在 GitHub Release 上传发布包与校验文件，填写中英文说明，核对两个附件后发布正式版。README 的默认安装方式是 GitHub 源码，Release 提供固定版本的独立安装包。
5. 目录条目的描述或安装信息需要调整时，再按第三方目录流程提交。市场截图在本仓库的 `screenshots.json` 维护。
