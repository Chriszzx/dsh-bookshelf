// Shared validation and browser-local font discovery. No font inventory or font
// bytes leave the reading device; the Host persists only the user's selection.
export const FONT_FALLBACKS = {
  serif: "'Iowan Old Style','Palatino Linotype','Songti SC','STSong','Noto Serif SC','Noto Serif CJK SC',serif",
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif",
  mono: "ui-monospace,'SFMono-Regular',Menlo,Consolas,'Noto Sans Mono CJK SC',monospace",
}

export function sanitizeFontSettings(value) {
  const settings = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return settings
  if (value.fontFamily === 'publisher' || Object.hasOwn(FONT_FALLBACKS, value.fontFamily)) settings.fontFamily = value.fontFamily
  if (typeof value.fontName === 'string' && value.fontName.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value.fontName)) {
    settings.fontName = value.fontName.trim()
  }
  if (typeof value.fontWeight === 'number' && Number.isFinite(value.fontWeight) &&
      (value.fontWeight === 0 || value.fontWeight >= 100 && value.fontWeight <= 900)) {
    settings.fontWeight = Math.round(value.fontWeight)
  }
  if (value.fontStyle === 'normal' || value.fontStyle === 'italic') settings.fontStyle = value.fontStyle
  return settings
}

export function fontStack(settings) {
  const clean = sanitizeFontSettings(settings)
  const fallback = FONT_FALLBACKS[clean.fontFamily] || FONT_FALLBACKS.serif
  return clean.fontName ? `${quoteFont(clean.fontName)},${fallback}` : fallback
}

function quoteFont(value) {
  return `"${value.replace(/[\\"]/gu, '\\$&')}"`
}

const COMMON_FONTS = [
  ['Microsoft YaHei', '微软雅黑'], ['SimSun', '宋体'], ['KaiTi', '楷体'], ['FangSong', '仿宋'],
  ['DengXian', '等线'], ['Microsoft JhengHei', '微軟正黑體'],
  ['Noto Serif SC', 'Noto Serif SC ExtraLight', 'NotoSerifSC-ExtraLight'],
  ['Noto Sans SC', 'Noto Sans SC Thin', 'NotoSansSC-Thin'],
  ['Noto Serif CJK SC'], ['Noto Sans CJK SC'],
  ['Source Han Serif CN', 'Source Han Serif CN Medium', '思源宋体 CN Medium'],
  ['Source Han Serif SC'], ['Source Han Sans SC'],
  ['LXGW WenKai', '霞鹜文楷', 'LXGWWenKai-Regular'],
  ['Songti SC'], ['PingFang SC'], ['Hiragino Sans GB'], ['Heiti SC'], ['STSong'],
  ['Georgia'], ['Times New Roman'], ['Palatino Linotype'], ['Arial'], ['Segoe UI'],
  ['Consolas'], ['Menlo'], ['Cascadia Code'],
]
let catalog = null
let commonPromise = null
const stylesCache = new Map()

export async function getFontCatalog() {
  if (catalog) return catalog
  if (!commonPromise) {
    commonPromise = Promise.all(COMMON_FONTS.map(async ([family, ...aliases], index) => {
      if (typeof FontFace !== 'function') return null
      try {
        // check() alone can return true for a missing family via fallback. An
        // explicit local() face must load before we list a candidate as usable.
        const face = new FontFace(`bookshelf-probe-${index}`, [family, ...aliases].map(name => `local(${quoteFont(name)})`).join(','))
        await face.load()
        return { family, faces: [] }
      } catch { return null }
    })).then(fonts => {
      // A full scan may finish while the common probes are still loading.
      if (!catalog?.complete) catalog = { fonts: fonts.filter(Boolean), complete: false }
      return catalog
    })
  }
  return commonPromise
}

