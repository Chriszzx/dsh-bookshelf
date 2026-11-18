import { hasSameAnchor } from './annotations.mjs'

// A reader edits only the item it selected. Apply these in order to either the
// optimistic view or the Host's latest state inside its serialized write.
export function applyMarkEdits(state, edits) {
  const next = { ...state }
  for (const { collection, id, value } of edits) {
    const items = Array.isArray(next[collection]) ? next[collection] : []
    const remaining = items.filter(item => {
      if (item.id === id) return false
      if (!value) return true
      if (collection === 'annotations') return !hasSameAnchor(item, value)
      return value.format !== 'pdf' || item.format !== 'pdf' || item.page !== value.page
    })
    next[collection] = value ? [value, ...remaining] : remaining
  }
  return next
}
