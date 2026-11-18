import assert from 'node:assert/strict'
import { unzipSync, zipSync } from '../../assets/fflate.mjs'

// All three books use the same chapter and selectors. Remove font entries
// only in temporary variants so the published sample stays byte-for-byte intact.
export function embeddedFontFixtures(archive) {
  const files = unzipSync(archive)
  const bytes = new Map()
  for (const face of ['Regular', 'Bold', 'Italic']) {
    bytes.set('/test-font/' + face, files['EPUB/OldStandard-' + face + '.woff'])
  }
  const withoutBold = { ...files }
  delete withoutBold['EPUB/OldStandard-Bold.woff']
  const corrupt = { ...files }
  for (const name of Object.keys(corrupt).filter(name => name.endsWith('.woff'))) {
    corrupt[name] = corrupt[name].subarray(0, 20)
  }
  delete files['EPUB/OldStandard-Italic.woff']
  const missingItalic = zipSync(files)
  delete files['EPUB/OldStandard-Regular.woff']
  delete files['EPUB/OldStandard-Bold.woff']
  const gate = Promise.withResolvers()
  return {
    books: [archive, missingItalic, zipSync(files), zipSync(withoutBold), zipSync(corrupt)],
    release: gate.resolve,
    async serve(path, res) {
      if (!bytes.has(path)) return false
      await gate.promise
      res.setHeader('Content-Type', 'font/woff')
      res.end(bytes.get(path))
      return true
    },
  }
}

// Ask the renderer which glyph source it actually painted. A computed CSS
// font-family by itself still lists a face whose resource is missing.
async function paintedFace(command, selector) {
  const { root } = await command('DOM.getDocument', { depth: 1 })
  const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: '.bs-epub-frame' })
  const { node } = await command('DOM.describeNode', { nodeId })
  const { nodeIds } = await command('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [node.contentDocument.backendNodeId] })
  const element = await command('DOM.querySelector', { nodeId: nodeIds[0], selector })
  const { fonts } = await command('CSS.getPlatformFontsForNode', { nodeId: element.nodeId })
  return fonts.find(font => font.glyphCount > 0)
}

