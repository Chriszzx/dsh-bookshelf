// Bookshelf locale dictionary — Tag manager and per-book tag assignment.
// Browser module loaded by the locale loader in client.js (classic script, so
// no static import). `en` and `zh` must keep the same key set.

export const en = {
  bookTags: 'Tags…',
  manageTags: 'Manage tags',
  manageTagsHint: 'Create, rename, or delete the tags used to group books.',
  tagsLabel: 'Tags',
  tagsEmpty: 'No custom tags yet.',
  newTagLabel: 'New tag',
  newTagPlaceholder: 'Tag name',
  createTag: 'Create',
  tagNameLabel: 'Tag name',
  tagBookCount: '{count} books',
  renameTag: 'Rename',
  deleteTag: 'Delete tag',
  confirmDeleteTag: 'Delete anyway',
  deleteTagHint: 'Deleting this tag also removes it from {count} books.',
  done: 'Done',
  tagsSaved: 'Tags saved.',
  tagsSaveFailed: 'Could not save tags: {message}',
  tagRequestFailed: 'The bookshelf service returned an unexpected response.',
}

export const zh = {
  bookTags: '标签…',
  manageTags: '管理标签',
  manageTagsHint: '新建、改名或删除用于分类书籍的标签。',
  tagsLabel: '标签',
  tagsEmpty: '还没有自定义标签。',
  newTagLabel: '新建标签',
  newTagPlaceholder: '标签名称',
  createTag: '新建',
  tagNameLabel: '标签名称',
  tagBookCount: '{count} 本',
  renameTag: '改名',
  deleteTag: '删除标签',
  confirmDeleteTag: '确认删除',
  deleteTagHint: '删除后，{count} 本书上的这个标签也会移除。',
  done: '完成',
  tagsSaved: '标签已保存。',
  tagsSaveFailed: '保存标签失败：{message}',
  tagRequestFailed: '书架服务返回了异常响应。',
}
