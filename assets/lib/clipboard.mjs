/**
 * Clipboard write used by the reader's selection menu. Async Clipboard API
 * first, legacy textarea/execCommand fallback for documents where the modern
 * API is unavailable or denied. Loaded by the reader preload in client.js.
 */

export async function writeClipboard(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied: fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}