export async function scanSystemFonts() {
  if (typeof window.queryLocalFonts !== 'function') {
    const error = new Error('Local font access is unavailable')
    error.name = 'NotSupportedError'
    throw error
  }
  // Call before the first await: queryLocalFonts requires a user gesture.
  const request = window.queryLocalFonts()
  const faces = await request
  const groups = new Map()
  for (const face of faces) {
    const family = sanitizeFontSettings({ fontName: face.family }).fontName
    if (!family) continue
    if (!groups.has(family)) groups.set(family, { family, faces: [] })
    groups.get(family).faces.push(face)
  }
  catalog = { fonts: [...groups.values()].sort((a, b) => a.family.localeCompare(b.family)), complete: true }
  stylesCache.clear()
  return catalog
}

// Read only small OpenType metadata tables, rather than decoding or copying an
// entire CJK font. Variable weights and true italics cannot be inferred from a
// GDI family name or from whether a browser can synthesize a style.
export async function readFontMetadata(blob) {
  const read = async (offset, length) => {
    if (offset < 0 || length < 0 || offset + length > blob.size) throw new Error('Invalid font metadata')
    return new DataView(await blob.slice(offset, offset + length).arrayBuffer())
  }
  const header = await read(0, Math.min(16, blob.size))
  if (header.byteLength < 12) throw new Error('Invalid font header')
  const collection = header.getUint32(0) === 0x74746366
  const offset = collection ? header.getUint32(12) : 0
  const sfnt = collection ? await read(offset, 12) : header
  const count = sfnt.getUint16(4)
  if (count > 4096) throw new Error('Invalid font table count')
  const directory = await read(offset + 12, count * 16)
  const tables = new Map()
  for (let i = 0; i < count; i++) {
    const p = i * 16
    tables.set(directory.getUint32(p), { offset: directory.getUint32(p + 8), length: directory.getUint32(p + 12) })
  }
  const weights = new Set()
  let italic = false
  let normal = true
  const os2 = tables.get(0x4f532f32)
  if (os2 && os2.length >= 64) {
    const data = await read(os2.offset, 64)
    const weight = data.getUint16(4)
    if (weight >= 100 && weight <= 900) weights.add(weight)
    italic = Boolean(data.getUint16(62) & 0x201)
    normal = !italic
  }
  const variable = tables.get(0x66766172)
  if (variable && variable.length >= 16) {
    const data = await read(variable.offset, 16)
    const start = data.getUint16(4), axes = data.getUint16(8), size = data.getUint16(10)
    if (size < 20 || axes > 64 || start + axes * size > variable.length) throw new Error('Invalid variable font axes')
    const axisData = await read(variable.offset + start, axes * size)
    for (let i = 0; i < axes; i++) {
      const p = i * size, tag = axisData.getUint32(p)
      const min = axisData.getInt32(p + 4) / 65536, max = axisData.getInt32(p + 12) / 65536
      if (tag === 0x77676874) {
        for (let weight = 100; weight <= 900; weight += 100) if (weight >= min && weight <= max) weights.add(weight)
      }
      if ((tag === 0x6974616c && max >= 1) || (tag === 0x736c6e74 && (min < 0 || max > 0))) italic = true
      if ((tag === 0x6974616c || tag === 0x736c6e74) && min <= 0 && max >= 0) normal = true
    }
  }
  return { weights: [...weights].sort((a, b) => a - b), italic, normal }
}

export function getFontStyles(family) {
  if (!stylesCache.has(family)) {
    const font = catalog?.fonts.find(item => item.family === family)
    const request = Promise.all((font?.faces || []).map(async face => {
      try { return await readFontMetadata(await face.blob()) }
      catch { return null }
    })).then(faces => ({
      known: faces.some(Boolean),
      weights: [...new Set(faces.flatMap(face => face?.weights || []))].sort((a, b) => a - b),
      normalWeights: [...new Set(faces.flatMap(face => face?.normal ? face.weights : []))].sort((a, b) => a - b),
      italicWeights: [...new Set(faces.flatMap(face => face?.italic ? face.weights : []))].sort((a, b) => a - b),
      italic: faces.some(face => face?.italic),
    }))
    stylesCache.set(family, request)
  }
  return stylesCache.get(family)
}
