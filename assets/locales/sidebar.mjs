// Bookshelf locale dictionary — Books right-sidebar tab and composer seed.
// Browser module loaded by the locale loader in client.js (classic script, so
// no static import). `en` and `zh` must keep the same key set.

export const en = {
  sidebarTitle: 'Books (Shelf)',
  sidebarEmpty: 'The page snapshot from the bookshelf appears here.',
  sidebarShelf: 'Open bookshelf',
  sidebarResume: 'Continue in bookshelf',
  sidebarChoose: 'Choose a linked EPUB',
  sidebarLoading: 'Loading bookshelf…',
  sidebarNoBooks: 'No EPUBs are linked yet. Add a local book in the bookshelf first.',
  sidebarFailed: 'Could not load the bookshelf.',
  sidebarFixed: 'This page snapshot is fixed in this conversation.',
  sidebarPartial: 'Visible text only; images and off-page content are excluded.',
  sidebarTruncated: 'The page exceeded the snapshot limit; its beginning was retained.',
  sidebarCaptured: 'Captured',
  sidebarSelection: 'Selection at capture',
  sidebarOpen: 'Open Books',
  sidebarRetry: 'Retry opening Books',
  sidebarAutoFailed: 'The page snapshot is saved; click to open Books.',
  sidebarSeedFailed: 'The page file could not be placed in the composer. Reopen the conversation and try the capture again.',
  sidebarGuidance: 'Open a book in the bookshelf, then choose “Discuss this page”.',
}

export const zh = {
  sidebarTitle: '书架 Books',
  sidebarEmpty: '从书架带入的页面快照会显示在这里。',
  sidebarShelf: '打开书架',
  sidebarResume: '回书架阅读',
  sidebarChoose: '选择已接入的 EPUB',
  sidebarLoading: '正在读取书架…',
  sidebarNoBooks: '书架中还没有 EPUB。请先在书架接入本地书籍。',
  sidebarFailed: '无法读取书架。',
  sidebarFixed: '这份页面快照固定保存在当前会话中。',
  sidebarPartial: '仅包含可见文字；图片与页面外内容未加入。',
  sidebarTruncated: '本页文字超出快照上限，已保留前部内容。',
  sidebarCaptured: '捕获时间',
  sidebarSelection: '捕获时的选区',
  sidebarOpen: '打开 Books',
  sidebarRetry: '重试打开 Books',
  sidebarAutoFailed: '页面快照已保存；点击此处打开 Books。',
  sidebarSeedFailed: '页面文件未能放入输入框。请重新打开会话后再试。',
  sidebarGuidance: '在书架打开书籍，然后点击“讨论此页”。',
}