export async function verifyEmbeddedFonts({ evaluate, command, fixture, state }) {
  await command('DOM.enable', {})
  await command('CSS.enable', {})
  await evaluate(`(async()=>{
    click('dismiss')
    window.fontFrame=()=>document.querySelector('.bs-epub-frame')
    window.openFontBook=async number=>{
      click('back')
      await until(()=>document.querySelector('.bs-card'))
      document.querySelector('[aria-label="finishPromptTitle"] [aria-label="dismiss"]')?.click()
      const card=[...document.querySelectorAll('.bs-card')].find(c=>c.querySelector('.bs-book-title')?.textContent==='Layout '+number)
      card.querySelector('.bs-cover').click()
      await until(()=>fontFrame()?.contentDocument?.querySelector('#titlepage') && fontFrame().contentDocument.documentElement.classList.contains('bb-paged'))
      await fontFrame().contentDocument.fonts.ready
    }
  })()`)
  for (const [number, custom, boldFace, italic] of [[3, true, true, true], [4, true, true, false], [5, false], [6, true, false, true], [7, false]]) {
    await evaluate(`openFontBook(${number})`)
    const regular = await paintedFace(command, '#titlepage .aut')
    const bold = await paintedFace(command, '#titlepage h1')
    const emphasis = await paintedFace(command, 'em')
    assert.equal(regular.isCustomFont, custom)
    assert.equal(bold.isCustomFont, custom)
    assert.equal(emphasis.isCustomFont, custom)
    if (custom) {
      assert.match(regular.postScriptName, /OldStandard.*Regular/i)
      assert.equal(bold.postScriptName, boldFace ? 'OldStandardTT-Bold' : regular.postScriptName)
      assert.equal(emphasis.postScriptName, italic ? 'OldStandardTT-Italic' : regular.postScriptName)
    }
    assert.ok(await evaluate("Number(fontFrame().contentWindow.getComputedStyle(fontFrame().contentDocument.querySelector('h1')).fontWeight)>=600"))
    assert.equal(await evaluate("fontFrame().contentWindow.getComputedStyle(fontFrame().contentDocument.querySelector('em')).fontStyle"), 'italic')
    console.log('EPUB painted faces', number, [regular, bold, emphasis].map(f => f.postScriptName))
  }

  await evaluate(`(async()=>{
    if (!document.querySelector('.bs-aside-tab')) click('toc')
    document.querySelector('.bs-aside-tab').click()
    await until(()=>document.querySelectorAll('.bs-toc-label').length===6)
    document.querySelectorAll('.bs-toc-label')[1].click()
    await until(()=>document.querySelector('.bs-toc-label[aria-current="true"]')?.textContent.includes('GAME OF CHESS'))
  })()`)
  assert.equal(await evaluate("document.querySelectorAll('.bs-toc-label[aria-current=true]').length"), 1)
  const markDetail = await evaluate(`(async()=>{
    const frame = fontFrame()
    const line = frame.contentDocument.getElementById('ln77')
    const text = line.firstChild
    const start = text.data.indexOf('burnished')
    frame.contentWindow.getSelection().setBaseAndExtent(text, start, text, start + 'burnished'.length)
    line.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await until(()=>document.querySelector('.bs-selection-menu'))
    Array.from(document.querySelectorAll('.bs-selection-item')).find(n=>n.textContent==='selectionHighlight').click()
    document.querySelectorAll('.bs-aside-tab')[1].click()
    await until(()=>document.querySelector('.bs-reading-row[data-kind="highlight"]'))
    return document.querySelector('.bs-reading-row[data-kind="highlight"]').textContent
  })()`)
  assert.match(markDetail, /burnished.*II\. A GAME OF CHESS/)
  await evaluate('openFontBook(3)')
  // Hold the exact three WOFF byte streams at a loopback endpoint after the
  // first layout. This exercises a later loading cycle on an interactive page.
  await evaluate(`(async()=>{
    if (!document.querySelector('.bs-aside-tab')) click('toc')
    document.querySelectorAll('.bs-aside-tab')[1].click()
    await wait(400)
    const doc=fontFrame().contentDocument
    const pageOf=range=>Math.floor((range.getClientRects()[0].left+doc.body.scrollLeft)/doc.body.clientWidth)
    const candidates=[]
    const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT)
    while(walker.nextNode()){
      const node=walker.currentNode, text=node.nodeValue, start=text.search(/[^\\s]/)
      if(start<0 || text.trim().length<12) continue
      const range=doc.createRange()
      range.setStart(node,start)
      range.setEnd(node,Math.min(text.length,start+36))
      if(range.getClientRects().length) candidates.push({range,page:pageOf(range)})
    }
    const sheet=[...doc.styleSheets].find(s=>[...s.cssRules].some(r=>r.type===CSSRule.FONT_FACE_RULE))
    for (const rule of [...sheet.cssRules].filter(r=>r.type===CSSRule.FONT_FACE_RULE)) {
      const style=rule.style, face=style.fontStyle==='italic'?'Italic':style.fontWeight==='bold'||style.fontWeight==='700'?'Bold':'Regular'
      style.setProperty('src','url("'+location.origin+'/test-font/'+face+'")')
    }
    await until(()=>doc.fonts.status==='loading')
    // Choose a noninitial passage that actually crosses a column boundary
    // on this machine. System fallback metrics vary by OS and browser.
    const candidate=candidates.find(c=>c.page>2 && c.page!==pageOf(c.range))
    if(!candidate) throw Error('No passage changed pages in the fallback layout')
    const range=candidate.range
    const passage=range.startContainer.parentElement
    const selection=doc.getSelection()
    selection.removeAllRanges(); selection.addRange(range)
    passage.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))
    await until(()=>document.querySelector('.bs-selection-menu'))
    Array.from(document.querySelectorAll('.bs-selection-item')).find(n=>n.textContent==='selectionHighlight').click()
    if (!document.querySelector('.bs-aside-tab')) click('toc')
    document.querySelectorAll('.bs-aside-tab')[1].click()
    await until(()=>document.querySelector('.bs-reading-row[data-kind="highlight"]'))
    document.querySelector('.bs-reading-row[data-kind="highlight"] .bs-reading-main').click()
    window.inspectPassage=()=>{
      const f=fontFrame(), d=f.contentDocument
      const mark=[...f.contentWindow.CSS.highlights].find(([key])=>key.startsWith('bb-an-'))
      const range=mark && [...mark[1]][0], rect=range?.getClientRects()[0]
      return {quote:range?.toString(),visible:!!rect && rect.left>=-1 && rect.left<f.contentWindow.innerWidth,
        scroll:d.body.scrollLeft,width:d.body.scrollWidth,step:d.body.clientWidth,status:d.fonts.status}
    }
    await until(()=>inspectPassage().visible && doc.body.scrollLeft>0)
  })()`)
  const before = await evaluate('inspectPassage()')
  assert.equal(before.status, 'loading')
  fixture.release()
  await evaluate(`(async()=>{await fontFrame().contentDocument.fonts.ready; await until(()=>inspectPassage().visible); await wait(650)})()`)
  const after = await evaluate('inspectPassage()')
  assert.equal(after.quote, before.quote)
  assert.ok(after.visible && after.scroll > 0)
  assert.notEqual(before.width, after.width, 'the font changed the chapter page count')
  assert.notEqual(before.scroll, after.scroll, 'the passage moved to another page as the font loaded')
  const counts = await evaluate(`(()=>{
    const label=[...document.querySelectorAll('.bs-control-label')].find(n=>n.textContent.includes('pageOf(')).textContent
    const faces=[...document.querySelector('.bs-epub-probe').contentDocument.fonts]
    return {label, loaded:faces.filter(face=>face.status==='loaded').length}
  })()`)
  assert.equal(counts.loaded, 3, 'the background counter also loaded each published face')
  const total = Math.round(after.width / after.step)
  const page = Math.round(after.scroll / after.step) + 1
  assert.equal(counts.label, `pageOf(current=${page},total=${total})`)
  const saved = await state()
  assert.ok(Math.abs(saved.progress.percent - (page - 1) / (total - 1)) < .00001)
  assert.ok(saved.progress.pageLocator && saved.progress.percent > 0)
  assert.equal(saved.annotations[0].quote, before.quote)
  await evaluate('openFontBook(3)')
  await evaluate('until(()=>inspectPassage().visible)')
  const reopened = await evaluate('inspectPassage()')
  assert.equal(reopened.quote, before.quote)
  assert.equal(reopened.scroll, after.scroll)
  await evaluate(`(async()=>{click('readingSettings'); await until(()=>document.querySelector('select[aria-label="fontFamily"]')); choose('fontFamily','preset:mono'); await wait(250)})()`)
  assert.equal((await paintedFace(command, '#titlepage .aut')).isCustomFont, false)
  await evaluate(`(async()=>{choose('fontFamily','preset:publisher'); await fontFrame().contentDocument.fonts.ready; await wait(250)})()`)
  assert.equal((await paintedFace(command, '#titlepage .aut')).postScriptName, 'OldStandardTT-Regular')
  console.log('Delayed publication font, mark and resume', { before, after, percent: saved.progress.percent })
}
