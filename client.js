window.__ModuleLoader__.load({
  id: 'dsh-bookshelf',
  factory(require) {
    // ===== [prelude] =====
    // Plugin identity, storage keys and the constants every later section
    // reads. This file is a classic script: the factory receives React and
    // nothing else, so browser modules are loaded with dynamic imports.

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React

    const NS = 'bookshelf'
    const PANEL_ID = 'bookshelf'
    const API_ROOT = 'bookshelf/api'
    const ASSET_ROOT = 'bookshelf/assets'
    // Bump when a served browser asset changes so a loaded page cannot keep an
    // older module from its HTTP cache.
    const ASSET_VERSION = '10'
    const DISCUSSION_WORKSPACE_KEY = 'bookshelf.discussion.workspace.v1'
    const APPLE_BOOKS_ENABLED_KEY = 'bookshelf.appleBooks.enabled.v1'
    // Shelf arrangement is a reading preference, so it survives a page reload
    // unlike the transient search/sort/category view state.
    const LAYOUT_STORAGE_KEY = 'bookshelf.layout.v1'
    const SHELF_LAYOUTS = ['grid', 'list']
    const BOOKS_TAB_KIND = 'bookshelf-reader'
    // Kept stable across the package rename so an open Books tab and existing
    // page-snapshot sessions keep their ids.
    const SIDEBAR_TAB_ID = '@local/dsh-bookshelf/reader'
    const SIDEBAR_PROJECTION_KEY = 'shelfPageSnapshot'
    const DISCUSSION_BRIDGE_VERSION = 5
    const MAX_IMPORT_BYTES = 256 * 1024 * 1024
    // Built-in categories the shelf can filter by. The Host derives or stores
    // one of these per book; custom tags are referenced by id as `tag:<id>`.
    const STATUS_CATEGORIES = ['unread', 'reading', 'finished']
    const STATUS_LABEL_KEYS = Object.freeze({
      unread: 'statusUnread',
      reading: 'statusReading',
      finished: 'statusFinished',
    })
    // Share of the book that counts as its last page; must match the Host's
    // FINISHED_PERCENT in tags.js.
    const FINISHED_PERCENT = 0.995

    // ===== [styles] =====
    // App CSS plus the reading typography tables and the DSH theme-token
    // resolution used to paint the reading frame. This stays inline: the
    // first paint needs it synchronously.

    const CSS = `
.bs-root{--bs-top-clearance:0px;--bs-popover-top:calc(var(--bs-top-clearance) + 56px);box-sizing:border-box;position:relative;display:flex;flex-direction:column;container:bookshelf / inline-size;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}
/* Windows captions already sit above main; only macOS overlays its chrome. */
:root[data-platform="darwin"] .bs-root{--bs-top-clearance:var(--dsh-frame-top-clearance,0px)}
:root[data-platform] .bs-root:fullscreen{--bs-top-clearance:0px}
.bs-root *,.bs-root *::before,.bs-root *::after{box-sizing:border-box}
.bs-file-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.bs-shelf{display:flex;flex-direction:column;height:100%;min-height:0}
.bs-header{flex:none;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:calc(var(--bs-top-clearance,0px) + 20px) 24px 16px}
.bs-heading{min-width:0}
.bs-title{margin:0;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.01em}
.bs-subtitle{margin:4px 0 0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.bs-header-actions{display:flex;align-items:center;gap:8px;flex:none}
.bs-import-menu-wrap{position:relative;display:inline-flex}
.bs-import-trigger{padding-right:9px}
.bs-import-trigger svg:last-child{opacity:.75}
.bs-import-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:12;display:flex;flex-direction:column;gap:2px;min-width:280px;max-width:calc(100vw - 24px);padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 44px -20px rgba(0,0,0,.55)}
.bs-import-menu-item{display:flex;align-items:flex-start;gap:9px;width:100%;padding:8px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.bs-import-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}
.bs-import-menu-item:focus-visible{background:var(--dsw-alias-bg-layer-2);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-import-menu-item>svg{flex:none;margin-top:2px;color:var(--dsw-alias-label-secondary)}
.bs-import-menu-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.bs-import-menu-info strong{font-size:12.5px;font-weight:600;line-height:1.35}
.bs-import-menu-info span{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.bs-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;font:inherit;font-size:13px;font-weight:500;line-height:1.4;padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.bs-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.bs-button:disabled{opacity:.55;cursor:default}
.bs-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.bs-button-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.bs-button-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.07)}
.bs-icon-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.bs-icon-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-icon-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-icon-button:disabled{opacity:.4;cursor:default}
.bs-icon-button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-scroll{flex:1;min-width:0;min-height:0;overflow:auto;padding:6px 24px 56px;overscroll-behavior:contain}
.bs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(164px,100%),176px));justify-content:start;gap:24px 20px;min-width:0;width:100%;margin:0}
.bs-card{position:relative;display:flex;flex-direction:column;gap:9px;min-width:0}
.bs-cover{position:relative;display:block;width:100%;aspect-ratio:3/4;margin:0;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;text-align:left;color:#f6f1e7;box-shadow:0 1px 2px rgba(0,0,0,.12),0 10px 24px -16px rgba(0,0,0,.55)}
button.bs-cover{cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}
button.bs-cover:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,.16),0 16px 30px -16px rgba(0,0,0,.6)}
button.bs-cover:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.bs-cover-wrap{position:relative;z-index:1;display:block}
.bs-cover-frame{position:absolute;inset:0;display:flex;flex-direction:column;padding:34px 14px 13px}
.bs-cover-frame::before{content:"";position:absolute;inset:8px;border:1px solid rgba(255,255,255,.2);border-radius:4px;pointer-events:none}
.bs-cover-title{position:relative;padding-right:26px;font-family:'Iowan Old Style','Palatino Linotype','Songti SC','STSong','Noto Serif SC','Noto Serif CJK SC',serif;font-size:15.5px;line-height:1.35;font-weight:600;letter-spacing:.01em;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;text-shadow:0 1px 2px rgba(0,0,0,.28)}
.bs-cover-author{position:relative;margin-top:auto;padding-top:12px;padding-right:34px;font-size:11px;line-height:1.4;color:rgba(246,241,231,.76);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-cover-format{position:absolute;top:10px;left:10px;right:auto;padding:2px 5px;border-radius:3px;background:rgba(0,0,0,.3);color:rgba(255,255,255,.86);font-size:9px;font-weight:600;letter-spacing:.12em;line-height:1.4;z-index:3}
.bs-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;opacity:0;background:var(--dsw-alias-bg-base);transition:opacity .18s ease}
.bs-cover-img[data-loaded="true"]{opacity:1}
.bs-cover-frame::before{z-index:2}
.bs-cover-format{z-index:3}
.bs-cover-title,.bs-cover-author{z-index:0}
.bs-shelf-tools{flex:none;display:flex;align-items:center;gap:10px;padding:9px 24px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.bs-search{flex:1;min-width:0;display:flex;align-items:center;gap:7px;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.bs-search:focus-within{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.bs-search-input{flex:1;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.4;outline:none}
.bs-search-input::placeholder{color:var(--dsw-alias-label-secondary)}
.bs-search-clear{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.bs-search-clear:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-search-clear:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-sort{display:flex;align-items:center;gap:6px;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.bs-apple-button{display:inline-flex;align-items:center;gap:5px}
.bs-apple-button-label{white-space:nowrap}
.bs-apple-backdrop{position:absolute;inset:0;z-index:20;background:rgba(8,10,14,.52);backdrop-filter:blur(2px)}
.bs-apple-dialog{position:absolute;z-index:21;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;width:min(760px,calc(100vw - 48px));max-height:min(82vh,760px);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-overlay);box-shadow:0 28px 80px -28px rgba(0,0,0,.72);overflow:hidden}
.bs-apple-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 8px}
.bs-apple-heading{display:flex;flex-direction:column;gap:3px;min-width:0}
.bs-apple-title{margin:0;font-size:15px;line-height:1.35;font-weight:600;color:var(--dsw-alias-label-primary)}
.bs-apple-hint{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.bs-apple-search{flex:none;display:flex;align-items:center;gap:7px;height:34px;margin:0 18px 8px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.bs-apple-search:focus-within{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.bs-apple-list{flex:1;min-height:0;overflow:auto;padding:2px 10px 8px;overscroll-behavior:contain}
.bs-apple-row{display:flex;align-items:center;gap:12px;padding:10px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bs-apple-row:last-child{border-bottom:0}
.bs-apple-format{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:56px;border-radius:6px;background:linear-gradient(150deg,#4c5b72,#222a36);color:#f6f1e7;font-size:8.5px;font-weight:700;letter-spacing:.08em;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.bs-apple-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.bs-apple-book-title{font-size:13px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-apple-meta{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-apple-import{flex:none;min-width:62px;justify-content:center}
.bs-apple-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:220px;padding:28px;text-align:center;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.bs-apple-state strong{font-size:13px;color:var(--dsw-alias-label-primary)}
.bs-apple-error{color:var(--dsw-alias-state-error-primary)}
.bs-apple-permission{max-width:46em;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.bs-apple-notice{margin:0 18px 8px;padding:7px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);border-left:2px solid var(--dsw-alias-state-success-primary)}
.bs-apple-notice-error{border-left-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.bs-apple-foot{flex:none;display:flex;align-items:center;gap:8px;padding:10px 18px;border-top:1px solid var(--dsw-alias-border-l1)}
.bs-apple-count{flex:1;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.bs-link-choose{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;min-height:300px;padding:28px 26px;text-align:center}
.bs-link-choose-icon{display:flex;align-items:center;justify-content:center;width:54px;height:54px;border-radius:15px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.bs-link-choose strong{font-size:14px;color:var(--dsw-alias-label-primary)}
.bs-link-choose span{max-width:40em;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.bs-link-choose .bs-button{margin-top:6px}
.bs-link-error{margin:0;max-width:44em;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.bs-link-note{margin:0;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.bs-link-folderbar{flex:none;display:flex;align-items:center;gap:10px;padding:0 18px 8px}
.bs-link-folder{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bs-link-folder strong{font-size:12.5px;line-height:1.4;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-link-folder span{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.bs-sort-select{font:inherit;font-size:11.5px;line-height:1.4;padding:5px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer}
.bs-sort-select:hover{background:var(--dsw-alias-bg-layer-2)}
.bs-sort-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-tabs{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:0 24px 8px}
.bs-tab{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:1.4;cursor:pointer;white-space:nowrap}
.bs-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-tab[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.bs-tab-count{font-variant-numeric:tabular-nums;opacity:.75}
.bs-tag-dialog{width:min(460px,calc(100vw - 28px));max-height:calc(100vh - 40px)}
.bs-tag-section{display:flex;flex-direction:column;gap:8px;padding:0 18px 12px}
.bs-tag-section-title{margin:0;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.bs-tag-choices{display:flex;flex-wrap:wrap;gap:6px}
.bs-tag-choice{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.4;cursor:pointer}
.bs-tag-choice:hover{background:var(--dsw-alias-bg-layer-2)}
.bs-tag-choice:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-tag-choice[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary)}
.bs-tag-empty{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.bs-tag-new{display:flex;gap:6px}
.bs-tag-new .bs-rename-input{flex:1;min-width:0}
.bs-tag-manage-list{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto;padding:0 18px 12px}
.bs-tag-manage-row{display:flex;align-items:center;gap:6px}
.bs-tag-manage-row .bs-rename-input{flex:1;min-width:0}
.bs-tag-manage-count{flex:none;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.bs-tag-danger{color:var(--dsw-alias-state-error-primary)}
.bs-tag-body{flex:1;min-height:0;overflow:auto}
.bs-tag-foot{justify-content:flex-end}
.bs-settings-dialog{width:min(720px,calc(100vw - 32px));max-height:min(86vh,760px)}
.bs-settings-tabs{flex:none;display:flex;gap:6px;padding:0 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bs-settings-tab{font:inherit;font-size:12.5px;line-height:1.4;padding:6px 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.bs-settings-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-settings-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-settings-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.bs-settings-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:12px 18px}
.bs-settings-cache{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.bs-settings-notice{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-success-primary)}
.bs-settings-foot{justify-content:flex-end}
.bs-settings-actions{display:flex;gap:8px}
.bs-tts-overlay{position:absolute;left:0;right:0;bottom:14px;z-index:9;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 12px;pointer-events:none}
.bs-tts-dock{display:flex;align-items:center;gap:4px;max-width:min(780px,100%);min-width:0;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 70%,transparent);-webkit-backdrop-filter:blur(18px) saturate(165%);backdrop-filter:blur(18px) saturate(165%);box-shadow:0 20px 44px -24px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.16);pointer-events:auto}
.bs-tts-status{flex:1;min-width:0;max-width:240px;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-tts-panels{display:flex;flex-direction:column;gap:8px;width:min(420px,100%);pointer-events:auto}
.bs-tts-controls{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.bs-tts-voice-readout{flex:0 1 auto;min-width:0;max-width:100%;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-tts-caption{display:flex;flex-direction:column;gap:4px;max-width:min(680px,100%);padding:8px 10px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 88%,transparent);backdrop-filter:blur(12px) saturate(140%);box-shadow:0 16px 36px -24px rgba(0,0,0,.6);pointer-events:auto}
.bs-tts-caption-head{display:flex;align-items:center;gap:6px}
.bs-tts-caption-label{flex:1;min-width:0;font-size:10.5px;line-height:1.4;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-tts-caption-close{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.bs-tts-caption-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-tts-caption-text{max-height:5.4em;overflow:hidden;font-size:13.5px;line-height:1.6;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.bs-selection-menu{position:absolute;z-index:12;display:flex;flex-direction:column;min-width:178px;max-width:min(260px,calc(100% - 16px));padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 42px -22px rgba(0,0,0,.55)}
.bs-selection-preview{padding:3px 9px 5px;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-selection-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.4;text-align:left;cursor:pointer;white-space:nowrap}
.bs-selection-item:hover{background:var(--dsw-alias-bg-layer-2)}
.bs-selection-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-selection-item:disabled{opacity:.45;cursor:default;background:transparent}
.bs-selection-divider{height:1px;margin:3px 6px;background:var(--dsw-alias-border-l1)}
.bs-tts-file{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 88%,transparent);backdrop-filter:blur(12px)}
.bs-tts-file-open{justify-content:flex-start}
.bs-tts-file-time{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.bs-tts-file-hint{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.bs-tts-error{color:var(--dsw-alias-state-error-primary)}
.bs-tts-speed{display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary);flex:none}
.bs-tts-select{font:inherit;font-size:11.5px;line-height:1.4;padding:3px 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.bs-tts-voice{font-size:11.5px;padding:4px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}
.bs-tts-settings{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.bs-tts-field{display:flex;flex-direction:column;gap:3px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.bs-tts-input{font:inherit;font-size:12px;line-height:1.4;padding:4px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);min-width:180px}
.bs-tts-actions{display:flex;gap:6px;margin-left:auto}
.bs-finish-body{margin:0;padding:0 18px 12px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-primary)}
.bs-meta{display:flex;flex-direction:column;gap:2px;min-width:0;padding:0 2px}
.bs-book-title{font-size:13px;line-height:1.4;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-book-sub{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-card-progress{height:2px;margin-top:2px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.bs-card-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .2s ease}
.bs-card-progress[data-finished="true"] .bs-card-progress-fill{background:var(--dsw-alias-state-success-primary)}
.bs-delete{position:absolute;top:8px;right:8px;z-index:2;display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:rgba(12,12,14,.55);color:#f4f1ea;opacity:0;cursor:pointer;transition:opacity .14s ease,background .14s ease;backdrop-filter:blur(4px)}
.bs-card:hover .bs-delete,.bs-delete:focus-visible{opacity:1}
.bs-delete:hover{background:rgba(185,58,58,.9)}
.bs-confirm{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:14px 12px;background:linear-gradient(to top,rgba(10,10,12,.94),rgba(10,10,12,.66))}
.bs-confirm-title{margin:0;font-size:12px;line-height:1.45;font-weight:600;color:#fff;overflow-wrap:anywhere}
.bs-confirm-actions{display:flex;gap:6px}
.bs-confirm-button{flex:1;font:inherit;font-size:11.5px;line-height:1.4;padding:6px 4px;border-radius:6px;border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.08);color:#fff;cursor:pointer}
.bs-confirm-button:hover:not(:disabled){background:rgba(255,255,255,.18)}
.bs-confirm-button.danger{background:#b93a3a;border-color:transparent}
.bs-confirm-button:disabled{opacity:.6;cursor:default}
.bs-confirm-button:focus-visible{outline:2px solid #fff;outline-offset:1px}
.bs-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:46vh;padding:32px 24px;text-align:center}
.bs-empty-icon{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:18px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.bs-empty-title{margin:0;font-size:16px;line-height:1.4;font-weight:600}
.bs-empty-text{margin:0;max-width:34em;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.bs-empty-actions{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
.bs-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 24px 10px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.5;overflow-wrap:anywhere}
.bs-banner-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.bs-banner-ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.bs-banner-close{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;flex:none;opacity:.75}
.bs-banner-close:hover{background:var(--dsw-alias-bg-layer-2);opacity:1}
.bs-drop{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;margin:10px;border:2px dashed var(--dsw-alias-brand-primary);border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:13px;pointer-events:none}
.bs-spinner{display:inline-block;width:18px;height:18px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);animation:bs-spin .7s linear infinite;flex:none}
.bs-spinner-small{width:14px;height:14px;border-width:2px}
@keyframes bs-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.bs-spinner{animation-duration:2.4s}button.bs-cover{transition:none}}
.bs-reader{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base)}
.bs-reader-bar{flex:none;display:flex;align-items:center;gap:8px;min-height:48px;padding:calc(var(--bs-top-clearance,0px) + 6px) 18px 6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bs-reader-title-wrap{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;padding:0 4px}
.bs-reader-title{font-size:14px;line-height:1.35;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-reader-sub{font-size:11.5px;line-height:1.35;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-reader-controls{display:flex;align-items:center;justify-content:flex-end;gap:4px;flex:none;flex-wrap:wrap;row-gap:3px}
.bs-control-label{font-size:11.5px;line-height:1;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;padding:0 5px;white-space:nowrap}
.bs-percent{min-width:34px;text-align:right}
/* Reserve a fixed footer: hover/focus must never resize the EPUB viewport. */
.bs-progress{position:relative;flex:0 0 14px;height:14px;background:var(--dsw-alias-bg-base);cursor:pointer;touch-action:none;outline:none}
.bs-progress::before{content:"";position:absolute;top:5px;left:0;right:0;height:4px;background:var(--dsw-alias-border-l1);pointer-events:none}
.bs-progress:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-progress-fill{position:absolute;top:5px;height:4px;background:var(--dsw-alias-brand-primary);border-radius:0 999px 999px 0;pointer-events:none}
.bs-progress-thumb{position:absolute;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base);pointer-events:none}
.bs-aside-tabs{display:flex;gap:4px;padding:0 6px 8px 0;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:8px}
.bs-aside-tab{flex:1;min-width:0;font:inherit;font-size:12px;line-height:1.4;padding:5px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bs-aside-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-aside-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.bs-aside-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-bookmark-row{display:flex;align-items:center;gap:2px;margin:0 0 2px}
.bs-bookmark-main{flex:1;min-width:0;font:inherit;font-size:12px;line-height:1.5;text-align:left;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-bookmark-main:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-bookmark-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-bookmark-delete{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0}
.bs-bookmark-row:hover .bs-bookmark-delete,.bs-bookmark-delete:focus-visible{opacity:1}
.bs-bookmark-delete:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)}
.bs-bookmark-delete:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-bookmark-empty{padding:12px 8px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.bs-bookmarks-panel{position:absolute;top:var(--bs-popover-top);right:16px;z-index:6;width:min(300px,calc(100vw - 40px));max-height:min(60vh,420px);overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 48px -20px rgba(0,0,0,.55)}
.bs-bookmarks-panel-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.bs-popover-backdrop{position:absolute;inset:0;z-index:8;background:transparent}
.bs-reader-settings{position:absolute;top:var(--bs-popover-top);right:14px;z-index:9;width:min(332px,calc(100vw - 28px));max-height:calc(100% - var(--bs-popover-top) - 12px);overflow:auto;padding:10px 13px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 22px 60px -24px rgba(0,0,0,.6)}
.bs-settings-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 4px;padding:0 0 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bs-settings-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.bs-setting-row{display:flex;flex-direction:column;gap:5px;padding:7px 0}
.bs-setting-label{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.bs-setting-toggle{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer}
.bs-setting-toggle input{width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.bs-setting-select{box-sizing:border-box;width:100%;min-width:0;font:inherit;font-size:12px;line-height:1.4;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none}
.bs-setting-select:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.bs-settings-divider{height:1px;margin:8px 0 2px;background:var(--dsw-alias-border-l1)}
.bs-settings-hint{margin:0 0 2px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.bs-segmented{display:flex;flex-wrap:wrap;gap:4px}
.bs-segment{font:inherit;font-size:11.5px;line-height:1.4;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.bs-segment:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-segment[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.bs-segment:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-stepper{display:flex;align-items:center;gap:8px}
.bs-stepper-button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:1;cursor:pointer}
.bs-stepper-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.bs-stepper-button:disabled{opacity:.4;cursor:default}
.bs-stepper-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-stepper-value{min-width:26px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.bs-focus-controls{position:absolute;top:calc(var(--bs-top-clearance,0px) + 10px);right:14px;z-index:7;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 30px -16px rgba(0,0,0,.55);opacity:.5;transition:opacity .15s ease}
.bs-focus-controls:hover,.bs-focus-controls:focus-within{opacity:1}
.bs-reader:fullscreen{width:100vw;height:100vh;border-radius:0;background:var(--dsw-alias-bg-base)}
.bs-reader:fullscreen .bs-reader-bar{padding-top:6px}
.bs-reader:fullscreen .bs-focus-controls{top:10px}
.bs-settings-section{margin:12px 0 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.bs-font-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bs-font-status{margin:4px 0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.bs-divider{width:1px;height:16px;margin:0 5px;background:var(--dsw-alias-border-l1)}
.bs-text-button{font:inherit;font-size:11.5px;line-height:1.4;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.bs-text-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-text-button:disabled{opacity:.45;cursor:default}
.bs-text-button[aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary)}
.bs-text-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* ----- [styles:annotations] ----- */
.bs-annotation-menu{position:absolute;top:var(--bs-popover-top);right:14px;z-index:9;width:min(304px,calc(100vw - 28px));max-height:calc(100% - var(--bs-popover-top) - 12px);overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px 13px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 22px 60px -24px rgba(0,0,0,.6)}
.bs-annotation-tabs{display:flex;gap:4px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bs-annotation-tab{flex:1;min-width:0;font:inherit;font-size:12px;line-height:1.4;padding:5px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.bs-annotation-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-annotation-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.bs-annotation-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-annotation-preview{display:flex;align-items:center;justify-content:center;min-height:46px;margin:2px 0 2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.6;text-align:center;overflow-wrap:anywhere}
.bs-annotation-color-row{display:flex;align-items:center;gap:8px}
.bs-annotation-hue{flex:1;min-width:0;height:16px;margin:0;padding:0;appearance:none;-webkit-appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:linear-gradient(90deg,#ff2d2d,#ffd23f,#54d34f,#3fc8d6,#3f6cd8,#b84fd8,#ff2d2d);cursor:pointer}
.bs-annotation-hue::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:14px;height:14px;border-radius:50%;border:2px solid #fff;background:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.45)}
.bs-annotation-hue::-moz-range-thumb{width:12px;height:12px;border-radius:50%;border:2px solid #fff;background:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.45)}
.bs-annotation-color-input{flex:none;width:36px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;cursor:pointer}
.bs-annotation-range{width:100%;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.bs-annotation-value{float:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
/* ----- [styles:reading-list] ----- */
.bs-reading-tools{display:flex;align-items:center;gap:6px;margin:0 0 8px}
.bs-reading-sort{flex:none;max-width:112px;font:inherit;font-size:11.5px;line-height:1.4;padding:4px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer}
.bs-reading-sort:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-reading-search{flex:1;min-width:0;font:inherit;font-size:11.5px;line-height:1.4;padding:4px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none}
.bs-reading-search:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.bs-reading-list{display:flex;flex-direction:column;gap:1px}
.bs-reading-row{display:flex;align-items:flex-start;gap:2px}
.bs-reading-main{flex:1;min-width:0;display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}
.bs-reading-main:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-reading-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-reading-icon{flex:none;display:inline-flex;margin-top:2px}
.bs-reading-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.bs-reading-label{font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-reading-detail{font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-reading-delete{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-top:3px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0}
.bs-reading-row:hover .bs-reading-delete,.bs-reading-delete:focus-visible{opacity:1}
.bs-reading-delete:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)}
.bs-reading-delete:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-reading-empty{padding:12px 8px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.bs-discussion-backdrop{position:absolute;inset:0;z-index:30;background:color-mix(in srgb,var(--dsw-alias-bg-base) 72%,transparent);display:flex;align-items:center;justify-content:center;padding:20px}
.bs-discussion-dialog{display:flex;flex-direction:column;gap:14px;width:min(560px,100%);max-height:100%;overflow:auto;padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 20px 60px -25px var(--dsw-alias-label-secondary);outline:none}
.bs-discussion-dialog h2{margin:0;font-size:16px;line-height:1.4}
.bs-discussion-dialog p{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.bs-discussion-summary{font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.bs-discussion-preview{margin:0;max-height:150px;overflow:auto;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font:inherit;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.bs-discussion-workspace{display:flex;flex-direction:column;gap:6px;font-size:12px}
.bs-discussion-workspace select{width:100%;min-width:0;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.bs-discussion-workspace select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-discussion-dialog .bs-discussion-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.bs-discussion-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}
.bs-reader-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px;text-align:center;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.bs-reader-state-error{color:var(--dsw-alias-state-error-primary)}
.bs-pdf-scroll{flex:1;min-height:0;overflow:auto;padding:24px 24px 64px;background:var(--dsw-alias-bg-layer-2);overscroll-behavior:contain}
.bs-pdf-pages{display:flex;flex-direction:column;align-items:center;gap:14px;min-width:min-content}
.bs-pdf-page{position:relative;background:#fff;border-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,.18),0 14px 32px -20px rgba(0,0,0,.6);overflow:hidden}
.bs-pdf-canvas{display:block;max-width:100%;height:auto;transition:opacity .18s ease}
.bs-pdf-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#fff;color:#8a8f98}
.bs-epub-body{position:relative;flex:1;min-height:0;display:flex;background:var(--dsw-alias-bg-base)}
.bs-epub-toc{flex:none;width:264px;min-width:0;overflow:auto;padding:14px 10px 40px 14px;border-right:1px solid var(--dsw-alias-border-l1);overscroll-behavior:contain}
.bs-toc-label{display:block;width:100%;margin:0 0 1px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.5;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-toc-label:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-toc-label[aria-current="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.bs-toc-label:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-epub-frame-wrap{display:flex;flex:1;min-width:0;min-height:0;justify-content:center;overflow:hidden}
.bs-epub-frame{display:block;width:100%;height:100%;border:0;background:transparent}
.bs-epub-probe{position:fixed;left:-100000px;top:0;width:1px;height:1px;border:0;visibility:hidden;pointer-events:none}
@container bookshelf (max-width:720px){
  .bs-header{padding-left:20px;padding-right:20px;flex-wrap:wrap;align-items:center}
  .bs-scroll{padding-left:20px;padding-right:20px}
  .bs-banner{margin-left:20px;margin-right:20px}
  .bs-epub-toc{position:absolute;left:0;top:0;bottom:0;z-index:4;width:min(82vw,290px);background:var(--dsw-alias-bg-overlay);box-shadow:18px 0 40px -28px rgba(0,0,0,.8)}
  .bs-reader-bar{padding-left:8px;padding-right:10px;gap:5px;flex-wrap:wrap}
  .bs-reader-title-wrap{padding:0 2px;min-width:120px}
  .bs-reader-controls{gap:2px;flex-wrap:wrap;justify-content:flex-end;row-gap:3px;width:100%}
  .bs-reader-controls .bs-divider{margin:0 2px}
  .bs-reader-settings{right:8px;left:8px;width:auto}
  .bs-annotation-menu{right:8px;left:8px;width:auto}
  .bs-focus-controls{right:8px}
  .bs-shelf-tools{padding:8px 12px;gap:6px}
  .bs-tts-overlay{padding:0 8px;bottom:10px}
  .bs-tts-dock{max-width:100%;padding:5px 6px}
  .bs-tts-status{max-width:none}
  .bs-tts-panels{width:100%}
  .bs-settings-dialog{width:calc(100vw - 16px);max-height:88vh}
  .bs-settings-tabs{padding:0 12px 8px}
  .bs-settings-body{padding:10px 12px}
  .bs-tts-speed span{display:none}
  .bs-tts-voice{max-width:96px}
  .bs-row-open{padding:8px 40px 8px 8px;gap:10px}
  .bs-row-thumb{width:40px;height:52px}
  .bs-row-confirming{padding:8px;gap:8px}
  .bs-tabs{padding:0 12px 6px;gap:5px}
  .bs-sort-label{display:none}
  .bs-apple-button-label{display:none}
  .bs-apple-dialog{width:calc(100vw - 20px);max-height:88vh}
  .bs-apple-head{padding:12px 12px 6px}
  .bs-apple-search{margin:0 12px 6px}
  .bs-apple-list{padding:2px 6px 6px}
  .bs-apple-row{gap:8px;padding:9px 6px}
  .bs-apple-format{width:36px;height:48px;font-size:8px}
  .bs-apple-foot{padding:8px 12px}
  .bs-link-folderbar{padding:0 12px 6px}
  .bs-link-choose{padding:20px 16px}
}
@media (hover:none){.bs-delete{opacity:1}}
.bs-more{position:absolute;right:8px;bottom:8px;z-index:3;display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:rgba(12,12,14,.55);color:#f4f1ea;opacity:0;cursor:pointer;transition:opacity .14s ease,background .14s ease;backdrop-filter:blur(4px)}
.bs-card:hover .bs-more,.bs-more:focus-visible{opacity:1}
.bs-more:hover{background:rgba(34,38,46,.88)}
.bs-more:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-cover-menu{position:absolute;left:8px;right:8px;bottom:42px;z-index:8;min-width:0;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-overlay);box-shadow:0 16px 40px -18px rgba(0,0,0,.55)}
.bs-cover-menu button{display:block;width:100%;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.4;text-align:left;cursor:pointer;white-space:nowrap}
.bs-cover-menu button:hover{background:var(--dsw-alias-bg-layer-2)}
.bs-cover-menu button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-list{display:flex;flex-direction:column;gap:4px;width:100%;min-width:0;margin:0}
.bs-row{position:relative;display:flex;align-items:center;gap:0;min-width:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.bs-row:hover{background:var(--dsw-alias-bg-layer-1)}
.bs-row-open{flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:10px 44px 10px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bs-row-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-row-thumb{position:relative;flex:none;width:44px;height:58px;border-radius:6px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);color:#f6f1e7;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.bs-row-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bs-row-format{position:absolute;left:4px;bottom:4px;font-size:7.5px;font-weight:700;letter-spacing:.06em;opacity:.9;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.bs-row-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.bs-row-title{font-size:13.5px;line-height:1.4;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-row-sub{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-row-progress{height:2px;margin-top:2px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.bs-row-progress-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .2s ease}
.bs-row-actions{position:absolute;top:50%;right:6px;z-index:5;display:flex;align-items:center;transform:translateY(-50%)}
.bs-row-more{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);opacity:0;cursor:pointer;transition:opacity .14s ease,background .14s ease}
.bs-row:hover .bs-row-more,.bs-row-more:focus-visible{opacity:1}
.bs-row-more:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-row-more:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-row-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:9;display:flex;flex-direction:column;min-width:132px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-overlay);box-shadow:0 16px 40px -18px rgba(0,0,0,.55)}
.bs-row-menu-up{top:auto;bottom:calc(100% + 4px)}
.bs-row-menu button{display:block;width:100%;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.4;text-align:left;cursor:pointer;white-space:nowrap}
.bs-row-menu button:hover{background:var(--dsw-alias-bg-layer-2)}
.bs-row-menu button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.bs-row-menu .bs-row-menu-danger{color:var(--dsw-alias-state-error-primary)}
.bs-row-confirming{flex-wrap:wrap;padding:10px;gap:12px;background:var(--dsw-alias-bg-layer-1);border-bottom-color:transparent}
.bs-row-confirming .bs-row-sub{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.bs-row-confirm-actions{display:flex;align-items:center;gap:6px;flex:none}
.bs-row-confirm-button{font:inherit;font-size:12px;line-height:1.4;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.bs-row-confirm-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.bs-row-confirm-button.danger{background:#b93a3a;border-color:transparent;color:#fff}
.bs-row-confirm-button:disabled{opacity:.6;cursor:default}
.bs-row-confirm-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-layout-toggle{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);flex:none}
.bs-layout-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.bs-layout-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-layout-button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-layout-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bs-rename-dialog{width:min(430px,calc(100vw - 28px));max-height:calc(100vh - 40px)}
.bs-rename-form{display:flex;flex-direction:column;min-height:0}
.bs-rename-body{display:flex;flex-direction:column;gap:12px;padding:10px 18px 14px}
.bs-rename-field{display:flex;flex-direction:column;gap:5px}
.bs-rename-label{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.bs-rename-input{font:inherit;font-size:13px;line-height:1.4;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none}
.bs-rename-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.bs-rename-error{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.bs-rename-foot{justify-content:flex-end}
.bs-apple-sub{margin:2px 0 0;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-audiobook-dialog{width:min(540px,calc(100vw - 28px));max-height:calc(100vh - 40px)}
.bs-audiobook-body{display:flex;flex-direction:column;gap:12px;padding:10px 18px 14px;min-height:0;overflow:auto}
.bs-audiobook-fields{display:flex;flex-wrap:wrap;gap:10px}
.bs-audiobook-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px}
.bs-audiobook-item{display:flex;flex-direction:column;gap:2px;min-width:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.bs-audiobook-label{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.bs-audiobook-value{font-size:13px;line-height:1.4;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-audiobook-hint{display:flex;align-items:center;gap:6px;margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.bs-audiobook-link{padding:0;border:0;background:none;font:inherit;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-brand-primary);text-decoration:underline;cursor:pointer}
.bs-audiobook-progress{height:6px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.bs-audiobook-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .2s ease}
.bs-audiobook-done{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.bs-audiobook-done .bs-button{text-decoration:none}
@media (hover:none){.bs-more{opacity:1}}
@media (hover:none){.bs-row-more{opacity:1}}
`

    const READING_CSS = `
:root{color-scheme:var(--bb-scheme,light)}
html,body{margin:0;padding:0;background:var(--bb-bg,transparent)}
body{max-width:var(--bb-max-width,46rem);margin:0 auto;padding:var(--bb-padding-y,44px) var(--bb-padding-x,34px) 120px;color:var(--bb-fg,#1f2328);font-family:var(--bb-font-family,'Iowan Old Style','Palatino Linotype','Songti SC','STSong','Noto Serif SC','Noto Serif CJK SC',serif);font-size:var(--bb-font-size,19px);font-weight:var(--bb-font-weight,normal);font-style:var(--bb-font-style,normal);line-height:var(--bb-line-height,1.85);text-align:justify;overflow-wrap:break-word;hyphens:auto}
body > :first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{margin:1.55em 0 .65em;font-weight:600;line-height:1.35;text-align:left;text-wrap:balance}
h1{font-size:1.6em}h2{font-size:1.34em}h3{font-size:1.16em}
p{margin:0 0 .95em}
a{color:var(--bb-accent,#3155d8);text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:.06em}
img{display:block;max-width:100%;height:auto;margin:1.1em auto}
.bb-cover{display:flex;flex-direction:column;align-items:center;gap:1em;margin:0}
.bb-cover img{max-width:100%;max-height:calc(100vh - 90px);width:auto;height:auto;margin:0 auto}
figure{margin:1.2em 0}
figcaption{font-size:.85em;line-height:1.5;text-align:center;color:var(--bb-muted)}
blockquote{margin:1.1em 0;padding:.15em 0 .15em 1.05em;border-left:3px solid var(--bb-border);color:var(--bb-muted)}
blockquote p{margin-bottom:.5em}
pre,code,kbd,samp{font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;font-size:.86em}
pre{margin:1em 0;padding:.85em 1em;border:1px solid var(--bb-border);border-radius:8px;background:var(--bb-code-bg);white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}
code{padding:.1em .3em;border-radius:4px;background:var(--bb-code-bg)}
pre code{padding:0;background:transparent}
hr{margin:2em 0;border:0;border-top:1px solid var(--bb-border)}
.bb-table-wrap{max-width:100%;overflow-x:auto;scrollbar-width:thin}
.bb-table-wrap table{margin:.4em 0}
table{margin:1em 0;border-collapse:collapse;max-width:100%;font-size:.92em}
th,td{padding:5px 9px;border:1px solid var(--bb-border);text-align:left;vertical-align:top}
th{background:var(--bb-code-bg);font-weight:600}
ul,ol{margin:.4em 0 1em;padding-left:1.5em}
li{margin:.18em 0}
dt{font-weight:600}dd{margin:0 0 .6em 1.4em}
sup,sub{line-height:0}
::selection{background:rgba(80,130,240,.26)}
`

    const PAGED_CSS = `
html.bb-paged{height:100%;overflow:hidden}
/* Each spread advances by one actual iframe viewport. The gap contains the
   right margin of this page plus the left margin of the next page. Hidden
   overflow still permits explicit page navigation, but prevents a trackpad
   from leaving the book between columns while its page counter stays put. */
html.bb-paged body{box-sizing:border-box;width:100%!important;max-width:none!important;height:100%!important;margin:0!important;padding:var(--bb-page-pad-y,36px) var(--bb-page-pad-x,28px)!important;column-width:auto;column-count:var(--bb-page-columns,1);column-gap:calc(var(--bb-page-pad-x,28px) + var(--bb-page-pad-x,28px));column-fill:auto;overflow:hidden;scrollbar-width:none;overflow-anchor:none;scroll-behavior:auto}
/* An odd final column needs a blank partner so scrollLeft can reach a full
   spread boundary. This generated box is never counted as publication content. */
html.bb-paged body[data-bb-pad-spread]::after{content:'';display:block;break-before:column;width:1px;height:1px}
html.bb-paged body::-webkit-scrollbar{display:none}
html.bb-paged body p{orphans:2;widows:2}
html.bb-paged body h1,html.bb-paged body h2,html.bb-paged body h3,html.bb-paged body h4,html.bb-paged body h5{break-after:avoid}
html.bb-paged body img,html.bb-paged body figure{break-inside:avoid}
html.bb-paged body img{max-height:calc(100vh - var(--bb-page-pad-y,36px) - var(--bb-page-pad-y,36px) - 4em);width:auto;max-width:100%;object-fit:contain}
html.bb-paged body pre,html.bb-paged body blockquote{break-inside:auto;max-width:100%}
html.bb-paged body .bb-table-wrap{max-width:100%;overflow-x:auto;break-inside:auto}
html.bb-paged body .bb-table-wrap table{break-inside:auto;font-size:.86em}
html.bb-paged body table tr{break-inside:avoid}
`

    const READER_FONTS = {
      serif: "'Iowan Old Style','Palatino Linotype','Songti SC','STSong','Noto Serif SC','Noto Serif CJK SC',serif",
      sans: "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
      mono: "ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace",
    }

    const PAGE_MARGINS = {
      standard: { pageX: '40px', pageY: '40px', scrollX: '40px', scrollY: '44px', maxWidth: '46rem' },
      compact: { pageX: '32px', pageY: '36px', scrollX: '32px', scrollY: '42px', maxWidth: '50rem' },
      fill: { pageX: '8px', pageY: '28px', scrollX: '8px', scrollY: '36px', maxWidth: 'none' },
    }

    const READER_LINE_HEIGHTS = { compact: 1.65, normal: 1.85, loose: 2.05 }

    const DEFAULT_READING_SETTINGS = {
      fontFamily: 'serif',
      fontName: '',
      fontWeight: 0,
      fontStyle: 'normal',
      fontSize: 19,
      lineHeight: 1.85,
      pageMargin: 'standard',
      theme: 'auto',
      pageMode: 'scroll',
      pageSpread: 'auto',
    }

    // Fallbacks match the DSH desktop palettes so a build without the token
    // stylesheet still looks native instead of inventing warm paper tones.
    const READING_THEMES = {
      light: {
        fg: '#0f1115',
        bg: '#ffffff',
        muted: '#61666b',
        border: 'rgba(0,0,0,.10)',
        accent: '#0f1115',
        codeBg: '#f1f3f5',
        scheme: 'light',
      },
      dark: {
        fg: '#f9fafb',
        bg: '#151517',
        muted: '#cfd3d6',
        border: 'rgba(255,255,255,.12)',
        accent: '#f9fafb',
        codeBg: '#232324',
        scheme: 'dark',
      },
    }

    const DSH_ALIAS_PROBES = {
      bg: '--dsw-alias-bg-base',
      fg: '--dsw-alias-label-primary',
      muted: '--dsw-alias-label-secondary',
      border: '--dsw-alias-border-l1',
      accent: '--dsw-alias-brand-primary',
      codeBg: '--dsw-alias-bg-layer-2',
    }

    function dshPrefersDark() {
      if (typeof document === 'undefined') return false
      if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return true
      const root = document.documentElement
      if (root && root.style && root.style.colorScheme === 'dark') return true
      if (typeof matchMedia === 'function') {
        const media = matchMedia('(prefers-color-scheme: dark)')
        if (media && media.matches === true) return true
      }
      return false
    }

    // DSH ships both base palettes in one stylesheet: `body{}` carries the light
    // values and `body[data-ds-dark-theme]{}` the dark ones, with alias tokens
    // pointing at the static palette through var(). Reading those rules lets a
    // pinned page theme use the other scheme's exact DSH colors.
    function dshSheetPalettes() {
      const result = { light: new Map(), dark: new Map() }
      if (typeof document === 'undefined' || !document.styleSheets) return result
      const visit = (rules) => {
        for (const rule of Array.from(rules || [])) {
          if (rule.cssRules && rule.cssRules.length > 0) visit(rule.cssRules)
          const selector = typeof rule.selectorText === 'string' ? rule.selectorText.trim() : ''
          if (!/^(?:html)?body(?:\[[^\]]*\])?$/i.test(selector)) continue
          const target = selector.includes('data-ds-dark-theme') ? result.dark : result.light
          const style = rule.style
          if (!style) continue
          for (let index = 0; index < style.length; index += 1) {
            const name = style.item(index)
            if (!name.startsWith('--')) continue
            const value = (style.getPropertyValue(name) || '').trim()
            if (value !== '') target.set(name, value)
          }
        }
      }
      const sheets = []
      for (const sheet of Array.from(document.styleSheets || [])) sheets.push(sheet)
      for (const sheet of Array.from(document.adoptedStyleSheets || [])) sheets.push(sheet)
      for (const sheet of sheets) {
        let rules = null
        try {
          rules = sheet.cssRules
        } catch {
          rules = null
        }
        if (rules) visit(rules)
      }
      return result
    }

    function dshResolveToken(map, name, depth = 0) {
      if (depth > 8) return ''
      const raw = map.get(name)
      if (raw === undefined) return ''
      const single = /^var\(\s*(--[^,)\s]+)\s*(?:,\s*([^)]*))?\)$/.exec(raw)
      if (single) {
        const inner = dshResolveToken(map, single[1], depth + 1)
        if (inner !== '') return inner
        return single[2] === undefined ? '' : single[2].trim()
      }
      if (!raw.includes('var(')) return raw
      let failed = false
      const expanded = raw.replace(/var\(\s*(--[^,)\s]+)\s*(?:,\s*([^)]*))?\)/g, (whole, reference, fallback) => {
        const inner = dshResolveToken(map, reference, depth + 1)
        if (inner !== '') return inner
        if (fallback !== undefined) return fallback.trim()
        failed = true
        return ''
      })
      return failed ? '' : expanded
    }

    function dshSheetPalette(mode) {
      const palettes = dshSheetPalettes()
      const map = mode === 'dark' ? palettes.dark : palettes.light
      if (map.size === 0) return null
      const read = (name) => dshResolveToken(map, name)
      const fg = read(DSH_ALIAS_PROBES.fg)
      const bg = read(DSH_ALIAS_PROBES.bg)
      if (fg === '' || bg === '') return null
      const fallback = READING_THEMES[mode]
      return {
        mode,
        fg,
        bg,
        muted: read(DSH_ALIAS_PROBES.muted) || fallback.muted,
        border: read(DSH_ALIAS_PROBES.border) || fallback.border,
        accent: read(DSH_ALIAS_PROBES.accent) || fallback.accent,
        codeBg: read(DSH_ALIAS_PROBES.codeBg) || fallback.codeBg,
        scheme: mode,
      }
    }

    // Live tokens cover the active scheme exactly, including user theme
    // overrides and custom registered themes.
    function dshLivePalette() {
      if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null
      const body = document.body
      if (!body) return null
      const styles = getComputedStyle(body)
      const read = (name) => (styles.getPropertyValue(name) || '').trim()
      const fg = read(DSH_ALIAS_PROBES.fg)
      const bg = read(DSH_ALIAS_PROBES.bg)
      if (fg === '' || bg === '') return null
      const dark = dshPrefersDark()
      return {
        mode: 'auto',
        fg,
        bg,
        muted: read(DSH_ALIAS_PROBES.muted) || READING_THEMES[dark ? 'dark' : 'light'].muted,
        border: read(DSH_ALIAS_PROBES.border) || READING_THEMES[dark ? 'dark' : 'light'].border,
        accent: read(DSH_ALIAS_PROBES.accent) || fg,
        codeBg: read(DSH_ALIAS_PROBES.codeBg) || READING_THEMES[dark ? 'dark' : 'light'].codeBg,
        scheme: dark ? 'dark' : 'light',
      }
    }

    function readingPalette(settings) {
      const mode = settings && settings.theme
      if (mode === 'light' || mode === 'dark') {
        const exact = dshSheetPalette(mode)
        if (exact !== null) return exact
        return { ...READING_THEMES[mode], mode }
      }
      const live = dshLivePalette()
      if (live !== null) return live
      const dark = dshPrefersDark()
      return { ...READING_THEMES[dark ? 'dark' : 'light'], mode: 'auto' }
    }

    // ----- [prelude:helpers] -----
    // Transport/fetch wrappers, storage helpers and small formatting helpers
    // shared by the shelf and both readers.

    function transportBase() {
      // The Web page and the Desktop application both forward relative URLs:
      // the Web carrier serves them, and Desktop's `dsh-app://app` protocol
      // forwards unknown paths to its Host. Only a plain file document has no
      // forwarding surface, so it must reach the Host by its advertised origin.
      const protocol = typeof location === 'undefined' ? '' : location.protocol
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'dsh-app:') return ''
      const transport = globalThis.__DSH_TRANSPORT__
      const raw = transport && typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : ''
      return raw.replace(/\/+$/, '')
    }

    function resourceUrl(base, path) {
      return base === '' ? path : `${base}/${path.replace(/^\/+/, '')}`
    }

    function absoluteServiceUrl(base, path) {
      if (base !== '') return resourceUrl(base, path)
      const documentBase = typeof document !== 'undefined' && typeof document.baseURI === 'string' ? document.baseURI : location.href
      return new URL(path, documentBase).href
    }

    async function parseResponse(response) {
      let payload
      const text = await response.text()
      if (text !== '') {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = undefined
        }
      }
      if (!response.ok) {
        const message = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
        throw new Error(message)
      }
      return payload
    }

    async function requestJson(base, path, options) {
      const response = await fetch(resourceUrl(base, `${API_ROOT}${path}`), options)
      return parseResponse(response)
    }

    // Outlive reader unmounts: reopening must not race the previous save.
    const stateWrites = new Map()

    async function readBookState(base, id) {
      const url = resourceUrl(base, `${API_ROOT}/books/${id}/state`)
      await stateWrites.get(url)
      const response = await fetch(url, { cache: 'no-store' })
      const payload = await parseResponse(response)
      return payload && payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state) ? payload.state : {}
    }

    async function readDefaults(base) {
      const payload = await requestJson(base, '/settings')
      return payload && payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
        ? payload.settings
        : {}
    }

    async function writeDefaults(base, settings) {
      const response = await fetch(resourceUrl(base, `${API_ROOT}/settings`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      await parseResponse(response)
    }

    function writeBookState(base, id, patch, keepalive = false) {
      const url = resourceUrl(base, `${API_ROOT}/books/${id}/state`)
      const body = JSON.stringify(patch)
      const pending = (stateWrites.get(url) || Promise.resolve()).then(async () => {
        const response = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive,
        })
        await parseResponse(response)
      })
      // A failed request is reported by its caller, but must not block later saves.
      const settled = pending.catch(() => undefined)
      stateWrites.set(url, settled)
      settled.then(() => {
        if (stateWrites.get(url) === settled) stateWrites.delete(url)
      })
      return pending
    }

    async function putBookCover(base, id, cover) {
      if (!cover || typeof cover.type !== 'string' || !cover.data || cover.data.length === 0) return false
      const response = await fetch(resourceUrl(base, `${API_ROOT}/books/${id}/cover`), {
        method: 'PUT',
        headers: { 'content-type': cover.type },
        body: cover.data,
      })
      if (!response.ok) return false
      await parseResponse(response)
      return true
    }

    function newBookmarkId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
      return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
    }

    function formatDate(value) {
      if (!Number.isFinite(value)) return ''
      try {
        return new Date(value).toLocaleDateString()
      } catch {
        return ''
      }
    }

    function formatOf(file) {
      const name = String(file.name || '').toLowerCase()
      if (name.endsWith('.pdf')) return 'pdf'
      if (name.endsWith('.epub')) return 'epub'
      const type = String(file.type || '').toLowerCase()
      if (type === 'application/pdf') return 'pdf'
      if (type === 'application/epub+zip' || type === 'application/epub') return 'epub'
      return null
    }

    function hashCode(text) {
      let hash = 0
      const value = String(text)
      for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0
      return hash
    }

    function readStoredLayout() {
      try {
        const stored = localStorage.getItem(LAYOUT_STORAGE_KEY)
        return SHELF_LAYOUTS.includes(stored) ? stored : 'grid'
      } catch {
        return 'grid'
      }
    }

    function storeLayout(value) {
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, value)
      } catch {
        // Private browsing or a blocked storage area keeps the in-memory choice.
      }
    }

    // Shown on both the cover card and the list row so one status rule cannot
    // drift between the two arrangements.
    function bookPercent(book) {
      const progress = book.progress && typeof book.progress === 'object' ? book.progress : null
      return progress ? Math.min(1, Math.max(0, Number(progress.percent) || 0)) : 0
    }

    function bookStatus(book) {
      return STATUS_CATEGORIES.includes(book.status) ? book.status : 'reading'
    }

    function bookCoverUrl(book, base) {
      return book.cover && book.cover.updatedAt && book.id
        ? resourceUrl(base, `${API_ROOT}/books/${book.id}/cover?v=${book.cover.updatedAt}`)
        : ''
    }

    function bookSubParts(book, t) {
      const percent = bookPercent(book)
      const status = bookStatus(book)
      const author = book.author || t('unknownAuthor')
      if (status === 'finished') return [t('finishedPercent', { percent: 100 }), author]
      if (book.statusManual) return [t(STATUS_LABEL_KEYS[status]), author]
      if (percent > 0) return [`${t('continueReading')} ${Math.round(percent * 100)}%`, author]
      return [author, formatBytes(book.bytes), formatDate(book.addedAt)]
    }

    function coverStyle(book) {
      const hash = hashCode(`${book.title}|${book.author}`)
      const hue = hash % 360
      const second = (hue + 34) % 360
      return {
        backgroundImage: `linear-gradient(148deg, hsl(${hue} 40% 40%) 0%, hsl(${second} 44% 26%) 62%, hsl(${second} 40% 20%) 100%)`,
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
    }

    function decodeAnchor(value) {
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }

    function chapterLabel(t, index) {
      return t('chapterNumber', { number: index + 1 })
    }

    function chapterHasVisibleContent(html) {
      if (typeof html !== 'string' || html === '') return false
      const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      if (/<(img|image|svg|video|audio|canvas|object|embed)\b/i.test(cleaned)) return true
      const text = cleaned.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim()
      return text !== ''
    }

    function htmlTextLength(html) {
      if (typeof html !== 'string' || html === '') return 0
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim().length
    }

    function buildChapterMetrics(chapters) {
      const weights = (chapters || []).map((chapter) => Math.max(1, htmlTextLength(chapter.html)))
      const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
      const starts = []
      let running = 0
      for (const weight of weights) {
        starts.push(running)
        running += weight
      }
      return {
        total,
        percentFor(index, ratio) {
          if (weights.length === 0) return 0
          const safeIndex = Math.min(weights.length - 1, Math.max(0, index))
          const safeRatio = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
          return Math.min(1, Math.max(0, (starts[safeIndex] + weights[safeIndex] * safeRatio) / total))
        },
        chapterAt(value) {
          if (weights.length === 0) return { index: 0, ratio: 0 }
          const target = Math.min(1, Math.max(0, value)) * total
          for (let index = 0; index < weights.length; index += 1) {
            if (target <= starts[index] + weights[index]) {
              return { index, ratio: Math.min(1, Math.max(0, (target - starts[index]) / weights[index])) }
            }
          }
          return { index: weights.length - 1, ratio: 1 }
        },
      }
    }

    // ----- [prelude:module-loads] -----
    // Browser assets are imported on demand through the Host asset route.
    // Each loader caches one promise and retries after a failure.

    let pdfjsPromise = null
    let epubModulePromise = null
    let readingSnapshotPromise = null
    let readingFontsPromise = null
    let readingFonts = null

    function loadReadingFonts(base) {
      if (readingFontsPromise === null) {
        readingFontsPromise = import(absoluteServiceUrl(base, `${ASSET_ROOT}/reading-fonts.mjs?v=${ASSET_VERSION}`)).then(module => {
          readingFonts = module
          return module
        }).catch(error => {
          readingFontsPromise = null
          throw error
        })
      }
      return readingFontsPromise
    }

    let ttsSentencesPromise = null

    function loadTtsSentences(base) {
      if (ttsSentencesPromise === null) {
        ttsSentencesPromise = import(absoluteServiceUrl(base, `${ASSET_ROOT}/tts-sentences.mjs?v=${ASSET_VERSION}`)).catch((error) => {
          ttsSentencesPromise = null
          throw error
        })
      }
      return ttsSentencesPromise
    }

    function loadReadingSnapshot(base) {
      if (readingSnapshotPromise === null) {
        readingSnapshotPromise = import(absoluteServiceUrl(base, `${ASSET_ROOT}/reading-snapshot.mjs?v=${ASSET_VERSION}`)).catch((error) => {
          readingSnapshotPromise = null
          throw error
        })
      }
      return readingSnapshotPromise
    }

    function loadPdfjs(base) {
      if (pdfjsPromise === null) {
        pdfjsPromise = import(absoluteServiceUrl(base, `${ASSET_ROOT}/pdf.min.mjs`)).catch((error) => {
          pdfjsPromise = null
          throw error
        })
      }
      return pdfjsPromise
    }

    const pdfWorkerSources = new Map()

    /**
     * Supply PDF.js with a Blob module worker. A Blob worker works on the HTTP
     * page, Desktop's custom scheme, and a plain file document, where a direct
     * Worker URL may be refused. PDF.js terminates this worker when the loading
     * task is destroyed, so each open builds a fresh one. When even Blob
     * creation fails, fall back to PDF.js's own workerSrc/fake-worker path.
     */
    async function createPdfWorker(pdfjs, base) {
      const url = absoluteServiceUrl(base, `${ASSET_ROOT}/pdf.worker.min.mjs`)
      let source = pdfWorkerSources.get(url)
      if (source === undefined) {
        try {
          const response = await fetch(url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          source = await response.text()
          pdfWorkerSources.set(url, source)
        } catch (failure) {
          pdfjs.GlobalWorkerOptions.workerPort = null
          pdfjs.GlobalWorkerOptions.workerSrc = url
          console.error('bookshelf: PDF worker source failed', failure)
          return { worker: null, blobUrl: '' }
        }
      }
      let blobUrl = ''
      try {
        blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        const worker = new Worker(blobUrl, { type: 'module' })
        pdfjs.GlobalWorkerOptions.workerPort = worker
        return { worker, blobUrl }
      } catch (failure) {
        if (blobUrl !== '') URL.revokeObjectURL(blobUrl)
        pdfjs.GlobalWorkerOptions.workerPort = null
        pdfjs.GlobalWorkerOptions.workerSrc = url
        console.error('bookshelf: PDF worker bootstrap failed', failure)
        return { worker: null, blobUrl: '' }
      }
    }

    function loadEpubModule(base) {
      if (epubModulePromise === null) {
        epubModulePromise = import(absoluteServiceUrl(base, `${ASSET_ROOT}/epub.mjs?v=${ASSET_VERSION}`)).catch((error) => {
          epubModulePromise = null
          throw error
        })
      }
      return epubModulePromise
    }

    // Dynamic browser modules shared by the readers' asynchronous paths. A
    // record keeps the loaded module object so later call sites can read it
    // synchronously after the reader awaited the preload; the cached promise
    // deduplicates concurrent loads and is dropped on failure so a retry
    // fetches the module again.
    const CLIENT_LIB_NAMES = ['text-index', 'clipboard', 'annotations', 'reading-list', 'highlights', 'selection-speech']
    const clientLibs = new Map()

    function loadClientLib(base, name) {
      let record = clientLibs.get(name)
      if (record === undefined) {
        record = { module: null, promise: null }
        clientLibs.set(name, record)
      }
      if (record.module !== null) return Promise.resolve(record.module)
      if (record.promise === null) {
        record.promise = import(absoluteServiceUrl(base, `${ASSET_ROOT}/lib/${name}.mjs?v=${ASSET_VERSION}`)).then((module) => {
          record.module = module
          return module
        }).catch((error) => {
          record.promise = null
          throw error
        })
      }
      return record.promise
    }

    // Read a preloaded module object synchronously (render and event paths).
    function clientLib(name) {
      const record = clientLibs.get(name)
      return record === undefined ? null : record.module
    }

    // Warm browser modules the reader's async paths need. A failed import is
    // reported once and tolerated: the reader still opens, and a call site that
    // needs the module retries the load instead of failing the whole open.
    function preloadClientLibs(base, names = CLIENT_LIB_NAMES) {
      return Promise.all(names.map((name) => loadClientLib(base, name))).catch((failure) => {
        console.error('bookshelf: client library preload failed', failure)
        return []
      })
    }

    // ===== [ui] =====
    // Icons and the shared React widgets (reading controls, speech controls,
    // dialogs) that the readers and the shelf compose.

    const SIDEBAR_CSS = `
.bsb-reader{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;height:100%;color:var(--dsw-alias-label-primary);font:inherit}
.bsb-header{padding:16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bsb-title{margin:0;font-size:17px;line-height:1.45;font-weight:600;overflow-wrap:anywhere}
.bsb-meta{margin-top:5px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.bsb-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.bsb-button{font:inherit;font-size:12px;line-height:1.5;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.bsb-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.bsb-button:disabled{opacity:.5;cursor:default}
.bsb-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.bsb-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px clamp(18px,4vw,30px) 40px}
.bsb-segment{white-space:pre-wrap;overflow-wrap:break-word;font-family:'Iowan Old Style','Songti SC','STSong','Noto Serif SC','Noto Serif CJK SC',serif;font-size:17px;line-height:1.8;margin:0 auto;max-width:38em;user-select:text}
.bsb-message{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.bsb-picker{display:flex;flex-direction:column;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.bsb-picker-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.bsb-picker .bsb-button{text-align:left}
.bsb-footer{padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.bsb-footer[role=alert]{color:var(--dsw-alias-state-error-primary)}
.bsb-selection{margin-top:20px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.bsb-selection summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.bsb-selection p{white-space:pre-wrap;font-size:13px;line-height:1.7}
`

    function svgIcon(size, children, extra) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
          ...(extra || {}),
        },
        children,
      )
    }

    function BookIcon({ size = 18 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M3.5 5.2c2.8-.9 5.4-.6 8.5 1.2 3.1-1.8 5.7-2.1 8.5-1.2v13.1c-2.8-.9-5.4-.6-8.5 1.2-3.1-1.8-5.7-2.1-8.5-1.2Z' }),
        h('path', { key: 'b', d: 'M12 6.4v13.1' }),
      ])
    }

    function ShelfIcon({ size = 20, active = false }) {
      return svgIcon(
        size,
        [
          h('path', { key: 'a', d: 'M3.5 5.2c2.8-.9 5.4-.6 8.5 1.2 3.1-1.8 5.7-2.1 8.5-1.2v13.1c-2.8-.9-5.4-.6-8.5 1.2-3.1-1.8-5.7-2.1-8.5-1.2Z' }),
          h('path', { key: 'b', d: 'M12 6.4v13.1' }),
        ],
        active ? { fill: 'currentColor', fillOpacity: 0.13 } : undefined,
      )
    }

    function PlusIcon({ size = 16 }) {
      return svgIcon(size, [h('path', { key: 'a', d: 'M12 5v14M5 12h14' })])
    }

    function ArrowLeftIcon({ size = 17 }) {
      return svgIcon(size, [h('path', { key: 'a', d: 'M19 12H5M11 6l-6 6 6 6' })])
    }

    function GridIcon({ size = 16 }) {
      return svgIcon(size, [
        h('rect', { key: 'a', x: 4, y: 4, width: 6.5, height: 6.5, rx: 1.4 }),
        h('rect', { key: 'b', x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 1.4 }),
        h('rect', { key: 'c', x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 1.4 }),
        h('rect', { key: 'd', x: 13.5, y: 13.5, width: 6.5, height: 6.5, rx: 1.4 }),
      ])
    }

    function ListIcon({ size = 17 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M9 6h11M9 12h11M9 18h11' }),
        h('path', { key: 'b', d: 'M4.5 6h.01M4.5 12h.01M4.5 18h.01' }),
      ])
    }

    function ChevronLeftIcon({ size = 16 }) {
      return svgIcon(size, [h('path', { key: 'a', d: 'M15 5l-7 7 7 7' })])
    }

    function ChevronRightIcon({ size = 16 }) {
      return svgIcon(size, [h('path', { key: 'a', d: 'M9 5l7 7-7 7' })])
    }

    function ChevronDownIcon({ size = 12 }) {
      return svgIcon(size, [h('path', { key: 'a', d: 'M5 9l7 7 7-7' })])
    }

    function TrashIcon({ size = 14 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M4 7h16M10 4h4M6.5 7l.8 13h9.4l.8-13' }),
        h('path', { key: 'b', d: 'M10 11v5M14 11v5' }),
      ])
    }

    function TagIcon({ size = 15 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M4 4h7l9 9-7 7-9-9Z' }),
        h('circle', { key: 'b', cx: 8, cy: 8, r: 1.4 }),
      ])
    }

    function LinkIcon({ size = 16 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M9.5 14.5 14.5 9.5' }),
        h('path', { key: 'b', d: 'M7.5 16.5 6 18a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0' }),
        h('path', { key: 'c', d: 'M16.5 7.5 18 6a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0' }),
      ])
    }

    function MoreIcon({ size = 16 }) {
      return svgIcon(
        size,
        [
          h('circle', { key: 'a', cx: 5, cy: 12, r: 1.7 }),
          h('circle', { key: 'b', cx: 12, cy: 12, r: 1.7 }),
          h('circle', { key: 'c', cx: 19, cy: 12, r: 1.7 }),
        ],
        { fill: 'currentColor', stroke: 'none' },
      )
    }

    function SearchIcon({ size = 15 }) {
      return svgIcon(size, [
        h('circle', { key: 'a', cx: 10.5, cy: 10.5, r: 6.5 }),
        h('path', { key: 'b', d: 'm15.5 15.5 4.5 4.5' }),
      ])
    }

    function SettingsIcon({ size = 16 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M4 7h8M16 7h4M4 17h4M12 17h8' }),
        h('circle', { key: 'b', cx: 14, cy: 7, r: 2.2 }),
        h('circle', { key: 'c', cx: 10, cy: 17, r: 2.2 }),
      ])
    }

    function BookmarkIcon({ size = 17, filled = false }) {
      return svgIcon(
        size,
        [h('path', { key: 'a', d: 'M6.5 3.5h11a1 1 0 0 1 1 1v16L12 16.3 5.5 20.5v-16a1 1 0 0 1 1-1Z' })],
        filled ? { fill: 'currentColor', fillOpacity: 0.16 } : undefined,
      )
    }

    // Marker pen: the toolbar button and the panel row icon for highlights.
    function MarkerIcon({ size = 17 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'm9 11-6 6v3h9l3-3' }),
        h('path', { key: 'b', d: 'M13 15 22 6a2.1 2.1 0 0 0-3-3L10 12' }),
      ])
    }

    function UnderlineIcon({ size = 17 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M6 4v6a6 6 0 0 0 12 0V4' }),
        h('path', { key: 'b', d: 'M4 20h16' }),
      ])
    }

    function ImmersiveIcon({ size = 16 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M4 4h16v16H4z' }),
        h('path', { key: 'b', d: 'M8.5 8.5h7v7h-7z' }),
      ])
    }

    function FullscreenIcon({ size = 16 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5' }),
      ])
    }

    function MinimizeIcon({ size = 16 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M3 8h5V3M21 8h-5V3M21 16h-5v5M3 16h5v5' }),
      ])
    }

    function CloseIcon({ size = 13 }) {
      return svgIcon(size, [h('path', { key: 'a', d: 'M6 6l12 12M18 6L6 18' })])
    }

    function ZoomOutIcon({ size = 16 }) {
      return svgIcon(size, [
        h('circle', { key: 'a', cx: 11, cy: 11, r: 6.4 }),
        h('path', { key: 'b', d: 'M20 20l-4.2-4.2M8.4 11h5.2' }),
      ])
    }

    function ZoomInIcon({ size = 16 }) {
      return svgIcon(size, [
        h('circle', { key: 'a', cx: 11, cy: 11, r: 6.4 }),
        h('path', { key: 'b', d: 'M20 20l-4.2-4.2M8.4 11h5.2M11 8.4v5.2' }),
      ])
    }

    function AlertIcon({ size = 26 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M12 3.6 21 20H3Z' }),
        h('path', { key: 'b', d: 'M12 10v4.2M12 17.4h.01' }),
      ])
    }

    function Spinner({ small = false }) {
      return h('span', { className: small ? 'bs-spinner bs-spinner-small' : 'bs-spinner', 'aria-hidden': true })
    }

    // Annotation style helpers. The model itself lives in
    // assets/lib/annotations.mjs and is preloaded before the reader opens; the
    // literal fallback only covers the first frames before that preload and a
    // failed module load, and mirrors DEFAULT_ANNOTATION_STYLE field by field.
    const FALLBACK_ANNOTATION_STYLE = Object.freeze({
      mode: 'highlight',
      color: '#ffd23f',
      strength: 0.35,
      thickness: 2,
      underlineStyle: 'solid',
    })
    const ANNOTATION_UNDERLINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'wavy'])
    const ANNOTATION_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

    function defaultAnnotationStyle() {
      const module = clientLib('annotations')
      return module !== null ? module.DEFAULT_ANNOTATION_STYLE : FALLBACK_ANNOTATION_STYLE
    }

    function normalizeAnnotationStyleValue(value) {
      const module = clientLib('annotations')
      if (module !== null) return module.normalizeAnnotationStyle(value)
      const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const mode = source.mode === 'highlight' || source.mode === 'underline' ? source.mode : FALLBACK_ANNOTATION_STYLE.mode
      const color = typeof source.color === 'string' && ANNOTATION_COLOR_PATTERN.test(source.color)
        ? source.color.toLowerCase()
        : FALLBACK_ANNOTATION_STYLE.color
      const strength = typeof source.strength === 'number' && Number.isFinite(source.strength)
        ? Math.round(Math.min(0.9, Math.max(0.05, source.strength)) * 100) / 100
        : FALLBACK_ANNOTATION_STYLE.strength
      const thickness = typeof source.thickness === 'number' && Number.isFinite(source.thickness)
        ? Math.round(Math.min(6, Math.max(1, source.thickness)))
        : FALLBACK_ANNOTATION_STYLE.thickness
      const underlineStyle = ANNOTATION_UNDERLINE_STYLES.includes(source.underlineStyle)
        ? source.underlineStyle
        : FALLBACK_ANNOTATION_STYLE.underlineStyle
      return { mode, color, strength, thickness, underlineStyle }
    }

    // The UI edits a hue slider plus a native colour input, so the stored
    // colour stays a plain hex string the model whitelists.
    function hueForAnnotationColor(color) {
      const match = ANNOTATION_COLOR_PATTERN.exec(typeof color === 'string' ? color : '')
      if (match === null) return 48
      let hex = match[0].slice(1).toLowerCase()
      if (hex.length === 3) hex = hex.split('').map((part) => part + part).join('')
      const red = parseInt(hex.slice(0, 2), 16) / 255
      const green = parseInt(hex.slice(2, 4), 16) / 255
      const blue = parseInt(hex.slice(4, 6), 16) / 255
      const maximum = Math.max(red, green, blue)
      const minimum = Math.min(red, green, blue)
      const delta = maximum - minimum
      if (delta === 0) return 0
      let hue
      if (maximum === red) hue = ((green - blue) / delta) % 6
      else if (maximum === green) hue = (blue - red) / delta + 2
      else hue = (red - green) / delta + 4
      return Math.round(((hue * 60) + 360) % 360)
    }

    function annotationColorForHue(hue) {
      const value = Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 0
      const saturation = 0.86
      const lightness = 0.55
      const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
      const secondary = chroma * (1 - Math.abs(((value / 60) % 2) - 1))
      const offset = lightness - chroma / 2
      let red = 0
      let green = 0
      let blue = 0
      if (value < 60) { red = chroma; green = secondary }
      else if (value < 120) { red = secondary; green = chroma }
      else if (value < 180) { green = chroma; blue = secondary }
      else if (value < 240) { green = secondary; blue = chroma }
      else if (value < 300) { red = secondary; blue = chroma }
      else { red = chroma; blue = secondary }
      const channel = (part) => Math.round((part + offset) * 255).toString(16).padStart(2, '0')
      return `#${channel(red)}${channel(green)}${channel(blue)}`
    }

    // ----- [hooks:state] -----
    // Per-book reader state: initial load, optimistic save queue, exit flush.

    function useReaderState(base, book) {
      const [state, setState] = useState(null)
      const stateRef = useRef({})
      const loadedRef = useRef(false)
      const pendingRef = useRef(null)
      const timerRef = useRef(0)

      useEffect(() => {
        let cancelled = false
        stateRef.current = {}
        pendingRef.current = null
        loadedRef.current = false
        setState(null)
        readBookState(base, book.id)
          .then((value) => {
            if (cancelled) return
            stateRef.current = value
            loadedRef.current = true
            setState(value)
          })
          .catch((failure) => {
            if (cancelled) return
            console.error('bookshelf: could not load reading state', failure)
            stateRef.current = {}
            loadedRef.current = true
            setState({})
          })
        return () => {
          cancelled = true
        }
      }, [base, book.id])

      const flush = useCallback(
        (keepalive = false) => {
          const patch = pendingRef.current
          pendingRef.current = null
          if (patch === null || Object.keys(patch).length === 0) return Promise.resolve()
          // Callers may await the write before leaving the reader, so the
          // refreshed shelf already reflects the page the reader exited from.
          return writeBookState(base, book.id, patch, keepalive).catch((failure) => {
            console.error('bookshelf: could not save reading state', failure)
          })
        },
        [base, book.id],
      )

      const save = useCallback(
        (patch, immediate = false) => {
          if (!loadedRef.current) return
          stateRef.current = { ...stateRef.current, ...patch }
          setState(stateRef.current)
          pendingRef.current = { ...(pendingRef.current || {}), ...patch }
          if (timerRef.current !== 0) {
            clearTimeout(timerRef.current)
            timerRef.current = 0
          }
          if (immediate) {
            flush()
          } else {
            timerRef.current = setTimeout(() => {
              timerRef.current = 0
              flush()
            }, 600)
          }
        },
        [flush],
      )

      useEffect(
        () => () => {
          if (timerRef.current !== 0) {
            clearTimeout(timerRef.current)
            timerRef.current = 0
          }
          flush(true)
        },
        [flush],
      )

      return { state, loaded: state !== null, stateRef, save, flush }
    }

    // ----- [ui:reader] -----
    // Reader chrome widgets: progress slider, bookmarks list and the settings
    // field groups shared by the popover and the shelf settings dialog.

    function ReadingProgress({ t, percent, onSeek }) {
      const trackRef = useRef(null)
      const draggingRef = useRef(false)
      const pointerRef = useRef(null)
      const ratio = Math.min(1, Math.max(0, Number.isFinite(percent) ? percent : 0))

      const seek = useCallback(
        (clientX) => {
          const node = trackRef.current
          if (node === null || typeof onSeek !== 'function') return
          const rect = node.getBoundingClientRect()
          if (rect.width <= 0) return
          onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
        },
        [onSeek],
      )

      const onPointerDown = useCallback(
        (event) => {
          if (event.button !== undefined && event.button !== 0) return
          event.preventDefault()
          draggingRef.current = true
          pointerRef.current = event.pointerId
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // Pointer capture is optional.
          }
          seek(event.clientX)
        },
        [seek],
      )

      const onPointerMove = useCallback(
        (event) => {
          if (!draggingRef.current) return
          seek(event.clientX)
        },
        [seek],
      )

      const onPointerUp = useCallback((event) => {
        draggingRef.current = false
        pointerRef.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // Already released.
        }
      }, [])

      const onKeyDown = useCallback(
        (event) => {
          if (typeof onSeek !== 'function') return
          let next = ratio
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = ratio - 0.01
          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = ratio + 0.01
          else if (event.key === 'PageDown') next = ratio + 0.1
          else if (event.key === 'PageUp') next = ratio - 0.1
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = 1
          else return
          event.preventDefault()
          onSeek(Math.min(1, Math.max(0, next)))
        },
        [onSeek, ratio],
      )

      const label = t('readingProgress')
      return h(
        'div',
        {
          ref: trackRef,
          className: 'bs-progress',
          role: 'slider',
          tabIndex: 0,
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(ratio * 100),
          'aria-valuetext': `${Math.round(ratio * 100)}%`,
          title: `${label} · ${Math.round(ratio * 100)}%`,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onKeyDown,
        },
        h('div', { className: 'bs-progress-fill', style: { width: `${ratio * 100}%` } }),
        h('div', { className: 'bs-progress-thumb', style: { left: `${ratio * 100}%` } }),
      )
    }

    function BookmarksList({ t, bookmarks, onSelect, onDelete }) {
      if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
        return h('div', { className: 'bs-bookmark-empty' }, t('noBookmarks'))
      }
      return h(
        'div',
        null,
        bookmarks.map((bookmark) =>
          h(
            'div',
            { className: 'bs-bookmark-row', key: bookmark.id },
            h(
              'button',
              {
                type: 'button',
                className: 'bs-bookmark-main',
                title: bookmark.label,
                onClick: () => onSelect(bookmark),
              },
              bookmark.label || t('bookmark'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bs-bookmark-delete',
                title: t('deleteBookmark'),
                'aria-label': t('deleteBookmark'),
                onClick: () => onDelete(bookmark),
              },
              h(TrashIcon, { size: 12 }),
            ),
          ),
        ),
      )
    }

    // Annotation style popover: two categories (highlight / underline), each
    // with its own sub-options. The preview is exclusive: it only renders the
    // category being edited, so strength never shows up on an underline preview
    // and thickness never shows up on a highlight one.
    function AnnotationStyleMenu({ t, style, onChange, onClose }) {
      const fallback = defaultAnnotationStyle()
      const mode = style.mode === 'underline' ? 'underline' : 'highlight'
      const storedColor = typeof style.color === 'string' && ANNOTATION_COLOR_PATTERN.test(style.color) ? style.color : fallback.color
      const paint = storedColor.toLowerCase()
      const hue = hueForAnnotationColor(paint)
      const strength = Math.round(Math.min(0.9, Math.max(0.05, style.strength)) * 100)
      const thickness = Math.round(Math.min(6, Math.max(1, style.thickness)))
      const underlineStyle = ANNOTATION_UNDERLINE_STYLES.includes(style.underlineStyle) ? style.underlineStyle : fallback.underlineStyle
      const preview = mode === 'underline'
        ? {
            textDecorationLine: 'underline',
            textDecorationColor: paint,
            textDecorationThickness: `${thickness}px`,
            textDecorationStyle: underlineStyle,
          }
        : { backgroundColor: `color-mix(in srgb, ${paint} ${strength}%, transparent)` }
      const tab = (value, label) => h(
        'button',
        {
          key: value,
          type: 'button',
          role: 'tab',
          className: 'bs-annotation-tab',
          'aria-selected': mode === value,
          onClick: () => onChange({ mode: value }),
        },
        label,
      )
      const underlineOption = (value, label) => h(
        'button',
        {
          key: value,
          type: 'button',
          className: 'bs-segment',
          'aria-pressed': underlineStyle === value,
          onClick: () => onChange({ underlineStyle: value }),
        },
        label,
      )
      const colorRow = () => h(
        'div',
        { className: 'bs-setting-row' },
        h('span', { className: 'bs-setting-label' }, t('annotationColor')),
        h(
          'div',
          { className: 'bs-annotation-color-row' },
          h('input', {
            type: 'range',
            className: 'bs-annotation-hue',
            min: 0,
            max: 359,
            step: 1,
            value: hue,
            'aria-label': t('annotationColor'),
            title: t('annotationColor'),
            onChange: (event) => onChange({ color: annotationColorForHue(Number(event.target.value)) }),
          }),
          h('input', {
            type: 'color',
            className: 'bs-annotation-color-input',
            value: paint,
            'aria-label': t('annotationColorPick'),
            title: t('annotationColorPick'),
            onChange: (event) => onChange({ color: event.target.value }),
          }),
        ),
      )
      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-popover-backdrop', onClick: onClose }),
        h(
          'div',
          { className: 'bs-annotation-menu', role: 'dialog', 'aria-label': t('annotationStyle') },
          h(
            'div',
            { className: 'bs-settings-head' },
            h('span', { className: 'bs-settings-title' }, t('annotationStyle')),
            h(
              'button',
              { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') },
              h(CloseIcon),
            ),
          ),
          h(
            'div',
            { className: 'bs-annotation-tabs', role: 'tablist', 'aria-label': t('annotationMode') },
            tab('highlight', t('annotationHighlight')),
            tab('underline', t('annotationUnderline')),
          ),
          h('div', { className: 'bs-annotation-preview', 'data-mode': mode, style: preview }, t('annotationPreview')),
          colorRow(),
          mode === 'highlight'
            ? h(
                'div',
                { className: 'bs-setting-row' },
                h('span', { className: 'bs-setting-label' }, t('annotationStrength'), h('span', { className: 'bs-annotation-value' }, `${strength}%`)),
                h('input', {
                  type: 'range',
                  className: 'bs-annotation-range bs-annotation-strength',
                  min: 5,
                  max: 90,
                  step: 1,
                  value: strength,
                  'aria-label': t('annotationStrength'),
                  title: t('annotationStrength'),
                  onChange: (event) => onChange({ strength: Number(event.target.value) / 100 }),
                }),
              )
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'bs-setting-row' },
                  h('span', { className: 'bs-setting-label' }, t('annotationThickness'), h('span', { className: 'bs-annotation-value' }, `${thickness}px`)),
                  h('input', {
                    type: 'range',
                    className: 'bs-annotation-range bs-annotation-thickness',
                    min: 1,
                    max: 6,
                    step: 1,
                    value: thickness,
                    'aria-label': t('annotationThickness'),
                    title: t('annotationThickness'),
                    onChange: (event) => onChange({ thickness: Number(event.target.value) }),
                  }),
                ),
                h(
                  'div',
                  { className: 'bs-setting-row' },
                  h('span', { className: 'bs-setting-label' }, t('annotationUnderlineStyle')),
                  h(
                    'div',
                    { className: 'bs-segmented bs-annotation-underline-options', role: 'group', 'aria-label': t('annotationUnderlineStyle') },
                    ANNOTATION_UNDERLINE_STYLES.map((value) =>
                      underlineOption(value, t(`underline${value[0].toUpperCase()}${value.slice(1)}`))),
                  ),
                ),
              ),
        ),
      )
    }

    function ReadingItemIcon({ kind }) {
      if (kind === 'highlight') {
        return h('span', { className: 'bs-reading-icon bs-reading-icon-highlight' }, h(MarkerIcon, { size: 14 }))
      }
      if (kind === 'underline') {
        return h('span', { className: 'bs-reading-icon bs-reading-icon-underline' }, h(UnderlineIcon, { size: 14 }))
      }
      return h('span', { className: 'bs-reading-icon bs-reading-icon-bookmark' }, h(BookmarkIcon, { size: 14, filled: true }))
    }

    // Bookmark / highlight / underline rows for the reader aside. Items come
    // from assets/lib/reading-list.mjs (merge + sort + filter + counts), so this
    // component only renders one flat row per item.
    function ReadingList({ t, items, emptyLabel, onSelect, onDelete }) {
      if (!Array.isArray(items) || items.length === 0) {
        return h('div', { className: 'bs-reading-empty' }, emptyLabel)
      }
      return h(
        'div',
        { className: 'bs-reading-list' },
        items.map((item) =>
          h(
            'div',
            { key: item.id, className: 'bs-reading-row', 'data-kind': item.kind },
            h(
              'button',
              {
                type: 'button',
                className: 'bs-reading-main',
                title: item.label,
                onClick: () => onSelect(item),
              },
              h(ReadingItemIcon, { kind: item.kind }),
              h(
                'span',
                { className: 'bs-reading-text' },
                h('span', { className: 'bs-reading-label' }, item.label || t('untitled')),
                item.detail ? h('span', { className: 'bs-reading-detail' }, item.detail) : null,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bs-reading-delete',
                title: t('deleteReadingItem'),
                'aria-label': t('deleteReadingItem'),
                onClick: () => onDelete(item),
              },
              h(TrashIcon, { size: 12 }),
            ),
          ),
        ),
      )
    }

    function ReadingSegmented({ label, options, value, onChange }) {
      return h(
        'div',
        { className: 'bs-setting-row' },
        h('span', { className: 'bs-setting-label' }, label),
        h(
          'div',
          { className: 'bs-segmented', role: 'group', 'aria-label': label },
          options.map((option) =>
            h(
              'button',
              {
                key: String(option.value),
                type: 'button',
                className: 'bs-segment',
                'aria-pressed': value === option.value,
                onClick: () => onChange(option.value),
                title: option.label,
              },
              option.label,
            ),
          ),
        ),
      )
    }

    function ReadingFontSettings({ t, settings, onChange }) {
      const [module, setModule] = useState(null)
      const [catalog, setCatalog] = useState(null)
      const [styles, setStyles] = useState({ known: false, weights: [], italic: false })
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const mounted = useRef(false)
      useEffect(() => {
        mounted.current = true
        loadReadingFonts(transportBase()).then(async value => {
          if (!mounted.current) return
          setModule(value)
          const result = await value.getFontCatalog()
          if (mounted.current) setCatalog(result)
        }).catch(() => { if (mounted.current) setMessage('fontLoadFailed') })
        return () => { mounted.current = false }
      }, [])
      useEffect(() => {
        let cancelled = false
        setStyles({ known: false, weights: [], italic: false })
        if (module && settings.fontName) {
          module.getFontStyles(settings.fontName).then(result => { if (!cancelled) setStyles(result) })
        }
        return () => { cancelled = true }
      }, [module, catalog, settings.fontName])
      const scan = () => {
        if (!module || busy) return
        // Do not await module loading here: preserve the click's user activation.
        const request = module.scanSystemFonts()
        setBusy(true)
        setMessage('')
        request.then(result => {
          if (!mounted.current) return
          setCatalog(result)
          setMessage(result.fonts.length ? 'fontScanComplete' : 'fontScanEmpty')
        }).catch(error => {
          if (!mounted.current) return
          setMessage(error.name === 'NotAllowedError' ? 'fontAccessDenied' : error.name === 'NotSupportedError' || error.name === 'SecurityError' ? 'fontAccessUnavailable' : 'fontScanFailed')
        }).finally(() => { if (mounted.current) setBusy(false) })
      }
      const fonts = catalog?.fonts || []
      const selected = settings.fontName || ''
      const listed = fonts.some(font => font.family === selected)
      const weights = [...new Set([...(selected ? (settings.fontStyle === 'italic' ? styles.italicWeights : styles.normalWeights) || [] : [400, 700]), ...(settings.fontWeight ? [settings.fontWeight] : [])])].sort((a, b) => a - b)
      const row = (label, value, options, change) => h('label', { className: 'bs-setting-row' },
        h('span', { className: 'bs-setting-label' }, t(label)),
        h('select', { className: 'bs-setting-select', 'aria-label': t(label), value, onChange: event => change(event.target.value) },
          options.map(option => h('option', { key: String(option.value), value: option.value }, option.label))))
      return h(React.Fragment, null,
        h('h3', { className: 'bs-settings-section' }, t('fontSection')),
        row('fontFamily', selected ? `font:${selected}` : `preset:${settings.fontFamily || 'serif'}`, [
          { value: 'preset:serif', label: t('fontDefaultSerif') },
          { value: 'preset:sans', label: t('fontDefaultSans') },
          { value: 'preset:mono', label: t('fontDefaultMono') },
          ...(selected && !listed ? [{ value: `font:${selected}`, label: selected }] : []),
          ...fonts.map(font => ({ value: `font:${font.family}`, label: font.family })),
        ], value => {
          onChange(value.startsWith('preset:')
            ? { fontName: '', fontFamily: value.slice(7), fontWeight: 0, fontStyle: 'normal' }
            : { fontName: value.slice(5), fontWeight: 0, fontStyle: 'normal' })
        }),
        h('div', { className: 'bs-font-actions' },
          h('button', { type: 'button', className: 'bs-text-button', disabled: !module || busy, onClick: scan, 'aria-label': t('scanSystemFonts') }, busy ? t('fontScanning') : t('scanSystemFonts'))),
        h('p', { className: 'bs-font-status', role: 'status' }, t(message || (catalog?.complete ? 'fontScanComplete' : 'fontCommonHint'))),
        selected && catalog?.complete && !listed ? h('p', { className: 'bs-font-status', role: 'status' }, t('fontMissingHint')) : null,
        h('div', { className: 'bs-settings-divider' }),
        h('h3', { className: 'bs-settings-section' }, t('typographySection')),
        row('fontWeight', settings.fontWeight || 0, [{ value: 0, label: t('fontWeightAuto') }, ...weights.map(weight => ({ value: weight, label: String(weight) }))], value => onChange({ fontWeight: Number(value) })),
        row('fontStyle', settings.fontStyle || 'normal', [
          { value: 'normal', label: t('fontStyleNormal') },
          ...(!selected || styles.italic || settings.fontStyle === 'italic' ? [{ value: 'italic', label: t('fontStyleItalic') }] : []),
        ], value => {
          const supported = value === 'italic' ? styles.italicWeights : styles.normalWeights
          onChange({ fontStyle: value, fontWeight: !selected || supported?.includes(settings.fontWeight) ? settings.fontWeight || 0 : 0 })
        }),
        selected && !styles.known ? h('p', { className: 'bs-font-status' }, t('fontStylesHint')) : null,
      )
    }

    function ReadingSettingsFields({
      t, settings, onChange, includeExtras = true, workspaces, discussionWorkspace, onDiscussionWorkspaceChange,
      appleBooksAvailable, appleBooksEnabled, onAppleBooksEnabledChange,
    }) {
      const workspaceChoices = Array.isArray(workspaces) ? workspaces.filter((item) => item && typeof item.workspaceId === 'string') : null
      const selectedWorkspace = workspaceChoices !== null && workspaceChoices.some((item) => item.workspaceId === discussionWorkspace) ? discussionWorkspace : ''
      return h(
        React.Fragment,
        null,
          includeExtras && workspaceChoices !== null && typeof onDiscussionWorkspaceChange === 'function'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'bs-setting-row' },
                  h('span', { className: 'bs-setting-label' }, t('discussionWorkspaceSetting')),
                  h(
                    'select',
                    {
                      className: 'bs-setting-select',
                      value: selectedWorkspace,
                      'aria-label': t('discussionWorkspaceSetting'),
                      onChange: (event) => onDiscussionWorkspaceChange(event.target.value),
                    },
                    h('option', { value: '' }, t('discussionWorkspaceAsk')),
                    workspaceChoices.map((item) => h('option', { key: item.workspaceId, value: item.workspaceId }, item.title || item.path || item.workspaceId)),
                  ),
                  h('p', { className: 'bs-settings-hint' }, t('discussionWorkspaceSettingHint')),
                ),
                h('div', { className: 'bs-settings-divider' }),
              )
            : null,
          includeExtras && appleBooksAvailable === true && typeof onAppleBooksEnabledChange === 'function'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'bs-setting-row' },
                  h(
                    'label',
                    { className: 'bs-setting-toggle' },
                    h('input', {
                      type: 'checkbox',
                      checked: Boolean(appleBooksEnabled),
                      onChange: (event) => onAppleBooksEnabledChange(event.target.checked),
                    }),
                    h('span', null, t('appleBooksImportToggle')),
                  ),
                  h('p', { className: 'bs-settings-hint' }, t('appleBooksImportToggleHint')),
                ),
                h('div', { className: 'bs-settings-divider' }),
              )
            : null,
          h(ReadingFontSettings, { t, settings, onChange }),
          h(
            'div',
            { className: 'bs-setting-row' },
            h('span', { className: 'bs-setting-label' }, t('fontSize')),
            h(
              'div',
              { className: 'bs-stepper' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-stepper-button',
                  disabled: settings.fontSize <= 14,
                  onClick: () => onChange({ fontSize: Math.max(14, settings.fontSize - 1) }),
                  title: t('fontSmaller'),
                  'aria-label': t('fontSmaller'),
                },
                '−',
              ),
              h('span', { className: 'bs-stepper-value' }, settings.fontSize),
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-stepper-button',
                  disabled: settings.fontSize >= 28,
                  onClick: () => onChange({ fontSize: Math.min(28, settings.fontSize + 1) }),
                  title: t('fontLarger'),
                  'aria-label': t('fontLarger'),
                },
                '+',
              ),
            ),
          ),
          h(ReadingSegmented, {
            label: t('lineHeight'),
            value: settings.lineHeight,
            options: [
              { value: 1.65, label: t('lineCompact') },
              { value: 1.85, label: t('lineNormal') },
              { value: 2.05, label: t('lineLoose') },
            ],
            onChange: (value) => onChange({ lineHeight: value }),
          }),
          h(ReadingSegmented, {
            label: t('pageMargins'),
            value: settings.pageMargin,
            options: [
              { value: 'standard', label: t('marginStandard') },
              { value: 'compact', label: t('marginCompact') },
              { value: 'fill', label: t('marginFill') },
            ],
            onChange: (value) => onChange({ pageMargin: value }),
          }),
          h(ReadingSegmented, {
            label: t('readingMode'),
            value: settings.pageMode,
            options: [
              { value: 'scroll', label: t('modeScroll') },
              { value: 'paged', label: t('modePaged') },
            ],
            onChange: (value) => onChange({ pageMode: value }),
          }),
          settings.pageMode === 'paged' ? h(ReadingSegmented, {
            label: t('pageSpread'),
            value: settings.pageSpread || 'auto',
            options: [
              { value: 'auto', label: t('spreadAuto') },
              { value: 'single', label: t('spreadSingle') },
            ],
            onChange: (value) => onChange({ pageSpread: value }),
          }) : null,
          h(ReadingSegmented, {
            label: t('readingTheme'),
            value: settings.theme,
            options: [
              { value: 'auto', label: t('themeAuto') },
              { value: 'light', label: t('themeLight') },
              { value: 'dark', label: t('themeDark') },
            ],
            onChange: (value) => onChange({ theme: value }),
          }),
      )
    }

    function ReaderSettingsPopover({ t, settings, onChange, onClose, title, hint, workspaces, discussionWorkspace, onDiscussionWorkspaceChange, appleBooksAvailable, appleBooksEnabled, onAppleBooksEnabledChange }) {
      const heading = title || t('readingSettings')
      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-popover-backdrop', onClick: onClose }),
        h(
          'div',
          { className: 'bs-reader-settings', role: 'dialog', 'aria-label': heading },
          h(
            'div',
            { className: 'bs-settings-head' },
            h('span', { className: 'bs-settings-title' }, heading),
            h(
              'button',
              { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') },
              h(CloseIcon),
            ),
          ),
          hint ? h('p', { className: 'bs-settings-hint' }, hint) : null,
          h(ReadingSettingsFields, {
            t, settings, onChange, workspaces, discussionWorkspace, onDiscussionWorkspaceChange,
            appleBooksAvailable, appleBooksEnabled, onAppleBooksEnabledChange,
          }),
        ),
      )
    }

    // ===== [hooks] =====
    // Read-aloud state machine, the speech helpers that stay synchronous and
    // the speech controls bound to it.
    // The Host owns synthesis and caching; the browser walks the text into
    // sentences, requests one utterance at a time, and follows along by turning
    // pages and advancing chapters.
    function SpeechIcon({ size = 16 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M4 9.5h3l4-3.5v12l-4-3.5H4z' }),
        h('path', { key: 'b', d: 'M15.5 8.5a4.5 4.5 0 0 1 0 7' }),
        h('path', { key: 'c', d: 'M18 6a8 8 0 0 1 0 12' }),
      ])
    }

    function PlayIcon({ size = 15 }) {
      return svgIcon(size, [h('path', { key: 'a', d: 'M8 5.5v13l10-6.5z' })])
    }

    function PauseIcon({ size = 15 }) {
      return svgIcon(size, [
        h('path', { key: 'a', d: 'M9 5v14M15 5v14' }),
      ])
    }

    // 40 ms of silence; playing it inside the click unlocks the audio element,
    // so the sentence that arrives after an async fetch can still play.
    const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA='
    // A stuck speech service must not leave the UI spinning forever.
    const TTS_TEST_TIMEOUT_MS = 12_000
    const TTS_SENTENCE_TIMEOUT_MS = 30_000
    const isTimeoutFailure = (failure) => failure instanceof Error && (failure.name === 'TimeoutError' || failure.name === 'AbortError')

    // Read-aloud follows the book's own language when the provider offers a
    // matching voice: declared EPUB metadata wins, otherwise a cheap script
    // count from the first chapter.
    function detectSpeechLanguage(text) {
      const value = String(text || '')
      if (value === '') return ''
      const kana = (value.match(/[\u3040-\u30ff]/g) || []).length
      const hangul = (value.match(/[\uac00-\ud7af]/g) || []).length
      const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length
      const latin = (value.match(/[A-Za-z]/g) || []).length
      if (kana > 10 && kana * 4 > cjk) return 'ja'
      if (hangul > 10 && hangul * 4 > cjk) return 'ko'
      if (cjk > 0 && cjk * 5 >= latin) return 'zh'
      if (latin > 20) return 'en'
      return ''
    }

    function epubSpeechLanguage(data) {
      if (data === null || data === undefined) return ''
      const declared = String(data.language || '').trim()
      if (declared !== '') return declared
      try {
        const container = document.createElement('div')
        container.innerHTML = (data.chapters && data.chapters[0] && data.chapters[0].html) || ''
        return detectSpeechLanguage(container.innerText || container.textContent || '')
      } catch {
        return ''
      }
    }

    function rangePage(doc, win, range) {
      if (range === null) return null
      const info = pagedMetrics(doc, win)
      if (info === null) return null
      const rects = range.getClientRects()
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect()
      if (!Number.isFinite(rect.left)) return null
      // Range rects are viewport-relative: add the current column offset, or a
      // sentence two pages ahead would be computed as page 2 and the reader
      // would jump back and forth between the same two pages.
      const body = doc.body
      const documentElement = doc.documentElement
      const scrollLeft = Math.max(body ? body.scrollLeft : 0, documentElement ? documentElement.scrollLeft : 0)
      return Math.max(0, Math.floor((rect.left + scrollLeft - info.padLeft + 1) / info.step))
    }

    // A highlighter swipe painted over the sentence being read. Each band is a
    // fixed-position child of the chapter root: a wrapper element would create
    // its own stacking context and the multiply blend would stop reaching the
    // page, so the ink would no longer look like a marker over the text.
    const SPEECH_BAND_ATTR = 'data-bb-glass-band'

    function clearSpeechGlass(documentNode) {
      if (!documentNode) return
      for (const band of Array.from(documentNode.querySelectorAll(`[${SPEECH_BAND_ATTR}]`))) band.remove()
    }

    function paintSpeechGlass(documentNode, range) {
      if (!documentNode || !documentNode.documentElement || range === null) return
      clearSpeechGlass(documentNode)
      let rects = []
      try {
        rects = Array.from(range.getClientRects())
      } catch {
        rects = []
      }
      const lines = []
      for (const rect of rects) {
        if (!(rect.width > 0 && rect.height > 0)) continue
        if (rect.right <= 0 || rect.bottom <= 0) continue
        // Merge fragments that share a line so the stroke reads as one swipe.
        const same = lines.find((line) => Math.abs(line.top - rect.top) < 2 && Math.abs(line.height - rect.height) < 2)
        if (same) {
          same.left = Math.min(same.left, rect.left)
          same.right = Math.max(same.right, rect.right)
        } else {
          lines.push({ left: rect.left, right: rect.right, top: rect.top, height: rect.height })
        }
      }
      if (lines.length === 0) return
      const scheme = String(documentNode.documentElement.style.getPropertyValue('--bb-scheme') || '').trim()
      const dark = scheme === 'dark'
      // Marker ink: warm translucent yellow in light mode, a soft glow in dark
      // mode. Blend modes keep the glyph edges untouched and the words readable.
      const fill = dark ? 'rgba(255,214,64,0.28)' : 'rgba(255,214,64,0.55)'
      const blend = dark ? 'screen' : 'multiply'
      // Bands hang directly off the root so the blend reaches the page content.
      for (const line of lines) {
        const band = documentNode.createElement('span')
        band.setAttribute(SPEECH_BAND_ATTR, '')
        band.setAttribute('aria-hidden', 'true')
        band.style.cssText = [
          'position:fixed',
          'pointer-events:none',
          'z-index:2147483000',
          'border-radius:3px 5px 4px 6px',
          `left:${Math.round(line.left) - 3}px`,
          `top:${Math.round(line.top) - 1}px`,
          `width:${Math.round(line.right - line.left) + 6}px`,
          `height:${Math.round(line.height) + 2}px`,
          `background:${fill}`,
          `mix-blend-mode:${blend}`,
        ].join(';')
        documentNode.documentElement.appendChild(band)
      }
    }

    function useReadAloud({ base, t, language = '' }) {
      const [status, setStatus] = useState('idle')
      const [caption, setCaption] = useState('')
      const [error, setError] = useState('')
      const [settings, setSettings] = useState(null)
      const [providers, setProviders] = useState([])
      const [secrets, setSecrets] = useState({})
      const runRef = useRef(0)
      const batchRef = useRef(null)
      const indexRef = useRef(0)
      const driverRef = useRef(null)
      const audioRef = useRef(null)
      const audioCacheRef = useRef(new Map())
      const settingsRef = useRef(null)
      const settingsReadyRef = useRef(null)
      const providersRef = useRef([])
      const defaultProviderRef = useRef('')
      const languageRef = useRef(language)
      const pausedRef = useRef(false)

      useEffect(() => {
        languageRef.current = language || ''
      }, [language])

      const setLanguage = useCallback((value) => {
        languageRef.current = String(value || '')
      }, [])

      const applySettings = useCallback((next) => {
        settingsRef.current = next
        setSettings(next)
        // A different provider, voice or speed means different audio bytes.
        audioCacheRef.current.clear()
      }, [])

      useEffect(() => {
        let cancelled = false
        // Clicking read-aloud right after entering a book used to race this
        // request; synthesis now waits for the settings instead of failing.
        const task = requestJson(base, '/tts/capabilities')
          .then((payload) => {
            if (cancelled) return
            setProviders(Array.isArray(payload.providers) ? payload.providers : [])
            setSecrets(payload.secrets && typeof payload.secrets === 'object' ? payload.secrets : {})
            providersRef.current = Array.isArray(payload.providers) ? payload.providers : []
            defaultProviderRef.current = typeof payload.defaultProvider === 'string' ? payload.defaultProvider : ''
            applySettings(payload.settings || null)
          })
          .catch(() => undefined)
        settingsReadyRef.current = task
        task.then(() => {
          if (settingsReadyRef.current === task) settingsReadyRef.current = null
        })
        return () => { cancelled = true }
      }, [base, applySettings])

      useEffect(() => () => {
        runRef.current += 1
        const audio = audioRef.current
        if (audio !== null) {
          audio.pause()
          audio.onended = null
          audio.onerror = null
        }
        audioCacheRef.current.clear()
      }, [])

      const getAudio = useCallback(() => {
        if (audioRef.current === null) audioRef.current = new Audio()
        return audioRef.current
      }, [])

      // Must run synchronously from the click: Chromium only allows later
      // programmatic playback once a gesture played something. A separate
      // element is used so its end event never confuses the sentence queue.
      const unlockRef = useRef(null)
      const unlock = useCallback(() => {
        if (unlockRef.current !== null) return
        try {
          const audio = new Audio(SILENT_WAV)
          audio.volume = 0
          const started = audio.play()
          if (started && typeof started.catch === 'function') started.catch(() => undefined)
          unlockRef.current = audio
        } catch {
          // Autoplay may still be blocked; playback errors surface in the bar.
        }
      }, [])

      // `options.cache === false` marks one-off selection audio: the in-memory
      // map is skipped and the Host is asked to leave the file out of its cache
      // (`tts-scratch/`), so a selection never evicts the book's sentences.
      const audioFor = useCallback((text, options) => {
        const cacheEnabled = !(options !== null && options !== undefined && options.cache === false)
        const pending = settingsReadyRef.current
        if (pending) {
          return Promise.resolve(pending).then(() => audioFor(text, options))
        }
        const current = settingsRef.current
        if (current === null) return Promise.reject(new Error(t('ttsNotReady')))
        const key = `${current.provider}\u0000${current.voice}\u0000${current.autoVoice}\u0000${languageRef.current}\u0000${current.speed}\u0000${text}`
        const cache = audioCacheRef.current
        if (cacheEnabled) {
          const hit = cache.get(key)
          if (hit !== undefined) return hit
        }
        const promise = (async () => {
          const provider = resolveSpeechProvider(current, providersRef.current, defaultProviderRef.current)
          const providerVoices = (providersRef.current.find((item) => item.id === provider) || {}).voices || []
          const voice = resolveSpeechVoice({
            provider,
            voices: providerVoices,
            settings: current,
            language: languageRef.current,
          })
          let response
          try {
            response = await fetch(resourceUrl(base, `${API_ROOT}/tts/synthesize`), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ provider, voice, text, speed: current.speed, ...(cacheEnabled ? {} : { cache: false }) }),
              signal: AbortSignal.timeout(TTS_SENTENCE_TIMEOUT_MS),
            })
          } catch (failure) {
            if (isTimeoutFailure(failure)) throw new Error(t('ttsTimeout'))
            throw failure
          }
          if (!response.ok) {
            let message = `HTTP ${response.status}`
            try {
              const payload = await response.json()
              if (payload && typeof payload.error === 'string') message = payload.error
            } catch {
              // Keep the status line.
            }
            throw new Error(message)
          }
          const payload = await response.json()
          if (!payload || typeof payload.url !== 'string') throw new Error(t('ttsPlaybackFailed'))
          return payload.url
        })()
        if (cacheEnabled) {
          cache.set(key, promise)
          promise.catch(() => cache.delete(key))
        }
        return promise
      }, [base, t])

      const playUrl = useCallback((url, run) => new Promise((resolve, reject) => {
        const audio = getAudio()
        let settled = false
        const finish = (error) => {
          if (settled) return
          settled = true
          audio.onended = null
          audio.onerror = null
          if (error) reject(error)
          else resolve()
        }
        audio.onended = () => finish(null)
        audio.onerror = () => finish(new Error(t('ttsPlaybackFailed')))
        audio.src = resourceUrl(base, url)
        audio.playbackRate = settingsRef.current ? settingsRef.current.speed : 1
        if (pausedRef.current) return
        const started = audio.play()
        if (started && typeof started.catch === 'function') {
          started.catch((error) => finish(new Error(
            error && error.name === 'NotAllowedError' ? t('ttsPlaybackBlocked') : t('ttsPlaybackFailed'),
          )))
        }
        void run
      }), [base, getAudio, t])

      // Play one sentence queue in order. `item.cache === false` marks the
      // temporary selection queue: its audio is never reused, and a scratch URL
      // that has expired (the Host prunes scratch files after ten minutes) is
      // synthesized once more instead of surfacing a playback error.
      const playBatch = useCallback(async (batch, startIndex) => {
        const run = ++runRef.current
        batchRef.current = batch
        setStatus('loading')
        setError('')
        for (let index = startIndex; index < batch.length; index += 1) {
          if (runRef.current !== run) return null
          indexRef.current = index
          const item = batch[index]
          const policy = item !== null && typeof item === 'object' && item.cache === false ? { cache: false } : undefined
          setCaption(item.text)
          const lookahead = batch[index + 1]
          if (lookahead) {
            const lookaheadPolicy = lookahead !== null && typeof lookahead === 'object' && lookahead.cache === false ? { cache: false } : undefined
            audioFor(lookahead.text, lookaheadPolicy).catch(() => undefined)
          }
          if (typeof item.enter === 'function') await item.enter()
          if (runRef.current !== run) return null
          let url
          try {
            url = await audioFor(item.text, policy)
          } catch (failure) {
            if (runRef.current !== run) return null
            setError(failure instanceof Error ? failure.message : String(failure))
            setStatus('error')
            return null
          }
          if (runRef.current !== run) return null
          setStatus('playing')
          try {
            await playUrl(url, run)
          } catch (failure) {
            if (runRef.current !== run) return null
            if (policy === undefined) {
              setError(failure instanceof Error ? failure.message : String(failure))
              setStatus('error')
              return null
            }
            // An uncached scratch file may be gone (expired or cleaned): ask for
            // it once more, then give up only if that also fails.
            try {
              const retryUrl = await audioFor(item.text, policy)
              if (runRef.current !== run) return null
              await playUrl(retryUrl, run)
            } catch (retryFailure) {
              if (runRef.current !== run) return null
              setError(retryFailure instanceof Error ? retryFailure.message : String(retryFailure))
              setStatus('error')
              return null
            }
          }
          if (runRef.current !== run) return null
        }
        // Batch finished; the reader decides what comes next (page or chapter).
        const driver = driverRef.current
        if (driver === null) { setStatus('idle'); return run }
        setStatus('loading')
        let nextBatch
        try {
          nextBatch = await driver.advance()
        } catch (failure) {
          if (runRef.current !== run) return null
          setError(failure instanceof Error ? failure.message : String(failure))
          setStatus('error')
          return null
        }
        if (runRef.current !== run) return null
        if (nextBatch === null || nextBatch.length === 0) {
          // Keep the last sentence on screen: after the queue ends the reader
          // still needs to see where read-aloud stopped.
          setStatus('idle')
          return run
        }
        return playBatch(nextBatch, 0)
      }, [audioFor, playUrl])

      const start = useCallback(async (driver) => {
        driverRef.current = driver
        pausedRef.current = false
        let batch
        try {
          batch = await driver.current()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setStatus('error')
          return
        }
        if (batch === null || batch.length === 0) {
          setStatus('idle')
          return
        }
        await playBatch(batch, 0)
      }, [playBatch])

      // Select the sentence the reader is on without starting playback, so the
      // highlight and preview appear the moment read-aloud is opened. Playback
      // then continues from this selection instead of repeating the page start.
      const preview = useCallback(async (driver) => {
        if (!driver) return
        const run = ++runRef.current
        driverRef.current = driver
        pausedRef.current = false
        let batch
        try {
          batch = await driver.current()
        } catch {
          return
        }
        if (runRef.current !== run) return
        if (batch === null || batch.length === 0) return
        batchRef.current = batch
        indexRef.current = 0
        setError('')
        setCaption(batch[0].text)
        setStatus('stopped')
        const item = batch[0]
        // Preview must not scroll or turn a page; readers only paint a sentence
        // that is already on screen.
        if (typeof item.preview === 'function') {
          try {
            await item.preview()
          } catch {
            // A preview that cannot paint still leaves the caption in place.
          }
        }
      }, [])

      // Read an explicit text (a selection) without following the page: the
      // queue is a plain sentence list, so the reader keeps its position while
      // the selection is spoken. Selection audio is never cached. When a
      // read-aloud driver is active, playback then resumes at the chapter
      // sentence that contains the selection's last sentence — that sentence is
      // deliberately read once more (docs/PLAN-split-and-annotations.md §6.2).
      const speakText = useCallback(async (text) => {
        const value = String(text || '').trim()
        if (value === '') return
        let module
        let selection
        try {
          ;[module, selection] = await Promise.all([
            loadTtsSentences(base),
            clientLib('selection-speech') !== null ? clientLib('selection-speech') : loadClientLib(base, 'selection-speech'),
          ])
        } catch {
          return
        }
        const sentences = selection.splitSelectionSentences(value, module.splitSentences)
        if (sentences.length === 0) return
        const resumeDriver = driverRef.current
        driverRef.current = null
        unlock()
        const run = await playBatch(sentences.map((sentence) => ({ text: sentence, cache: false })), 0)
        // A stop, an error or a newer utterance during the selection keeps the
        // driver off; only a naturally finished selection resumes the book.
        if (run === null || runRef.current !== run || resumeDriver === null) return
        let batch
        try {
          batch = await resumeDriver.current()
        } catch {
          return
        }
        if (runRef.current !== run || !Array.isArray(batch) || batch.length === 0) return
        driverRef.current = resumeDriver
        const start = Math.max(0, selection.resumeIndexFor(batch, selection.lastSelectionSentence(sentences)))
        await playBatch(batch, start)
      }, [base, playBatch, unlock])

      const toggle = useCallback(() => {
        if (status === 'playing') {
          const audio = audioRef.current
          if (audio !== null) audio.pause()
          pausedRef.current = true
          setStatus('paused')
          return
        }
        if (status === 'paused') {
          const audio = audioRef.current
          pausedRef.current = false
          setStatus('playing')
          if (audio !== null) {
            const started = audio.play()
            if (started && typeof started.catch === 'function') started.catch(() => undefined)
          }
          return
        }
        if (status === 'error') {
          // A playback failure is recoverable: retry the same utterance.
          unlock()
          const batch = batchRef.current
          if (batch !== null) void playBatch(batch, Math.max(0, indexRef.current))
          return
        }
        if (status === 'stopped') {
          // Sentence switching leaves the queue armed at indexRef; play resumes
          // there instead of restarting from the page top.
          unlock()
          const batch = batchRef.current
          if (batch !== null) {
            void playBatch(batch, Math.max(0, indexRef.current))
            return
          }
        }
        if (status === 'loading') return
        // idle: restart from the reader's current position.
        void start(driverRef.current && driverRef.current.restart ? driverRef.current.restart() : driverRef.current)
      }, [status, start])

      const stop = useCallback(() => {
        runRef.current += 1
        pausedRef.current = false
        const audio = audioRef.current
        if (audio !== null) {
          audio.pause()
          audio.onended = null
          audio.onerror = null
        }
        batchRef.current = null
        indexRef.current = 0
        driverRef.current = null
        setStatus('idle')
        // The caption deliberately survives: "stopped" still shows what was
        // being read, which is the only reliable position cue in paged mode.
      }, [])

      const clearCaption = useCallback(() => {
        setCaption('')
      }, [])

      // Moving by hand only moves the highlight: the audio stays quiet until the
      // reader presses play again. Automatic advance still goes through
      // playBatch, so continuous reading is unaffected.
      const step = useCallback((delta) => {
        const batch = batchRef.current
        if (batch === null) return
        const target = Math.max(0, Math.min(batch.length - 1, indexRef.current + delta))
        if (target === indexRef.current) return
        runRef.current += 1
        pausedRef.current = false
        const audio = audioRef.current
        if (audio !== null) audio.pause()
        indexRef.current = target
        setError('')
        setCaption(batch[target].text)
        setStatus('stopped')
        const item = batch[target]
        if (typeof item.enter === 'function') void Promise.resolve(item.enter()).catch(() => undefined)
      }, [])

      const activeVoiceLabel = (() => {
        if (settings === null) return ''
        const provider = resolveSpeechProvider(settings, providers, '')
        const list = (providers.find((item) => item.id === provider) || {}).voices || []
        const id = resolveSpeechVoice({ provider, voices: list, settings, language })
        const found = list.find((voice) => voice.id === id)
        if (found) return `${found.name || found.id} · ${speechLanguageName(found.lang)}`
        return id
      })()

      const saveSettings = useCallback(async (patch, secretPatch) => {
        const body = { settings: patch }
        if (secretPatch && Object.keys(secretPatch).length > 0) body.secrets = secretPatch
        const payload = await requestJson(base, '/tts/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (payload && payload.settings) applySettings(payload.settings)
        return payload
      }, [base, applySettings])

      const refresh = useCallback(async () => {
        try {
          const payload = await requestJson(base, '/tts/capabilities')
          setProviders(Array.isArray(payload.providers) ? payload.providers : [])
          setSecrets(payload.secrets && typeof payload.secrets === 'object' ? payload.secrets : {})
          applySettings(payload.settings || settingsRef.current)
        } catch {
          // Keep the previous list when the service is briefly unavailable.
        }
      }, [applySettings])

      return {
        status, caption, error, settings, providers, secrets,
        activeVoiceLabel, unlock, setLanguage, start, preview, speakText, toggle, stop, clearCaption, prev: () => step(-1), next: () => step(1),
        saveSettings, refresh, applySettings,
        running: status === 'playing' || status === 'paused' || status === 'loading',
      }
    }

    // ----- [ui:speech] -----
    // Provider presets, voice picker, TTS settings fields and the caption bar.

    // Shared read-aloud settings fields: the in-reader panel and the shelf
    // settings window render the same controls from the same draft shape.
    const OPENAI_TTS_PRESETS = [
      { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'anna', format: 'mp3' },
      { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'tts-1', voice: 'alloy', format: 'mp3' },
      { id: 'kokoro', label: '本地 Kokoro (localhost:8880)', baseUrl: 'http://127.0.0.1:8880/v1', model: 'kokoro', voice: 'af_heart', format: 'mp3' },
    ]

    function speechLanguageCode(value) {
      return String(value || '').trim().toLowerCase().replace(/_/g, '-')
    }

    function speechLanguageName(code) {
      const value = String(code || '').trim()
      if (value === '') return '全部语言'
      if (value === '*') return '通用'
      try {
        return new Intl.DisplayNames([navigator.language || 'zh-CN'], { type: 'language' }).of(value.replace(/_/g, '-')) || value
      } catch {
        return value
      }
    }

    // Language-aware voice choice used by playback and by the settings preview.
    function pickVoiceForLanguage(voices, language) {
      if (!Array.isArray(voices) || voices.length === 0) return ''
      const target = speechLanguageCode(language)
      if (target === '') return ''
      const exact = voices.find((voice) => speechLanguageCode(voice.lang) === target)
      if (exact) return exact.id
      const family = target.split('-')[0]
      const sameFamily = voices.find((voice) => speechLanguageCode(voice.lang).split('-')[0] === family)
      if (sameFamily) return sameFamily.id
      if (family === 'zh') {
        const chinese = voices.find((voice) => speechLanguageCode(voice.lang).startsWith('zh'))
        if (chinese) return chinese.id
      }
      return ''
    }

    function resolveSpeechProvider(settings, providers, defaultProvider) {
      if (!settings) return 'macos'
      const entry = (providers || []).find((item) => item.id === settings.provider)
      if (entry && entry.available !== false) return settings.provider
      if (typeof defaultProvider === 'string' && defaultProvider !== '') return defaultProvider
      const fallback = (providers || []).find((item) => item.available !== false)
      return fallback ? fallback.id : settings.provider
    }

    function resolveSpeechVoice({ provider, voices, settings, language }) {
      if (!settings) return ''
      if (provider === 'deepseek') return settings.deepseek && settings.deepseek.voice ? settings.deepseek.voice : 'stella'
      if (provider === 'openai') return settings.openai && settings.openai.voice ? settings.openai.voice : ''
      if (provider === 'local') return settings.local && settings.local.voice ? settings.local.voice : ''
      if (!settings.autoVoice) {
        if (settings.voice) return settings.voice
        if (provider === 'edge' && settings.edge && settings.edge.voice) return settings.edge.voice
        return ''
      }
      const picked = pickVoiceForLanguage(voices, language)
      if (picked !== '') return picked
      if (settings.voice) return settings.voice
      if (provider === 'edge' && settings.edge && settings.edge.voice) return settings.edge.voice
      const list = Array.isArray(voices) ? voices : []
      return list.length > 0 ? list[0].id : ''
    }

    function VoiceSelect({ t, provider, voices, value, defaultVoice, onChange }) {
      const [language, setLanguage] = useState('')
      const languages = [...new Set((voices || []).map((voice) => speechLanguageCode(voice.lang)).filter((code) => code !== ''))].sort()
      const visible = languages.length === 0
        ? (voices || [])
        : (voices || []).filter((voice) => language === '' || speechLanguageCode(voice.lang) === language)
      const ordered = visible.slice().sort((left, right) => {
        const leftLang = speechLanguageCode(left.lang)
        const rightLang = speechLanguageCode(right.lang)
        if (leftLang !== rightLang) return leftLang < rightLang ? -1 : 1
        return String(left.name || left.id) < String(right.name || right.id) ? -1 : 1
      })
      const fallback = defaultVoice || (ordered.length > 0 ? ordered[0].id : value)
      // Empty value means "follow the book language", so it must survive even
      // when the filtered list would otherwise fall back to its first voice.
      const current = value === '' ? '' : ordered.some((voice) => voice.id === value) ? value : fallback
      const describe = (voice) => `${voice.name || voice.id} · ${speechLanguageName(voice.lang)}`
      return h(
        React.Fragment,
        null,
        languages.length > 1
          ? h(
              'label',
              { className: 'bs-tts-field' },
              h('span', null, t('ttsLanguage')),
              h('select', {
                className: 'bs-tts-select',
                value: language,
                'aria-label': 'ttsLanguage',
                onChange: (event) => setLanguage(event.target.value),
              }, [h('option', { key: 'all', value: '' }, t('ttsAllLanguages'))].concat(
                languages.map((code) => h('option', { key: code, value: code }, speechLanguageName(code))),
              )),
            )
          : null,
        h(
          'label',
          { className: 'bs-tts-field' },
          h('span', null, t('ttsVoice')),
          h('select', {
            className: 'bs-tts-select',
            value: current,
            'aria-label': 'ttsVoice',
            onChange: (event) => onChange(event.target.value),
          }, [
            h('option', { key: 'auto', value: '' }, t('ttsVoiceAuto')),
          ].concat(ordered.length === 0
            ? [h('option', { key: 'loading', value: '__none__', disabled: true }, t('ttsVoicesLoading'))]
            : ordered.map((voice) => h('option', { key: voice.id, value: voice.id }, describe(voice))))),
        ),
      )
    }

    function TtsConfigFields({ t, providers, secrets, draft, onChange }) {
      const provider = providers.find((item) => item.id === draft.provider)
      const voices = provider ? provider.voices || [] : []
      return h(
        React.Fragment,
        null,
        h(
          'label',
          { className: 'bs-tts-field' },
          h('span', null, t('ttsProvider')),
          h('select', {
            className: 'bs-tts-select',
            value: draft.provider,
            'aria-label': 'ttsProvider',
            onChange: (event) => {
              const id = event.target.value
              const next = { ...draft, provider: id }
              const providerVoices = providers.find((item) => item.id === id)?.voices || []
              if ((id === 'macos' || id === 'windows') && !next.autoVoice && providerVoices.length > 0 && !providerVoices.some((voice) => voice.id === next.voice)) {
                next.voice = providerVoices[0].id
              }
              if (id === 'edge' && !next.autoVoice && providerVoices.length > 0 && !providerVoices.some((voice) => voice.id === next.edge.voice)) {
                next.edge = { ...next.edge, voice: providerVoices[0].id }
              }
              if (id === 'deepseek') next.deepseek = { ...next.deepseek, voice: 'stella' }
              onChange(next)
            },
          }, providers.map((item) => h('option', {
            key: item.id, value: item.id, disabled: item.available === false,
          }, `${item.label}${item.available === false
            ? `（${t('ttsUnavailableHere')}）`
            : item.configured ? '' : `（${t('ttsNotConfigured')}）`}`))),
        ),
        (draft.provider === 'macos' || draft.provider === 'windows')
          ? h(VoiceSelect, {
              t,
              provider: draft.provider,
              voices,
              value: draft.autoVoice ? '' : draft.voice,
              defaultVoice: voices.length > 0 ? voices[0].id : '',
              onChange: (value) => onChange({ ...draft, voice: value, autoVoice: value === '' }),
            })
          : null,
        draft.provider === 'macos' || draft.provider === 'windows'
          ? h('p', { className: 'bs-settings-hint' }, draft.autoVoice ? t('ttsVoiceAutoHint') : t('ttsMacosVoiceHint'))
          : null,
        draft.provider === 'edge'
          ? h(
              React.Fragment,
              null,
              h(VoiceSelect, {
                t,
                provider: 'edge',
                voices,
                value: draft.autoVoice ? '' : draft.edge.voice,
                defaultVoice: voices.length > 0 ? voices[0].id : '',
                onChange: (value) => onChange({ ...draft, edge: { ...draft.edge, voice: value }, autoVoice: value === '' }),
              }),
              h('p', { className: 'bs-settings-hint' }, draft.autoVoice ? t('ttsVoiceAutoHint') : t('ttsEdgeHint')),
              h('p', { className: 'bs-settings-hint' }, t('ttsEdgeNote')),
            )
          : null,
        draft.provider === 'deepseek'
          ? h(
              React.Fragment,
              null,
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsVoice')),
                h('select', {
                  className: 'bs-tts-select',
                  value: draft.deepseek.voice,
                  onChange: (event) => onChange({ ...draft, deepseek: { ...draft.deepseek, voice: event.target.value } }),
                }, (providers.find((item) => item.id === 'deepseek')?.voices || []).map((voice) => h('option', { key: voice.id, value: voice.id }, voice.label))),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, secrets.deepseek ? t('ttsKeySet') : t('ttsKeyLabel')),
                h('input', {
                  type: 'password', className: 'bs-tts-input', value: draft.deepseekKey,
                  placeholder: secrets.deepseek ? '••••••••' : 'sk-…',
                  onChange: (event) => onChange({ ...draft, deepseekKey: event.target.value }),
                }),
              ),
            )
          : null,
        draft.provider === 'openai'
          ? h(
              React.Fragment,
              null,
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsPreset')),
                h('select', {
                  className: 'bs-tts-select',
                  value: '',
                  'aria-label': 'ttsPreset',
                  onChange: (event) => {
                    const preset = OPENAI_TTS_PRESETS.find((item) => item.id === event.target.value)
                    if (!preset) return
                    onChange({
                      ...draft,
                      voice: preset.voice,
                      openai: { ...draft.openai, baseUrl: preset.baseUrl, model: preset.model, voice: preset.voice, format: preset.format },
                    })
                  },
                }, [h('option', { key: 'none', value: '' }, t('ttsPresetChoose'))].concat(
                  OPENAI_TTS_PRESETS.map((preset) => h('option', { key: preset.id, value: preset.id }, preset.label)),
                )),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsBaseUrl')),
                h('input', {
                  type: 'url', className: 'bs-tts-input', value: draft.openai.baseUrl,
                  placeholder: 'https://api.siliconflow.cn/v1',
                  onChange: (event) => onChange({ ...draft, openai: { ...draft.openai, baseUrl: event.target.value } }),
                }),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsModel')),
                h('input', {
                  type: 'text', className: 'bs-tts-input', value: draft.openai.model,
                  placeholder: 'FunAudioLLM/CosyVoice2-0.5B',
                  onChange: (event) => onChange({ ...draft, openai: { ...draft.openai, model: event.target.value } }),
                }),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsVoice')),
                h('input', {
                  type: 'text', className: 'bs-tts-input', value: draft.openai.voice,
                  placeholder: 'anna',
                  onChange: (event) => onChange({ ...draft, openai: { ...draft.openai, voice: event.target.value } }),
                }),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, secrets.openai ? t('ttsKeySet') : t('ttsKeyLabel')),
                h('input', {
                  type: 'password', className: 'bs-tts-input', value: draft.openaiKey,
                  placeholder: secrets.openai ? '••••••••' : 'sk-…',
                  onChange: (event) => onChange({ ...draft, openaiKey: event.target.value }),
                }),
              ),
            )
          : null,
        draft.provider === 'local'
          ? h(
              React.Fragment,
              null,
              h('p', { className: 'bs-settings-hint' }, t('ttsLocalHint')),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsLocalEndpoint')),
                h('input', {
                  type: 'text', className: 'bs-tts-input', value: draft.local.endpoint,
                  placeholder: 'http://127.0.0.1:8000',
                  onChange: (event) => onChange({ ...draft, local: { ...draft.local, endpoint: event.target.value } }),
                }),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsLocalModel')),
                h('input', {
                  type: 'text', className: 'bs-tts-input', value: draft.local.model,
                  placeholder: 'piper / kokoro / xtts',
                  onChange: (event) => onChange({ ...draft, local: { ...draft.local, model: event.target.value } }),
                }),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsLocalVoice')),
                h('input', {
                  type: 'text', className: 'bs-tts-input', value: draft.local.voice,
                  placeholder: 'default',
                  onChange: (event) => onChange({ ...draft, local: { ...draft.local, voice: event.target.value } }),
                }),
              ),
              h(
                'label',
                { className: 'bs-tts-field' },
                h('span', null, t('ttsLocalDevice')),
                h('select', {
                  className: 'bs-tts-select',
                  value: draft.local.device,
                  onChange: (event) => onChange({ ...draft, local: { ...draft.local, device: event.target.value } }),
                }, [h('option', { key: 'cpu', value: 'cpu' }, 'CPU'), h('option', { key: 'gpu', value: 'gpu' }, 'GPU')]),
              ),
            )
          : null,
        h(
          'label',
          { className: 'bs-tts-field' },
          h('span', null, t('ttsSpeed')),
          h('select', {
            className: 'bs-tts-select',
            value: String(draft.speed),
            'aria-label': 'ttsSpeed',
            onChange: (event) => onChange({ ...draft, speed: Number(event.target.value) }),
          }, [0.75, 1, 1.25, 1.5, 2].map((value) => h('option', { key: value, value: String(value) }, `${value}×`))),
        ),
      )
    }

    function ttsDraftFrom(settings) {
      return {
        provider: settings ? settings.provider : 'macos',
        voice: settings ? settings.voice : '',
        speed: settings ? settings.speed : 1,
        autoVoice: settings ? settings.autoVoice !== false : true,
        openai: settings && settings.openai ? { ...settings.openai } : { baseUrl: '', model: '', voice: '', format: 'mp3' },
        deepseek: settings && settings.deepseek ? { ...settings.deepseek } : { voice: 'stella' },
        edge: settings && settings.edge ? { ...settings.edge } : { voice: '', pitch: 0 },
        local: settings && settings.local
          ? { ...settings.local }
          : { endpoint: '', model: '', voice: '', device: 'cpu' },
        deepseekKey: '',
        openaiKey: '',
      }
    }

    function ttsDraftVoice(draft) {
      if (draft.provider === 'macos') return draft.voice
      if (draft.provider === 'deepseek') return draft.deepseek.voice
      if (draft.provider === 'edge') return draft.edge.voice
      if (draft.provider === 'local') return draft.local.voice
      return draft.openai.voice
    }

    function ttsSettingsPatch(draft, settings) {
      const patch = {
        provider: draft.provider,
        speed: draft.speed,
        autoVoice: draft.autoVoice !== false,
        autoPageTurn: settings ? settings.autoPageTurn : true,
        openai: draft.provider === 'openai' ? draft.openai : settings && settings.openai ? settings.openai : draft.openai,
        deepseek: draft.provider === 'deepseek' ? draft.deepseek : settings && settings.deepseek ? settings.deepseek : draft.deepseek,
        edge: draft.provider === 'edge' ? draft.edge : settings && settings.edge ? settings.edge : draft.edge,
        local: draft.local ? draft.local : settings && settings.local ? settings.local : draft.local,
      }
      if (draft.provider === 'macos') patch.voice = draft.voice
      else if (draft.provider === 'deepseek') patch.voice = draft.deepseek.voice
      else if (draft.provider === 'openai') patch.voice = draft.openai.voice
      else if (draft.provider === 'edge') patch.voice = draft.edge.voice
      else if (draft.provider === 'local') patch.voice = draft.local.voice
      else patch.voice = settings ? settings.voice : ''
      return patch
    }

    function ttsSecretsPatch(draft) {
      const secrets = {}
      if (typeof draft.deepseekKey === 'string' && draft.deepseekKey.trim() !== '') secrets.deepseek = draft.deepseekKey.trim()
      if (typeof draft.openaiKey === 'string' && draft.openaiKey.trim() !== '') secrets.openai = draft.openaiKey.trim()
      return secrets
    }

    // Floating preview card showing the sentence read-aloud is on, or the last
    // one it stopped at. It stays for EPUB as well: the in-page glass band marks
    // the exact words, while the card keeps a readable copy and a position cue.
    function ReaderSpeechCaption({ t, caption, status, onDismiss }) {
      const live = status === 'playing' || status === 'paused' || status === 'loading'
      return h(
        'div',
        { className: 'bs-tts-caption', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { className: 'bs-tts-caption-head' },
          h('span', { className: 'bs-tts-caption-label' }, live ? t('ttsCaptionNow') : t('ttsCaptionLast')),
          h('button', {
            type: 'button',
            className: 'bs-tts-caption-close',
            onClick: onDismiss,
            title: t('ttsHideText'),
            'aria-label': t('ttsHideText'),
          }, h(CloseIcon, { size: 12 })),
        ),
        h('div', { className: 'bs-tts-caption-text' }, caption),
      )
    }

    // Reader-owned menu for a text selection: the desktop menu only offers Copy,
    // so the reader adds citation copy, reading the selection and the two
    // annotation actions. The annotation actions are disabled when the selection
    // could not be anchored to the chapter text (fromSelection would return
    // null); they never throw inside the event handler.
    function SelectionMenu({ t, menu, onClose, onCopy, onCopyCite, onSpeak, onHighlight, onUnderline, canAnnotate }) {
      const ref = useRef(null)
      useEffect(() => {
        const node = ref.current
        if (node !== null && typeof node.focus === 'function') node.focus({ preventScroll: true })
      }, [])
      // The menu opens at the pointer, so it must be nudged back inside the
      // reading area instead of being cut off at the right or bottom edge.
      useLayoutEffect(() => {
        const node = ref.current
        if (node === null) return
        const parent = node.offsetParent
        if (parent === null) return
        const maxLeft = Math.max(8, parent.clientWidth - node.offsetWidth - 8)
        const maxTop = Math.max(8, parent.clientHeight - node.offsetHeight - 8)
        node.style.left = `${Math.min(Math.max(8, menu.x), maxLeft)}px`
        node.style.top = `${Math.min(Math.max(8, menu.y), maxTop)}px`
      }, [menu.x, menu.y])
      const item = (label, action, disabled = false) => h('button', {
        type: 'button',
        className: 'bs-selection-item',
        role: 'menuitem',
        disabled: disabled === true,
        onClick: () => {
          if (disabled === true) return
          action()
          onClose()
        },
      }, label)
      return h(
        'div',
        {
          ref,
          className: 'bs-selection-menu',
          role: 'menu',
          'aria-label': t('selectionMenuLabel'),
          tabIndex: -1,
          style: { left: `${menu.x}px`, top: `${menu.y}px` },
          onContextMenu: (event) => event.preventDefault(),
        },
        h('div', { className: 'bs-selection-preview' }, menu.text),
        item(t('selectionCopy'), onCopy),
        item(t('selectionCopyCite'), onCopyCite),
        h('div', { className: 'bs-selection-divider' }),
        item(t('selectionSpeak'), onSpeak),
        h('div', { className: 'bs-selection-divider' }),
        item(t('selectionHighlight'), onHighlight, canAnnotate !== true),
        item(t('selectionUnderline'), onUnderline, canAnnotate !== true),
      )
    }

    function ReadAloudBar({ t, readAloud, audiobook, onClose, onStart }) {
      const [voiceOpen, setVoiceOpen] = useState(false)
      const [fileConfirm, setFileConfirm] = useState(false)
      const settings = readAloud.settings
      const provider = readAloud.providers.find((item) => item.id === (settings ? settings.provider : ''))
      const speed = settings ? settings.speed : 1
      const status = readAloud.status
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const [saveError, setSaveError] = useState('')

      const refreshRef = useRef(readAloud.refresh)
      useEffect(() => {
        refreshRef.current = readAloud.refresh
      }, [readAloud.refresh])
      // Initialise once per opening. Depending on the whole controller (a new
      // object each render) used to reset the form on every keystroke, so every
      // change snapped back to the saved settings.
      useEffect(() => {
        if (!voiceOpen) return
        setSaveError('')
        setDraft((current) => (current === null ? ttsDraftFrom(settings) : current))
      }, [voiceOpen, settings])
      useEffect(() => {
        if (voiceOpen) refreshRef.current()
        else setDraft(null)
      }, [voiceOpen])

      if (settings === null) {
        return h('div', { className: 'bs-tts-dock', role: 'toolbar', 'aria-label': t('readAloud') },
          h(Spinner, { small: true }),
          h('span', { className: 'bs-tts-status' }, t('ttsLoading')),
          h('button', { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') }, h(CloseIcon)),
        )
      }

      const save = async () => {
        if (draft === null || saving) return
        setSaving(true)
        setSaveError('')
        try {
          await readAloud.saveSettings(ttsSettingsPatch(draft, settings), ttsSecretsPatch(draft))
          await readAloud.refresh()
          setVoiceOpen(false)
        } catch (failure) {
          setSaveError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }

      const label = provider ? provider.label : (settings.provider || '')
      const statusText = status === 'error'
        ? t('ttsFailed') + ': ' + readAloud.error
        : status === 'loading'
          ? t('ttsLoading')
          : status === 'playing'
            ? t('ttsPlaying')
            : status === 'paused'
              ? t('ttsPaused')
              : readAloud.caption !== '' ? t('ttsStopped') : t('ttsIdle')
      const panels = []
      if (audiobook && audiobook.info !== null) {
        panels.push(h('div', { className: 'bs-tts-file', key: 'audiobook' },
          audiobook.status === 'playing' || audiobook.status === 'paused'
            ? h(React.Fragment, null,
                h('div', { className: 'bs-tts-controls' },
                  h('button', {
                    type: 'button', className: 'bs-icon-button',
                    onClick: () => {
                      if (audiobook.status === 'playing') audiobook.pause()
                      else void audiobook.play()
                    },
                    title: audiobook.status === 'playing' ? t('ttsPause') : t('ttsPlay'),
                    'aria-label': audiobook.status === 'playing' ? t('ttsPause') : t('ttsPlay'),
                  }, audiobook.status === 'playing' ? h(PauseIcon) : h(PlayIcon)),
                  h('span', { className: 'bs-tts-file-time' },
                    formatDuration(audiobook.current) + ' / ' + formatDuration(audiobook.duration || audiobook.info.seconds || 0)),
                  h('button', {
                    type: 'button', className: 'bs-icon-button', onClick: () => audiobook.stop(),
                    title: t('audiobookStop'), 'aria-label': t('audiobookStop'),
                  }, h(CloseIcon)),
                ),
                h('p', { className: 'bs-tts-file-hint' }, t('audiobookFileHint')),
                audiobook.error !== '' ? h('p', { className: 'bs-tts-file-hint bs-tts-error' }, audiobook.error) : null,
              )
            : fileConfirm
              ? h(React.Fragment, null,
                  h('p', { className: 'bs-tts-file-hint' },
                    t('audiobookUseConfirm', {
                      seconds: formatDuration(audiobook.info.seconds || 0),
                      size: formatBytes(audiobook.info.bytes || 0),
                    })),
                  h('div', { className: 'bs-tts-controls' },
                    h('button', { type: 'button', className: 'bs-button', onClick: () => setFileConfirm(false) }, t('cancel')),
                    h('button', {
                      type: 'button', className: 'bs-button bs-button-primary',
                      onClick: () => {
                        setFileConfirm(false)
                        readAloud.stop()
                        void audiobook.play()
                      },
                    }, t('audiobookUseConfirmAction')),
                  ),
                )
              : h('button', {
                  type: 'button', className: 'bs-button bs-tts-file-open',
                  onClick: () => setFileConfirm(true),
                }, t('audiobookUseExisting', {
                  seconds: formatDuration(audiobook.info.seconds || 0),
                  size: formatBytes(audiobook.info.bytes || 0),
                })),
        ))
      }
      if (voiceOpen && draft !== null) {
        panels.push(h('div', { className: 'bs-tts-settings', key: 'voice', role: 'dialog', 'aria-label': t('ttsVoice') },
          h(TtsConfigFields, { t, providers: readAloud.providers, secrets: readAloud.secrets, draft, onChange: setDraft }),
          saveError !== '' ? h('p', { className: 'bs-tts-error' }, saveError) : null,
          h('div', { className: 'bs-tts-actions' },
            h('button', { type: 'button', className: 'bs-button', onClick: () => setVoiceOpen(false), disabled: saving }, t('cancel')),
            h('button', { type: 'button', className: 'bs-button bs-button-primary', onClick: save, disabled: saving }, saving ? t('saving') : t('save')),
          ),
        ))
      }
      return h(
        React.Fragment,
        null,
        panels.length > 0 ? h('div', { className: 'bs-tts-panels' }, panels) : null,
        h(
          'div',
          { className: 'bs-tts-dock', role: 'toolbar', 'aria-label': t('readAloud') },
          h('button', {
            type: 'button', className: 'bs-icon-button',
            onClick: () => {
              if (audiobook && audiobook.running) audiobook.stop()
              if (status === 'idle') {
                // This click is the gesture that permits later programmatic playback.
                readAloud.unlock()
                if (typeof onStart === 'function') onStart()
                return
              }
              readAloud.toggle()
            },
            title: status === 'playing' ? t('ttsPause') : t('ttsPlay'),
            'aria-label': status === 'playing' ? t('ttsPause') : t('ttsPlay'),
          }, status === 'playing' ? h(PauseIcon) : h(PlayIcon)),
          h('button', {
            type: 'button', className: 'bs-icon-button', onClick: readAloud.prev,
            title: t('ttsPrevious'), 'aria-label': t('ttsPrevious'),
          }, h(ChevronLeftIcon, { size: 15 })),
          h('button', {
            type: 'button', className: 'bs-icon-button', onClick: readAloud.next,
            title: t('ttsNext'), 'aria-label': t('ttsNext'),
          }, h(ChevronRightIcon, { size: 15 })),
          h('span', { className: 'bs-tts-status', title: statusText }, statusText),
          h(
            'label',
            { className: 'bs-tts-speed' },
            h('span', null, t('ttsSpeed')),
            h('select', {
              className: 'bs-tts-select',
              value: String(speed),
              'aria-label': t('ttsSpeed'),
              onChange: (event) => { void readAloud.saveSettings({ speed: Number(event.target.value) }) },
            }, [0.75, 1, 1.25, 1.5, 2].map((value) => h('option', { key: value, value: String(value) }, value + '×'))),
          ),
          h('button', {
            type: 'button', className: 'bs-button bs-tts-voice', onClick: () => setVoiceOpen((value) => !value),
            title: readAloud.activeVoiceLabel !== '' ? label + ' · ' + readAloud.activeVoiceLabel : t('ttsVoice'),
            'aria-label': t('ttsVoice'),
            'aria-expanded': voiceOpen,
          }, label),
          h('button', { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') }, h(CloseIcon)),
        ),
      )
    }

    // ----- [ui:dialogs] -----
    // Shelf settings dialog (reading/speech/other tabs) and the audiobook file
    // loader that follows it.

    // The shelf settings used to be a popover; it now opens as a window with
    // tabs because reading, read-aloud and workspace options no longer fit.
    function ShelfSettingsDialog({
      t, base, onClose, defaults, onDefaultsChange, workspaces, discussionWorkspace,
      onDiscussionWorkspaceChange, appleBooksAvailable, appleBooksEnabled, onAppleBooksEnabledChange,
      initialTab = 'reading',
    }) {
      const [tab, setTab] = useState(initialTab === 'speech' ? 'speech' : 'reading')
      const [panel, setPanel] = useState(null)
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [cache, setCache] = useState(null)
      const workspaceChoices = Array.isArray(workspaces) ? workspaces.filter((item) => item && typeof item.workspaceId === 'string') : null
      const selectedWorkspace = workspaceChoices !== null && workspaceChoices.some((item) => item.workspaceId === discussionWorkspace) ? discussionWorkspace : ''

      useEffect(() => {
        let cancelled = false
        requestJson(base, '/tts/capabilities')
          .then((payload) => {
            if (cancelled) return
            setPanel({ settings: payload.settings || null, providers: payload.providers || [], secrets: payload.secrets || {} })
            setDraft(ttsDraftFrom(payload.settings || null))
            setCache(payload.cache || null)
          })
          .catch(() => { if (!cancelled) setDraft(ttsDraftFrom(null)) })
        return () => { cancelled = true }
      }, [base])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || saving) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose, saving])

      const saveSpeech = async () => {
        if (draft === null || saving) return
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const payload = await requestJson(base, '/tts/settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ settings: ttsSettingsPatch(draft, panel ? panel.settings : null), secrets: ttsSecretsPatch(draft) }),
          })
          if (payload && payload.settings) {
            setPanel({ settings: payload.settings, providers: panel ? panel.providers : [], secrets: panel ? panel.secrets : {} })
            setDraft(ttsDraftFrom(payload.settings))
            // Key flags live on the capabilities route; refresh them so the
            // dialog shows that a pasted key is now stored.
            try {
              const capabilities = await requestJson(base, '/tts/capabilities')
              setPanel({ settings: capabilities.settings || payload.settings, providers: capabilities.providers || [], secrets: capabilities.secrets || {} })
            } catch {
              // Keep the saved settings even if the refresh fails.
            }
          }
          setNotice(t('settingsSaved'))
        } catch (failure) {
          setError(t('ttsSaveFailed', { message: failure instanceof Error ? failure.message : String(failure) }))
        } finally {
          setSaving(false)
        }
      }

      const testSpeech = async () => {
        if (draft === null || saving) return
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), TTS_TEST_TIMEOUT_MS)
          try {
            await requestJson(base, '/tts/synthesize', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                provider: draft.provider,
                voice: ttsDraftVoice(draft),
                speed: draft.speed,
                text: t('ttsTestText'),
              }),
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timer)
          }
          setNotice(t('ttsTestOk'))
        } catch (failure) {
          const message = isTimeoutFailure(failure) ? t('ttsTimeout') : failure instanceof Error ? failure.message : String(failure)
          setError(t('ttsTestFailed', { message }))
        } finally {
          setSaving(false)
        }
      }

      const clearCache = async () => {
        try {
          await requestJson(base, '/tts/cache', { method: 'DELETE' })
          setCache({ entries: 0, bytes: 0 })
          setNotice(t('ttsCacheCleared'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }

      const tabs = [
        ['reading', t('settingsTabReading')],
        ['speech', t('settingsTabSpeech')],
        ['other', t('settingsTabOther')],
      ]

      const body = tab === 'reading'
        ? h(ReadingSettingsFields, { t, settings: defaults, onChange: onDefaultsChange, includeExtras: false })
        : tab === 'speech'
          ? h(
              React.Fragment,
              null,
              draft === null || panel === null
                ? h('p', { className: 'bs-settings-hint' }, t('ttsLoading'))
                : h(TtsConfigFields, { t, providers: panel.providers, secrets: panel.secrets, draft, onChange: setDraft }),
              h(
                'div',
                { className: 'bs-settings-cache' },
                h('span', null, cache === null
                  ? t('ttsCacheTitle')
                  : t('ttsCacheStats', { count: cache.entries, size: formatBytes(cache.bytes) || '0 B' })),
                h('button', { type: 'button', className: 'bs-button', onClick: clearCache, disabled: cache === null || cache.entries === 0 }, t('ttsCacheClear')),
              ),
              error !== '' ? h('p', { className: 'bs-rename-error', role: 'alert' }, error) : null,
              notice !== '' ? h('p', { className: 'bs-settings-notice', role: 'status' }, notice) : null,
            )
          : h(
              React.Fragment,
              null,
              workspaceChoices !== null && typeof onDiscussionWorkspaceChange === 'function'
                ? h(
                    'div',
                    { className: 'bs-setting-row' },
                    h('span', { className: 'bs-setting-label' }, t('discussionWorkspaceSetting')),
                    h(
                      'select',
                      {
                        className: 'bs-setting-select',
                        value: selectedWorkspace,
                        'aria-label': t('discussionWorkspaceSetting'),
                        onChange: (event) => onDiscussionWorkspaceChange(event.target.value),
                      },
                      h('option', { value: '' }, t('discussionWorkspaceAsk')),
                      workspaceChoices.map((item) => h('option', { key: item.workspaceId, value: item.workspaceId }, item.title || item.path || item.workspaceId)),
                    ),
                    h('p', { className: 'bs-settings-hint' }, t('discussionWorkspaceSettingHint')),
                  )
                : null,
              appleBooksAvailable === true && typeof onAppleBooksEnabledChange === 'function'
                ? h(
                    'div',
                    { className: 'bs-setting-row' },
                    h(
                      'label',
                      { className: 'bs-setting-toggle' },
                      h('input', {
                        type: 'checkbox',
                        checked: Boolean(appleBooksEnabled),
                        onChange: (event) => onAppleBooksEnabledChange(event.target.checked),
                      }),
                      h('span', null, t('appleBooksImportToggle')),
                    ),
                    h('p', { className: 'bs-settings-hint' }, t('appleBooksImportToggleHint')),
                  )
                : null,
              h('p', { className: 'bs-settings-hint' }, t('settingsOtherHint')),
            )

      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: saving ? undefined : onClose }),
        h(
          'div',
          {
            className: 'bs-apple-dialog bs-settings-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('settingsTitle'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('settingsTitle')),
              h('p', { className: 'bs-apple-hint' }, t('settingsHint')),
            ),
            h(
              'button',
              { type: 'button', className: 'bs-icon-button', onClick: onClose, disabled: saving, title: t('dismiss'), 'aria-label': t('dismiss') },
              h(CloseIcon),
            ),
          ),
          h(
            'div',
            { className: 'bs-settings-tabs', role: 'tablist' },
            tabs.map(([key, label]) => h(
              'button',
              {
                key,
                type: 'button',
                role: 'tab',
                className: 'bs-settings-tab',
                'aria-selected': tab === key,
                onClick: () => { setNotice(''); setError('') ; setTab(key) },
              },
              label,
            )),
          ),
          h('div', { className: 'bs-settings-body' }, body),
          h(
            'div',
            { className: 'bs-apple-foot bs-settings-foot' },
            tab === 'speech'
              ? h(
                  'div',
                  { className: 'bs-settings-actions' },
                  h('button', { type: 'button', className: 'bs-button', onClick: onClose, disabled: saving }, t('done')),
                  h('button', { type: 'button', className: 'bs-button', onClick: testSpeech, disabled: saving || draft === null }, t('ttsTest')),
                  h('button', { type: 'button', className: 'bs-button bs-button-primary', onClick: saveSpeech, disabled: saving || draft === null }, saving ? t('saving') : t('settingsSaveSpeech')),
                )
              : h('button', { type: 'button', className: 'bs-button bs-button-primary', onClick: onClose }, t('done')),
          ),
        ),
      )
    }

    // Plays the whole-book WAV rendered from the shelf menu. It is a single
    // file, so it has no sentence captions and never follows the page; the
    // reader keeps that mode separate from live read-aloud on purpose.
    function useAudiobookFile({ base, book }) {
      const [info, setInfo] = useState(null)
      const [status, setStatus] = useState('idle')
      const [current, setCurrent] = useState(0)
      const [duration, setDuration] = useState(0)
      const [error, setError] = useState('')
      const audioRef = useRef(null)
      const aliveRef = useRef(true)
      const url = resourceUrl(base, `${API_ROOT}/books/${book.id}/audio/file`)

      const refresh = useCallback(async () => {
        try {
          const payload = await requestJson(base, `/books/${book.id}/audio`)
          if (!aliveRef.current) return
          setInfo(payload.state && payload.state.audio ? payload.state.audio : null)
        } catch {
          // No generated audio is a normal state, not an error.
        }
      }, [base, book.id])

      useEffect(() => {
        aliveRef.current = true
        void refresh()
        return () => { aliveRef.current = false }
      }, [refresh])

      const element = useCallback(() => {
        if (audioRef.current === null) {
          const node = new Audio(url)
          node.preload = 'metadata'
          node.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(node.duration) && node.duration > 0) setDuration(node.duration)
          })
          node.addEventListener('timeupdate', () => setCurrent(node.currentTime || 0))
          node.addEventListener('ended', () => { setCurrent(0); setStatus('idle') })
          node.addEventListener('playing', () => { setError(''); setStatus('playing') })
          node.addEventListener('pause', () => setStatus((value) => (value === 'playing' ? 'paused' : value)))
          node.addEventListener('error', () => {
            setStatus('idle')
            setError('audio playback failed')
          })
          audioRef.current = node
        }
        return audioRef.current
      }, [url])

      const play = useCallback(async () => {
        try {
          const node = element()
          await node.play()
          if (aliveRef.current) setStatus('playing')
        } catch (failure) {
          if (!aliveRef.current) return
          setError(failure instanceof Error ? failure.message : String(failure))
          setStatus('idle')
        }
      }, [element])

      const pause = useCallback(() => {
        if (audioRef.current !== null) audioRef.current.pause()
      }, [])

      const stop = useCallback(() => {
        const node = audioRef.current
        if (node !== null) {
          node.pause()
          try { node.currentTime = 0 } catch { /* not seekable yet */ }
        }
        setCurrent(0)
        setStatus('idle')
      }, [])

      useEffect(() => () => {
        const node = audioRef.current
        if (node !== null) {
          node.pause()
          node.removeAttribute('src')
          try { node.load() } catch { /* detached */ }
        }
      }, [])

      return {
        info,
        status,
        current,
        duration,
        error,
        refresh,
        play,
        pause,
        stop,
        running: status === 'playing' || status === 'paused',
      }
    }

    // ===== [chrome] =====
    // Reader shell: top bar, aside, read-aloud dock, selection menu and the
    // overlay chrome they open.

    function ReaderShell({ t, base, book, onBack, controls, children, state, progress, speech }) {
      const shellRef = useRef(null)
      const chromeRef = useRef(null)
      const [focusMode, setFocusMode] = useState(false)
      const [isFullscreen, setIsFullscreen] = useState(false)
      const [ttsOpen, setTtsOpen] = useState(false)
      const audiobook = useAudiobookFile({ base, book })

      useEffect(() => {
        if (ttsOpen) void audiobook.refresh()
      }, [ttsOpen, audiobook.refresh])

      // Opening the dock selects the current sentence right away: the highlight
      // and preview must not wait for the first audio request.
      const speechRef = useRef(null)
      useEffect(() => {
        speechRef.current = speech
      }, [speech])
      useEffect(() => {
        if (!ttsOpen || focusMode) return
        const current = speechRef.current
        if (!current || typeof current.preview !== 'function') return
        if (current.readAloud.running) return
        void current.preview()
      }, [ttsOpen, focusMode])

      useEffect(() => {
        if (focusMode) setTtsOpen(false)
      }, [focusMode])

      useEffect(() => {
        if (!ttsOpen) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          setTtsOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [ttsOpen])

      useEffect(() => {
        const onChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current)
        document.addEventListener('fullscreenchange', onChange)
        return () => document.removeEventListener('fullscreenchange', onChange)
      }, [])

      useEffect(() => {
        if (!focusMode) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          setFocusMode(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [focusMode])

      useEffect(() => {
        const shell = shellRef.current, chrome = chromeRef.current
        if (!shell || !chrome) return undefined
        const measure = () => {
          const top = Math.ceil(chrome.getBoundingClientRect().bottom - shell.getBoundingClientRect().top + 8)
          shell.style.setProperty('--bs-popover-top', `${top}px`)
        }
        measure()
        if (typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(measure)
        observer.observe(chrome)
        return () => observer.disconnect()
      }, [focusMode, isFullscreen])

      const toggleFullscreen = useCallback(() => {
        const node = shellRef.current
        if (node === null) return
        if (document.fullscreenElement !== null) {
          if (typeof document.exitFullscreen === 'function') document.exitFullscreen().catch(() => undefined)
          return
        }
        if (typeof node.requestFullscreen === 'function') node.requestFullscreen().catch(() => undefined)
      }, [])

      return h(
        'section',
        {
          ref: shellRef,
          className: focusMode ? 'bs-root bs-reader bs-reader-focus' : 'bs-root bs-reader',
          'data-focus-mode': focusMode ? 'true' : undefined,
          'aria-label': t('readerLabel', { title: book.title }),
        },
        h('style', { key: 'style' }, CSS),
        focusMode
          ? null
          : h(
              'header',
              { className: 'bs-reader-bar', ref: chromeRef },
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-icon-button',
                  onClick: () => onBack(progress ? progress.percent : null),
                  title: t('back'),
                  'aria-label': t('back'),
                  autoFocus: true,
                },
                h(ArrowLeftIcon),
              ),
              h(
                'div',
                { className: 'bs-reader-title-wrap' },
                h('div', { className: 'bs-reader-title', title: book.title }, book.title),
                h('div', { className: 'bs-reader-sub' }, state || [book.author || t('unknownAuthor'), String(book.format || '').toUpperCase(), formatBytes(book.bytes)].filter(Boolean).join(' · ')),
              ),
              h(
                'div',
                { className: 'bs-reader-controls' },
                controls,
                speech
                  ? h(
                      'button',
                      {
                        key: 'read-aloud',
                        type: 'button',
                        className: 'bs-icon-button',
                        onClick: () => setTtsOpen((value) => !value),
                        'aria-pressed': speech.readAloud.running || audiobook.running,
                        'aria-expanded': ttsOpen,
                        title: t('readAloud'),
                        'aria-label': t('readAloud'),
                      },
                      h(SpeechIcon),
                    )
                  : null,
                h('span', { key: 'shell-div', className: 'bs-divider' }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'bs-icon-button',
                    onClick: () => setFocusMode(true),
                    title: t('immersive'),
                    'aria-label': t('immersive'),
                  },
                  h(ImmersiveIcon),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'bs-icon-button',
                    onClick: toggleFullscreen,
                    'aria-pressed': isFullscreen,
                    title: isFullscreen ? t('exitFullscreen') : t('fullscreen'),
                    'aria-label': isFullscreen ? t('exitFullscreen') : t('fullscreen'),
                  },
                  isFullscreen ? h(MinimizeIcon) : h(FullscreenIcon),
                ),
                progress ? h('span', { className: 'bs-control-label bs-percent' }, `${Math.round(progress.percent * 100)}%`) : null,
              ),
            ),
        children,
        focusMode || !speech
          ? null
          : h(
              'div',
              { className: 'bs-tts-overlay', 'data-dock': ttsOpen ? 'open' : 'closed' },
              speech.readAloud.caption !== ''
                ? h(ReaderSpeechCaption, {
                    t,
                    caption: speech.readAloud.caption,
                    status: speech.readAloud.status,
                    onDismiss: speech.readAloud.clearCaption,
                  })
                : null,
              ttsOpen
                ? h(ReadAloudBar, {
                    t,
                    readAloud: speech.readAloud,
                    audiobook,
                    onStart: () => {
                      audiobook.stop()
                      speech.start()
                    },
                    onClose: () => {
                      speech.readAloud.stop()
                      audiobook.stop()
                      setTtsOpen(false)
                    },
                  })
                : null,
            ),
        focusMode ? null : progress ? h(ReadingProgress, { t, percent: progress.percent, onSeek: progress.onSeek }) : null,
        focusMode
          ? h(
              'div',
              { className: 'bs-focus-controls', ref: chromeRef },
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-icon-button',
                  onClick: () => onBack(progress ? progress.percent : null),
                  title: t('back'),
                  'aria-label': t('back'),
                },
                h(ArrowLeftIcon),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-icon-button',
                  onClick: () => setFocusMode(false),
                  title: t('exitImmersive'),
                  'aria-label': t('exitImmersive'),
                  autoFocus: true,
                },
                h(MinimizeIcon),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-icon-button',
                  onClick: toggleFullscreen,
                  'aria-pressed': isFullscreen,
                  title: isFullscreen ? t('exitFullscreen') : t('fullscreen'),
                  'aria-label': isFullscreen ? t('exitFullscreen') : t('fullscreen'),
                },
                isFullscreen ? h(MinimizeIcon) : h(FullscreenIcon),
              ),
              progress ? h('span', { className: 'bs-control-label bs-percent' }, `${Math.round(progress.percent * 100)}%`) : null,
            )
          : null,
      )
    }

    function ReaderState({ error, message, onRetry, retryLabel }) {
      return h(
        'div',
        { className: error ? 'bs-reader-state bs-reader-state-error' : 'bs-reader-state' },
        error ? h(AlertIcon, { size: 22 }) : h(Spinner),
        h('div', null, message),
        error && onRetry
          ? h('button', { type: 'button', className: 'bs-button', onClick: onRetry }, retryLabel)
          : null,
      )
    }

    // ----- [hooks:theme] -----
    // Repaint the reading palette when DSH switches theme.

    function useThemeTick() {
      const [tick, setTick] = useState(0)
      useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined
        const observer = new MutationObserver(() => setTick((value) => value + 1))
        // DSH toggles the dark palette attribute on the body and the resolved
        // color-scheme on the root; custom themes may also repaint root styles.
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        const root = document.documentElement
        if (root) observer.observe(root, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] })
        return () => observer.disconnect()
      }, [])
      return tick
    }

    // ===== [frame] =====
    // Reading-frame primitives: palette painting, paged columns and page
    // metrics shared by the EPUB and PDF readers.

    function paintFrame(documentNode, settings) {
      if (!documentNode || !documentNode.documentElement) return
      const palette = readingPalette(settings)
      const margins = PAGE_MARGINS[settings.pageMargin] || PAGE_MARGINS.standard
      const root = documentNode.documentElement
      const body = documentNode.body
      root.style.setProperty('--bb-font-family', readingFonts ? readingFonts.fontStack(settings) : READER_FONTS[settings.fontFamily] || READER_FONTS.serif)
      root.style.setProperty('--bb-font-weight', settings.fontWeight ? String(settings.fontWeight) : 'normal')
      root.style.setProperty('--bb-font-style', settings.fontStyle === 'italic' ? 'italic' : 'normal')
      root.style.setProperty('--bb-font-size', `${Math.min(30, Math.max(12, Math.round(settings.fontSize || 19)))}px`)
      root.style.setProperty('--bb-line-height', String(Math.min(2.5, Math.max(1.2, settings.lineHeight || 1.85))))
      root.style.setProperty('--bb-max-width', margins.maxWidth)
      root.style.setProperty('--bb-padding-x', margins.scrollX)
      root.style.setProperty('--bb-padding-y', margins.scrollY)
      root.style.setProperty('--bb-page-pad-x', margins.pageX)
      root.style.setProperty('--bb-page-pad-y', margins.pageY)
      root.style.setProperty('--bb-fg', palette.fg)
      root.style.setProperty('--bb-muted', palette.muted)
      root.style.setProperty('--bb-border', palette.border)
      root.style.setProperty('--bb-accent', palette.accent)
      root.style.setProperty('--bb-code-bg', palette.codeBg)
      root.style.setProperty('--bb-bg', palette.bg)
      root.style.setProperty('--bb-scheme', palette.scheme)
      root.style.background = palette.bg
      if (body) body.style.background = palette.bg
    }

    function configurePagedColumns(documentNode, settings) {
      const root = documentNode.documentElement
      const body = documentNode.body
      const view = documentNode.defaultView
      if (!body || !view) return
      const styles = view.getComputedStyle(body)
      const width = body.getBoundingClientRect().width
      const height = body.getBoundingClientRect().height
      const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
      const font = parseFloat(styles.fontSize) || 19
      const line = parseFloat(styles.lineHeight) || font * 1.85
      // Product experiment: each column needs 24 em and at least eight lines.
      // With gap=padX, two content columns occupy width - 2*padX.
      const columns = settings.pageSpread !== 'single' && width >= 48 * font + 2 * padX && height - padY >= 8 * line ? 2 : 1
      root.style.setProperty('--bb-page-columns', String(columns))
      body.removeAttribute('data-bb-pad-spread')
    }

    function pagedMetrics(documentNode, windowNode) {
      const body = documentNode.body
      if (!body || !windowNode) return null
      const styles = windowNode.getComputedStyle(body)
      const padLeft = parseFloat(styles.paddingLeft) || 0
      const padTop = parseFloat(styles.paddingTop) || 0
      const padX = padLeft + (parseFloat(styles.paddingRight) || 0)
      const padY = padTop + (parseFloat(styles.paddingBottom) || 0)
      const gap = parseFloat(styles.columnGap) || 0
      const width = Math.max(1, body.getBoundingClientRect().width || windowNode.innerWidth || 0)
      const columns = parseInt(styles.columnCount, 10) === 2 ? 2 : 1
      const pageWidth = Math.max(1, (width - padX - gap * (columns - 1)) / columns)
      const step = pageWidth + gap
      const scrollWidth = Math.max(body.scrollWidth, documentNode.documentElement.scrollWidth)
      let pages = Math.max(1, Math.ceil((scrollWidth - padX + gap - 1) / step))
      if (columns === 2 && scrollWidth <= width + 1) {
        // The scroll box is always at least one spread wide, including for a
        // short or empty chapter. Count only occupied columns in that case.
        let end = padLeft
        for (const node of body.childNodes) {
          // Only outer-flow fragments count. Range over the entire subtree also
          // includes clipped cells inside horizontally scrolling table wrappers.
          let rects
          if (node.nodeType === 1) rects = node.getClientRects()
          else if (node.nodeType === 3 && node.textContent.trim()) {
            const range = documentNode.createRange()
            range.selectNodeContents(node)
            rects = range.getClientRects()
          } else continue
          for (const rect of rects) {
            if (rect.width > 0 && rect.height > 0) end = Math.max(end, rect.right + body.scrollLeft)
          }
        }
        pages = Math.max(1, Math.ceil((end - padLeft + gap - 1) / step))
      } else if (body.hasAttribute('data-bb-pad-spread')) {
        pages = Math.max(1, pages - 1)
      }
      return { padLeft, padTop, padX, padY, gap, width, pageWidth, step, pages, columns }
    }

    function wrapTables(documentNode) {
      if (!documentNode || !documentNode.body) return
      for (const table of documentNode.body.querySelectorAll('table')) {
        const parent = table.parentElement
        if (parent && parent.classList && parent.classList.contains('bb-table-wrap')) continue
        const wrap = documentNode.createElement('div')
        wrap.className = 'bb-table-wrap'
        if (parent) {
          parent.insertBefore(wrap, table)
          wrap.appendChild(table)
        }
      }
    }

    function ensurePagedStyle(documentNode) {
      if (documentNode.getElementById('bb-paged-style') !== null) return
      const style = documentNode.createElement('style')
      style.id = 'bb-paged-style'
      style.textContent = PAGED_CSS
      ;(documentNode.head || documentNode.documentElement).appendChild(style)
    }

    function clearPagedLayout(documentNode) {
      if (documentNode && documentNode.documentElement) {
        documentNode.documentElement.classList.remove('bb-paged')
      }
    }

    // ===== [reader] =====
    // PDF reader: page rendering, zoom/fit modes, bookmarks and read-aloud page
    // batches.

    function PdfPage({ pdfDocument, pageNumber, pageWidth, zoom, t }) {
      const holderRef = useRef(null)
      const canvasRef = useRef(null)
      const taskRef = useRef(null)
      const [visible, setVisible] = useState(false)
      const [state, setState] = useState('idle')

      useEffect(() => {
        const node = holderRef.current
        if (node === null || typeof IntersectionObserver === 'undefined') {
          setVisible(true)
          return undefined
        }
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                setVisible(true)
                observer.disconnect()
                return
              }
            }
          },
          { rootMargin: '900px 0px' },
        )
        observer.observe(node)
        return () => observer.disconnect()
      }, [])

      useEffect(() => {
        if (!visible || !pdfDocument || pageWidth <= 0) return undefined
        let cancelled = false
        // Serialize renders on this canvas: a width or zoom change cancels the
        // previous task, and the next one waits for that cancellation to settle
        // before calling render() again. PDF.js refuses two live renders on one
        // canvas.
        const previous = taskRef.current
        setState('rendering')
        ;(async () => {
          if (previous !== null) {
            try {
              await previous.promise
            } catch {
              // A canceled render rejects; the canvas is free afterwards.
            }
          }
          if (cancelled) return
          try {
            const page = await pdfDocument.getPage(pageNumber)
            if (cancelled) return
            const baseViewport = page.getViewport({ scale: 1 })
            const cssWidth = Math.max(1, Math.round(pageWidth * zoom))
            const ratio = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1))
            const viewport = page.getViewport({ scale: (cssWidth / baseViewport.width) * ratio })
            const canvas = canvasRef.current
            if (canvas === null || cancelled) return
            canvas.width = Math.max(1, Math.floor(viewport.width))
            canvas.height = Math.max(1, Math.floor(viewport.height))
            canvas.style.width = `${cssWidth}px`
            canvas.style.height = 'auto'
            const context = canvas.getContext('2d', { alpha: false })
            if (context === null) throw new Error('canvas is unavailable')
            const task = page.render({ canvasContext: context, viewport, intent: 'display' })
            taskRef.current = task
            await task.promise
            if (!cancelled) setState('ready')
          } catch (error) {
            if (!cancelled && error && error.name !== 'RenderingCancelledException') {
              setState('error')
              console.error('bookshelf: PDF page failed', error)
            }
          }
        })()
        return () => {
          cancelled = true
          const current = taskRef.current
          if (current !== null) {
            try {
              current.cancel()
            } catch {
              // Rendering already settled.
            }
          }
        }
      }, [visible, pdfDocument, pageNumber, pageWidth, zoom])

      const renderedWidth = pageWidth > 0 ? Math.round(pageWidth * zoom) : 240
      return h(
        'div',
        {
          ref: holderRef,
          className: 'bs-pdf-page',
          'data-page-number': pageNumber,
          style: {
            width: `${renderedWidth}px`,
            minHeight: state === 'ready' ? 0 : Math.round(renderedWidth * 1.33),
          },
        },
        h('canvas', {
          ref: canvasRef,
          className: 'bs-pdf-canvas',
          style: { opacity: state === 'ready' ? 1 : 0 },
          'aria-label': t('pageLabel', { number: pageNumber }),
        }),
        state !== 'ready'
          ? h('div', { className: 'bs-pdf-placeholder' }, state === 'error' ? t('pageFailed') : h(Spinner, { small: true }))
          : null,
      )
    }

    function PdfReader({ t, book, onBack }) {
      const base = useMemo(() => transportBase(), [])
      const readerState = useReaderState(base, book)
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState('')
      const [pdfDocument, setPdfDocument] = useState(null)
      const [width, setWidth] = useState(0)
      const [height, setHeight] = useState(0)
      const [zoom, setZoom] = useState(1)
      const [fitMode, setFitMode] = useState('width')
      const [viewMode, setViewMode] = useState('continuous')
      const [pageAspect, setPageAspect] = useState(0)
      const [currentPage, setCurrentPage] = useState(1)
      const [attempt, setAttempt] = useState(0)
      const [bookmarksOpen, setBookmarksOpen] = useState(false)
      const scrollRef = useRef(null)
      const observerRef = useRef(null)
      const frameRef = useRef(0)
      const currentPageRef = useRef(1)
      const pdfDocumentRef = useRef(null)
      const restoringRef = useRef(true)
      const pdfReadyRef = useRef(false)
      const settleTimerRef = useRef(0)
      const jumpTimerRef = useRef(0)

      useEffect(() => {
        currentPageRef.current = currentPage
      }, [currentPage])

      useEffect(() => {
        pdfDocumentRef.current = pdfDocument
        pdfReadyRef.current = pdfDocument !== null && status === 'ready'
      }, [pdfDocument, status])

      const savePdfProgress = useCallback(
        (page, immediate = false) => {
          const document = pdfDocumentRef.current
          if (document === null || !readerState.loaded) return
          const safePage = Math.min(document.numPages, Math.max(1, Number.isFinite(page) ? page : 1))
          readerState.save(
            {
              progress: {
                format: 'pdf',
                page: safePage,
                percent: safePage / document.numPages,
                updatedAt: Date.now(),
              },
            },
            immediate,
          )
        },
        [readerState.loaded, readerState.save],
      )

      const exitReader = useCallback(
        (percent) => {
          // Persist the page the reader left from before the shelf reloads, so
          // the returned card already shows the exit progress.
          readerState.flush(true)
          onBack(typeof percent === 'number' ? percent : null)
        },
        [onBack, readerState.flush],
      )

      const savePdfSettings = useCallback(
        (patch) => {
          if (!readerState.loaded) return
          const current = readerState.stateRef.current && readerState.stateRef.current.settings
          readerState.save({
            settings: {
              ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
              ...patch,
            },
          })
        },
        [readerState.loaded, readerState.save],
      )

      const scrollToPage = useCallback((page) => {
        const node = scrollRef.current
        const document = pdfDocumentRef.current
        if (node === null) return
        const safePage = document ? Math.min(document.numPages, Math.max(1, page)) : Math.max(1, page)
        const target = node.querySelector(`[data-page-number="${safePage}"]`)
        if (target !== null) {
          const top = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop
          node.scrollTop = Math.max(0, top - 20)
        }
        currentPageRef.current = safePage
        setCurrentPage(safePage)
      }, [])

      useEffect(() => {
        if (!readerState.loaded) return undefined
        let cancelled = false
        let pdfjs = null
        let loadingTask = null
        let pdfWorker = null
        let blobUrl = ''
        const releaseWorker = () => {
          if (pdfjs !== null && pdfWorker !== null && pdfjs.GlobalWorkerOptions.workerPort === pdfWorker) {
            pdfjs.GlobalWorkerOptions.workerPort = null
          }
          if (pdfWorker !== null) {
            try {
              pdfWorker.terminate()
            } catch {
              // Already terminated by the loading task.
            }
            pdfWorker = null
          }
          if (blobUrl !== '') {
            URL.revokeObjectURL(blobUrl)
            blobUrl = ''
          }
        }
        pdfReadyRef.current = false
        restoringRef.current = true
        setStatus('loading')
        setError('')
        setPdfDocument(null)
        setCurrentPage(1)
        setPageAspect(0)
        ;(async () => {
          try {
            const [pdfjsModule] = await Promise.all([loadPdfjs(base), preloadClientLibs(base, ['text-index'])])
            pdfjs = pdfjsModule
            const response = await fetch(resourceUrl(base, `${API_ROOT}/books/${book.id}/file`))
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const data = new Uint8Array(await response.arrayBuffer())
            if (cancelled) return
            const created = await createPdfWorker(pdfjs, base)
            pdfWorker = created.worker
            blobUrl = created.blobUrl
            if (cancelled) {
              releaseWorker()
              return
            }
            loadingTask = pdfjs.getDocument({
              data,
              cMapUrl: absoluteServiceUrl(base, `${ASSET_ROOT}/cmaps/`),
              cMapPacked: true,
              standardFontDataUrl: absoluteServiceUrl(base, `${ASSET_ROOT}/standard_fonts/`),
              wasmUrl: absoluteServiceUrl(base, `${ASSET_ROOT}/wasm/`),
              isEvalSupported: false,
            })
            const document = await loadingTask.promise
            if (cancelled) {
              void loadingTask.destroy().catch(() => undefined).finally(releaseWorker)
              loadingTask = null
              return
            }
            const storedSettings = readerState.stateRef.current && readerState.stateRef.current.settings
            if (storedSettings && typeof storedSettings === 'object') {
              if (storedSettings.pdfFit === 'page' || storedSettings.pdfFit === 'width' || storedSettings.pdfFit === 'custom') {
                setFitMode(storedSettings.pdfFit)
              }
              if (Number.isFinite(storedSettings.pdfZoom)) {
                setZoom(Math.min(3, Math.max(0.5, Math.round(storedSettings.pdfZoom * 100) / 100)))
              }
              if (storedSettings.pdfView === 'single' || storedSettings.pdfView === 'continuous') {
                setViewMode(storedSettings.pdfView)
              }
            }
            const saved = readerState.stateRef.current && readerState.stateRef.current.progress
            const savedPage =
              saved && saved.format === 'pdf' && Number.isInteger(saved.page) ? Math.min(document.numPages, Math.max(1, saved.page)) : 1
            restoringRef.current = true
            currentPageRef.current = savedPage
            setCurrentPage(savedPage)
            pdfDocumentRef.current = document
            setPdfDocument(document)
            setStatus('ready')
          } catch (failure) {
            releaseWorker()
            if (!cancelled) {
              setError(failure instanceof Error ? failure.message : String(failure))
              setStatus('error')
            }
          }
        })()
        return () => {
          cancelled = true
          const task = loadingTask
          loadingTask = null
          if (task !== null) {
            try {
              void task.destroy().catch(() => undefined).finally(releaseWorker)
            } catch {
              releaseWorker()
            }
          } else {
            releaseWorker()
          }
        }
      }, [readerState.loaded, base, book.id, attempt, t])

      useEffect(
        () => () => {
          if (pdfReadyRef.current) savePdfProgress(currentPageRef.current, true)
        },
        [savePdfProgress],
      )

      useEffect(() => {
        if (status !== 'ready' || pdfDocument === null) return undefined
        let cancelled = false
        ;(async () => {
          try {
            const page = await pdfDocument.getPage(currentPage)
            if (cancelled) return
            const viewport = page.getViewport({ scale: 1 })
            if (viewport.width > 0) setPageAspect(viewport.height / viewport.width)
          } catch {
            // Keep the fallback aspect ratio.
          }
        })()
        return () => {
          cancelled = true
        }
      }, [status, pdfDocument, currentPage])

      useEffect(() => {
        if (status !== 'ready' || pdfDocument === null || restoringRef.current) return
        savePdfProgress(currentPage)
      }, [currentPage, status, pdfDocument, savePdfProgress])

      useEffect(() => {
        if (status !== 'ready') return undefined
        const node = scrollRef.current
        if (node === null) return undefined
        const measure = () => {
          const nextWidth = Number(node.clientWidth)
          const nextHeight = Number(node.clientHeight)
          setWidth(Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : 0)
          setHeight(Number.isFinite(nextHeight) && nextHeight > 0 ? nextHeight : 0)
        }
        if (typeof ResizeObserver === 'undefined') {
          measure()
          return undefined
        }
        observerRef.current = new ResizeObserver(measure)
        observerRef.current.observe(node)
        measure()
        return () => {
          if (observerRef.current !== null) {
            observerRef.current.disconnect()
            observerRef.current = null
          }
        }
      }, [status])

      const pageWidth = Number.isFinite(width) && width > 0 ? Math.max(240, width - 48) : 0
      const aspect = pageAspect > 0 ? pageAspect : 1.414
      const availablePageHeight = Math.max(120, height - 104)
      const fitPageZoom = pageWidth > 0 ? Math.max(0.1, Math.min(1, availablePageHeight / (pageWidth * aspect))) : 1
      const effectiveZoom = fitMode === 'page' ? fitPageZoom : fitMode === 'width' ? 1 : zoom
      const applyZoomStep = (delta) => {
        const base = fitMode === 'custom' ? zoom : effectiveZoom
        const next = Math.min(3, Math.max(0.5, Math.round((base + delta) * 100) / 100))
        setZoom(next)
        setFitMode('custom')
        savePdfSettings({ pdfFit: 'custom', pdfZoom: next })
      }
      const applyFitMode = (mode) => {
        setFitMode(mode)
        savePdfSettings({ pdfFit: mode })
      }
      const toggleViewMode = () => {
        const next = viewMode === 'single' ? 'continuous' : 'single'
        // Inserting preceding pages can emit a scroll before passive effects.
        // Protect the selected page before changing the DOM.
        restoringRef.current = true
        setViewMode(next)
        savePdfSettings({ pdfView: next })
      }
      const percent = pdfDocument ? Math.min(1, Math.max(0, currentPage / pdfDocument.numPages)) : 0

      useLayoutEffect(() => {
        if (status !== 'ready' || pdfDocument === null) return undefined
        // Capture once, before layout-generated scroll events can replace it.
        const target = Math.min(pdfDocument.numPages, Math.max(1, currentPageRef.current))
        restoringRef.current = true
        if (frameRef.current !== 0) {
          cancelAnimationFrame(frameRef.current)
          frameRef.current = 0
        }
        clearTimeout(jumpTimerRef.current)
        jumpTimerRef.current = 0
        const timer = setTimeout(() => {
          scrollToPage(target)
          settleTimerRef.current = setTimeout(() => {
            scrollToPage(target)
            restoringRef.current = false
            savePdfProgress(target)
          }, 180)
        }, 100)
        return () => {
          clearTimeout(timer)
          clearTimeout(settleTimerRef.current)
        }
      }, [effectiveZoom, fitMode, viewMode, width, height, status, pdfDocument, scrollToPage, savePdfProgress])

      const onScroll = useCallback(() => {
        if (viewMode === 'single' || restoringRef.current) return
        if (frameRef.current !== 0) return
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0
          const node = scrollRef.current
          if (node === null || restoringRef.current) return
          const rootTop = node.getBoundingClientRect().top
          const pages = node.querySelectorAll('[data-page-number]')
          let current = 1
          for (const page of pages) {
            const top = page.getBoundingClientRect().top - rootTop
            if (top <= 140) current = Number(page.dataset.pageNumber) || current
            else break
          }
          currentPageRef.current = current
          setCurrentPage((value) => (value === current ? value : current))
        })
      }, [viewMode])

      useEffect(
        () => () => {
          if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current)
          clearTimeout(settleTimerRef.current)
          clearTimeout(jumpTimerRef.current)
          jumpTimerRef.current = 0
        },
        [],
      )

      const bookmarks = readerState.state && Array.isArray(readerState.state.bookmarks) ? readerState.state.bookmarks : []
      const currentBookmark = bookmarks.find((bookmark) => bookmark.format === 'pdf' && bookmark.page === currentPage)

      const toggleBookmark = useCallback(() => {
        if (pdfDocument === null) return
        if (currentBookmark) {
          readerState.save({ bookmarks: bookmarks.filter((bookmark) => bookmark.id !== currentBookmark.id) }, true)
          return
        }
        const bookmarkPercent = Math.min(1, Math.max(0, currentPage / pdfDocument.numPages))
        const bookmark = {
          id: newBookmarkId(),
          label: `${t('pageLabel', { number: currentPage })} · ${Math.round(bookmarkPercent * 100)}%`,
          format: 'pdf',
          page: currentPage,
          percent: bookmarkPercent,
          createdAt: Date.now(),
        }
        const nextBookmarks = [bookmark, ...bookmarks.filter((item) => !(item.format === 'pdf' && item.page === currentPage))].slice(0, 500)
        readerState.save({ bookmarks: nextBookmarks }, true)
        setBookmarksOpen(true)
      }, [bookmarks, currentBookmark, currentPage, pdfDocument, readerState.save, t])

      const jumpToPage = useCallback(
        (page) => {
          const document = pdfDocumentRef.current
          if (document === null) return
          const safePage = Math.min(document.numPages, Math.max(1, page))
          restoringRef.current = true
          currentPageRef.current = safePage
          setCurrentPage(safePage)
          requestAnimationFrame(() => {
            scrollToPage(safePage)
            if (jumpTimerRef.current !== 0) clearTimeout(jumpTimerRef.current)
            jumpTimerRef.current = setTimeout(() => {
              jumpTimerRef.current = 0
              restoringRef.current = false
              savePdfProgress(safePage)
            }, 120)
          })
        },
        [savePdfProgress, scrollToPage],
      )

      const onSeekProgress = useCallback(
        (value) => {
          if (pdfDocument === null) return
          const page = Math.min(pdfDocument.numPages, Math.max(1, Math.ceil(value * pdfDocument.numPages)))
          jumpToPage(page)
        },
        [jumpToPage, pdfDocument],
      )

      useEffect(() => {
        if (status !== 'ready' || pdfDocument === null) return undefined
        const onKeyDown = (event) => {
          if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
          const target = event.target
          if (target && typeof target.closest === 'function' && target.closest('input,textarea,select,button,[contenteditable="true"]')) return
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault()
            jumpToPage(currentPageRef.current - 1)
          } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            event.preventDefault()
            jumpToPage(currentPageRef.current + 1)
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [status, pdfDocument, jumpToPage])

      const controls = []
      controls.push(
        h(
          'button',
          {
            key: 'bookmark',
            type: 'button',
            className: 'bs-icon-button',
            onClick: toggleBookmark,
            'aria-pressed': Boolean(currentBookmark),
            disabled: status !== 'ready',
            title: currentBookmark ? t('removeBookmark') : t('addBookmark'),
            'aria-label': currentBookmark ? t('removeBookmark') : t('addBookmark'),
          },
          h(BookmarkIcon, { filled: Boolean(currentBookmark) }),
        ),
      )
      controls.push(
        h(
          'button',
          {
            key: 'bookmark-list',
            type: 'button',
            className: 'bs-text-button',
            onClick: () => setBookmarksOpen((value) => !value),
            'aria-expanded': bookmarksOpen,
            title: t('bookmarksTab'),
          },
          bookmarks.length > 0 ? `${t('bookmarksTab')} (${bookmarks.length})` : t('bookmarksTab'),
        ),
      )
      controls.push(h('span', { key: 'div0', className: 'bs-divider' }))
      controls.push(
        h(
          'div',
          { key: 'zoom', style: { display: 'flex', alignItems: 'center', gap: 2 } },
          h(
            'button',
            {
              type: 'button',
              className: 'bs-icon-button',
              onClick: () => applyZoomStep(-0.25),
              disabled: effectiveZoom <= 0.5,
              title: t('zoomOut'),
              'aria-label': t('zoomOut'),
            },
            h(ZoomOutIcon),
          ),
          h('span', { className: 'bs-control-label' }, `${Math.round(effectiveZoom * 100)}%`),
          h(
            'button',
            {
              type: 'button',
              className: 'bs-icon-button',
              onClick: () => applyZoomStep(0.25),
              disabled: effectiveZoom >= 3,
              title: t('zoomIn'),
              'aria-label': t('zoomIn'),
            },
            h(ZoomInIcon),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'bs-text-button',
              onClick: () => applyFitMode('width'),
              'aria-pressed': fitMode === 'width',
              title: t('fitWidth'),
            },
            t('fitWidth'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'bs-text-button',
              onClick: () => applyFitMode('page'),
              'aria-pressed': fitMode === 'page',
              title: t('fitPage'),
            },
            t('fitPage'),
          ),
        ),
      )
      controls.push(h('span', { key: 'div', className: 'bs-divider' }))
      controls.push(
        h(
          'button',
          {
            key: 'prev-page',
            type: 'button',
            className: 'bs-icon-button',
            onClick: () => jumpToPage(currentPage - 1),
            disabled: status !== 'ready' || pdfDocument === null || currentPage <= 1,
            title: t('previousPage'),
            'aria-label': t('previousPage'),
            'aria-keyshortcuts': 'ArrowLeft PageUp',
          },
          h(ChevronLeftIcon),
        ),
      )
      controls.push(h('span', { key: 'page', className: 'bs-control-label', 'aria-live': 'polite', 'aria-atomic': 'true' }, pdfDocument ? t('pageOf', { current: currentPage, total: pdfDocument.numPages }) : ''))
      controls.push(
        h(
          'button',
          {
            key: 'next-page',
            type: 'button',
            className: 'bs-icon-button',
            onClick: () => jumpToPage(currentPage + 1),
            disabled: status !== 'ready' || pdfDocument === null || currentPage >= pdfDocument.numPages,
            title: t('nextPage'),
            'aria-label': t('nextPage'),
            'aria-keyshortcuts': 'ArrowRight PageDown',
          },
          h(ChevronRightIcon),
        ),
      )
      controls.push(
        h(
          'button',
          {
            key: 'view-mode',
            type: 'button',
            className: 'bs-text-button',
            onClick: toggleViewMode,
            'aria-pressed': viewMode === 'single',
            title: t('pdfViewMode'),
          },
          viewMode === 'single' ? t('pdfContinuous') : t('pdfSingle'),
        ),
      )

      const pages = []
      if (pdfDocument !== null && status === 'ready') {
        const pageNumbers =
          viewMode === 'single'
            ? [Math.min(pdfDocument.numPages, Math.max(1, currentPage))]
            : Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
        for (const number of pageNumbers) {
          pages.push(
            h(PdfPage, {
              key: number,
              pdfDocument,
              pageNumber: number,
              pageWidth,
              zoom: effectiveZoom,
              t,
            }),
          )
        }
      }

      const bookmarksPanel = bookmarksOpen
        ? h(
            'div',
            { className: 'bs-bookmarks-panel' },
            h(
              'div',
              { className: 'bs-bookmarks-panel-title' },
              h('span', null, `${t('bookmarksTab')}${bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}`),
              h(
                'button',
                { type: 'button', className: 'bs-icon-button', onClick: () => setBookmarksOpen(false), title: t('dismiss'), 'aria-label': t('dismiss') },
                h(CloseIcon),
              ),
            ),
            h(BookmarksList, {
              t,
              bookmarks,
              onSelect: (bookmark) => {
                setBookmarksOpen(false)
                jumpToPage(bookmark.page || 1)
              },
              onDelete: (bookmark) => readerState.save({ bookmarks: bookmarks.filter((item) => item.id !== bookmark.id) }, true),
            }),
          )
        : null

      const [speechLanguage, setSpeechLanguage] = useState('')
      const readAloud = useReadAloud({ base, t, language: speechLanguage })

      const createSpeechDriver = useCallback(() => {
        const pdfDocument = pdfDocumentRef.current
        if (pdfDocument === null) return null
        const total = pdfDocument.numPages
        const modulePromise = loadTtsSentences(base)
        // The reader awaited preloadClientLibs() before opening, so the text
        // index module object is available synchronously here.
        const textIndex = clientLib('text-index')
        // A PDF rarely declares a language: read the first page and detect it.
        void (async () => {
          try {
            if (textIndex === null) return
            const firstPage = await pdfDocument.getPage(Math.min(total, Math.max(1, currentPageRef.current)))
            const detected = detectSpeechLanguage(textIndex.joinPdfItems((await firstPage.getTextContent()).items))
            if (detected !== '') {
              readAloud.setLanguage(detected)
              setSpeechLanguage(detected)
            }
          } catch {
            // Detection is best effort; the provider default voice still works.
          }
        })()
        const batchForPage = async (page) => {
          const module = await modulePromise
          if (textIndex === null) throw new Error(t('ttsFailed'))
          const pdfPage = await pdfDocument.getPage(page)
          const content = await pdfPage.getTextContent()
          const sentences = module.splitSentences(textIndex.joinPdfItems(content.items))
          return sentences.map((text) => ({
            text,
            enter: async () => {
              if (currentPageRef.current === page) return
              scrollToPage(page)
              await new Promise((resolve) => setTimeout(resolve, 60))
            },
          }))
        }
        return {
          current: () => batchForPage(Math.min(total, Math.max(1, currentPageRef.current))),
          advance: async () => {
            const next = currentPageRef.current + 1
            if (next > total) return null
            // Re-check the live document: it may have been replaced by a reload.
            if (pdfDocumentRef.current !== pdfDocument) return null
            return batchForPage(next)
          },
        }
      }, [base, readAloud, scrollToPage, t])

      const startReadAloud = useCallback(() => {
        const driver = createSpeechDriver()
        if (driver !== null) void readAloud.start(driver)
      }, [createSpeechDriver, readAloud])

      const previewReadAloud = useCallback(() => {
        const driver = createSpeechDriver()
        if (driver !== null) void readAloud.preview(driver)
      }, [createSpeechDriver, readAloud])

      return h(
        ReaderShell,
        {
          t,
          base,
          book,
          onBack: exitReader,
          controls,
          state: status === 'ready' && pdfDocument ? t('pdfPages', { total: pdfDocument.numPages }) : undefined,
          progress: status === 'ready' && pdfDocument ? { percent, onSeek: onSeekProgress } : undefined,
          speech: { readAloud, start: startReadAloud, preview: previewReadAloud },
        },
        status === 'loading'
          ? h(ReaderState, { message: t('rendering') })
          : status === 'error'
            ? h(ReaderState, {
                error: true,
                message: t('openFailed', { message: error }),
                onRetry: () => setAttempt((value) => value + 1),
                retryLabel: t('retry'),
              })
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { ref: scrollRef, className: 'bs-pdf-scroll', onScroll },
                  h('div', { className: 'bs-pdf-pages' }, pages),
                ),
                bookmarksPanel,
              ),
      )
    }

    // ----- [frame:epub] -----
    // Scroll-frame helper for the EPUB reader.

    function frameScrollRatio(frame) {
      const documentNode = frame && frame.contentDocument
      const windowNode = frame && frame.contentWindow
      if (!documentNode || !windowNode) return 0
      const root = documentNode.scrollingElement || documentNode.documentElement
      if (!root) return 0
      const maximum = root.scrollHeight - windowNode.innerHeight
      if (maximum <= 0) return 0
      return Math.min(1, Math.max(0, root.scrollTop / maximum))
    }

    // ----- [chrome:dialog] -----
    // "Discuss this page" handoff dialog.

    function DiscussionDialog({ t, discussion, workspaces, snapshot, captureError, onClose, preferredWorkspaceId, startError, initialCompleted }) {
      const dialogRef = useRef(null)
      const mountedRef = useRef(true)
      const choices = Array.isArray(workspaces) ? workspaces.filter(item => item && typeof item.workspaceId === 'string') : []
      const [workspaceId, setWorkspaceId] = useState(() => choices.some(item => item.workspaceId === preferredWorkspaceId) ? preferredWorkspaceId : '')
      const [ready, setReady] = useState(Boolean(discussion && discussion.bridge))
      const [error, setError] = useState(startError || '')
      const [completed, setCompleted] = useState(Boolean(initialCompleted))
      const [, refresh] = useState(0)
      useEffect(() => {
        mountedRef.current = true
        const previous = document.activeElement
        dialogRef.current?.focus()
        const unsubscribe = discussion?.subscribe(() => refresh(value => value + 1))
        if (discussion) discussion.load().then(() => {
          if (mountedRef.current) setReady(true)
        }, failure => {
          if (mountedRef.current) setError(failure instanceof Error ? failure.message : String(failure))
        })
        else setError(t('discussionUnavailable'))
        return () => {
          mountedRef.current = false
          unsubscribe?.()
          if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus()
        }
      }, [discussion, t])
      const pending = discussion?.bridge?.pending
      const captured = pending?.snapshot || snapshot
      const busy = Boolean(discussion?.running)
      const selectedWorkspace = choices.find(item => item.workspaceId === (pending?.workspaceId || workspaceId))
      const hasText = Boolean(captured?.text?.trim())
      const visibleError = error || (!pending ? captureError : '')
      const start = async () => {
        if (!ready || busy || completed || !hasText || (!pending && (!selectedWorkspace || captureError))) return
        setError('')
        try {
          const outcome = await discussion.start(pending ? { retry: true } : { workspaceId, snapshot: captured })
          if (!mountedRef.current) return
          if (outcome.opened) onClose()
          else setCompleted(true)
        } catch (failure) {
          if (mountedRef.current) setError(failure instanceof Error ? failure.message : String(failure))
        }
      }
      const onKeyDown = event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
        if (event.key !== 'Tab') return
        const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        if (!nodes.length) { event.preventDefault(); dialogRef.current.focus(); return }
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus() }
      }
      return h('div', { className: 'bs-discussion-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) onClose() } },
        h('section', { ref: dialogRef, className: 'bs-discussion-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bs-discussion-title', 'aria-describedby': 'bs-discussion-hint', tabIndex: -1, onKeyDown },
          h('h2', { id: 'bs-discussion-title' }, t(pending ? 'discussionResume' : 'discussPage')),
          h('p', { id: 'bs-discussion-hint' }, t('discussionHint')),
          captured ? h('div', { className: 'bs-discussion-summary' }, captured.title, ' · ', captured.chapterTitle, captured.pageLabel ? ` · ${captured.pageLabel}` : '') : null,
          pending ? h('p', null, t('discussionPending'), ' ', selectedWorkspace?.path || pending.workspaceId) : null,
          captured ? h('p', null, t(captured.truncated || captured.coverage?.status === 'partial' ? 'discussionPartial' : 'discussionCoverage')) : null,
          hasText ? h('pre', { className: 'bs-discussion-preview', tabIndex: 0, 'aria-label': t('discussionPreview') }, captured.text) : h('p', { className: 'bs-discussion-error' }, t('discussionNoText')),
          !pending && !completed ? h('label', { className: 'bs-discussion-workspace' }, t('discussionWorkspace'),
            h('select', { value: workspaceId, onChange: event => setWorkspaceId(event.target.value), disabled: busy || !hasText, 'aria-label': t('discussionWorkspace') },
              h('option', { value: '' }, t('discussionChooseWorkspace')),
              choices.map(item => h('option', { key: item.workspaceId, value: item.workspaceId }, item.path || item.workspaceId))),
            choices.length ? null : h('p', null, t('discussionNoWorkspaces')),
          ) : null,
          visibleError ? h('p', { className: 'bs-discussion-error', role: 'alert' }, visibleError) : null,
          completed ? h('p', { role: 'status' }, t('discussionSaved')) : null,
          h('div', { className: 'bs-discussion-actions' },
            pending && !busy ? h('button', { type: 'button', className: 'bs-button', onClick: () => { discussion.discard(); onClose() } }, t('discussionDiscard')) : null,
            h('button', { type: 'button', className: 'bs-button', onClick: onClose }, t('dismiss')),
            completed ? null : h('button', { type: 'button', className: 'bs-button bs-button-primary', onClick: start, disabled: !ready || busy || !hasText || (!pending && (!selectedWorkspace || Boolean(captureError))) }, busy ? t('discussionCreating') : t(pending ? 'discussionRetry' : 'discussionCreate')),
          ),
        ),
      )
    }

    // ----- [reader:epub] -----
    // EPUB reader: chapter frame, paged layout, TOC/bookmarks aside and
    // read-aloud sentence mapping.

    // Selection → annotation anchor mapping. Both helpers work in the
    // whitespace-normalised chapter text produced by
    // assets/lib/text-index.mjs buildSpeechIndex: that is the space the
    // annotation model stores (chapterIndex + start/end) and the renderer uses
    // to rebuild Ranges. Element boundary points are resolved to the nearest
    // text node so a selection that starts or ends on a paragraph still anchors.
    function resolveTextBoundary(node, offset, edge) {
      if (node === null || node === undefined) return null
      if (node.nodeType === 3) return { node, offset: Math.max(0, Math.min(node.nodeValue.length, offset)) }
      if (node.nodeType !== 1 && node.nodeType !== 11) return null
      const children = node.childNodes
      if (!children || children.length === 0) return null
      const descend = (child, first) => {
        if (child === null || child === undefined) return null
        if (child.nodeType === 3) return { node: child, offset: first ? 0 : child.nodeValue.length }
        if (child.nodeType !== 1) return null
        const nested = child.childNodes
        if (!nested || nested.length === 0) return null
        if (first) {
          for (let index = 0; index < nested.length; index += 1) {
            const found = descend(nested[index], true)
            if (found !== null) return found
          }
          return null
        }
        for (let index = nested.length - 1; index >= 0; index -= 1) {
          const found = descend(nested[index], false)
          if (found !== null) return found
        }
        return null
      }
      const boundary = Math.max(0, Math.min(children.length, offset))
      if (edge === 'start') {
        for (let cursor = boundary; cursor < children.length; cursor += 1) {
          const found = descend(children[cursor], true)
          if (found !== null) return found
        }
        for (let cursor = boundary - 1; cursor >= 0; cursor -= 1) {
          const found = descend(children[cursor], false)
          if (found !== null) return found
        }
        return null
      }
      for (let cursor = boundary - 1; cursor >= 0; cursor -= 1) {
        const found = descend(children[cursor], false)
        if (found !== null) return found
      }
      for (let cursor = boundary; cursor < children.length; cursor += 1) {
        const found = descend(children[cursor], true)
        if (found !== null) return found
      }
      return null
    }

    function flatOffsetForBoundary(index, boundary) {
      if (boundary === null) return null
      // Entries are monotonic inside one text node, so binary search the first
      // character at or after the DOM point. The per-node map is cached on the
      // freshly built index, so a right click builds it once.
      let points = index.annotationPoints
      if (!(points instanceof Map)) {
        points = new Map()
        for (let flat = 0; flat < index.entries.length; flat += 1) {
          const entry = index.entries[flat]
          let record = points.get(entry.node)
          if (record === undefined) {
            record = { first: flat, offsets: [] }
            points.set(entry.node, record)
          }
          record.offsets.push(entry.offset)
        }
        index.annotationPoints = points
      }
      const record = points.get(boundary.node)
      if (record === undefined) return null
      let low = 0
      let high = record.offsets.length
      while (low < high) {
        const middle = (low + high) >> 1
        if (record.offsets[middle] < boundary.offset) low = middle + 1
        else high = middle
      }
      return record.first + low
    }

    // Returns the fromSelection() payload for a live DOM selection, or null when
    // the selection has no anchorable text (empty, outside the chapter body, or
    // the text-index module is unavailable). Callers disable the annotation
    // actions instead of letting a null cross the event handler.
    function annotationAnchorForSelection(documentNode, selection, chapterIndex) {
      const textIndex = clientLib('text-index')
      if (textIndex === null || selection === null || typeof selection.getRangeAt !== 'function') return null
      if (!(selection.rangeCount > 0)) return null
      let index
      try {
        index = textIndex.buildSpeechIndex(documentNode)
      } catch {
        return null
      }
      if (index.flat === '' || index.entries.length === 0) return null
      const range = selection.getRangeAt(0)
      const startBoundary = resolveTextBoundary(range.startContainer, range.startOffset, 'start')
      const endBoundary = resolveTextBoundary(range.endContainer, range.endOffset, 'end')
      let start = flatOffsetForBoundary(index, startBoundary)
      let end = flatOffsetForBoundary(index, endBoundary)
      if (start === null || end === null) return null
      if (start > end) {
        const swap = start
        start = end
        end = swap
      }
      while (start < end && /\s/u.test(index.flat[start])) start += 1
      while (end > start && /\s/u.test(index.flat[end - 1])) end -= 1
      if (end <= start) return null
      const quote = index.flat.slice(start, end)
      if (quote === '') return null
      return {
        chapterIndex,
        start,
        end,
        quote,
        prefix: index.flat.slice(Math.max(0, start - 40), start),
        suffix: index.flat.slice(end, Math.min(index.flat.length, end + 40)),
      }
    }

    function EpubReader({ t, book, onBack, defaultSettings, discussion, workspaces, discussionWorkspace }) {
      const base = useMemo(() => transportBase(), [])
      const readerState = useReaderState(base, book)
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState('')
      const [data, setData] = useState(null)
      const [epubModule, setEpubModule] = useState(null)
      const [snapshotModule, setSnapshotModule] = useState(null)
      const [snapshotLoadError, setSnapshotLoadError] = useState('')
      const [discussionState, setDiscussionState] = useState(null)
      const [directBusy, setDirectBusy] = useState(false)
      const discussionClickRef = useRef(false)
      const [chapter, setChapter] = useState(0)
      const [anchor, setAnchor] = useState('')
      const [scrollRatio, setScrollRatio] = useState(0)
      const [settings, setSettings] = useState(() => ({ ...DEFAULT_READING_SETTINGS, ...(defaultSettings || {}) }))
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [tocOpen, setTocOpen] = useState(true)
      const [asideTab, setAsideTab] = useState('toc')
      const [attempt, setAttempt] = useState(0)
      const [pageIndex, setPageIndex] = useState(0)
      const [pageCount, setPageCount] = useState(1)
      const [pageColumns, setPageColumns] = useState(1)
      const [bookPageCounts, setBookPageCounts] = useState(null)
      const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
      const [selectionMenu, setSelectionMenu] = useState(null)
      const [annotationOpen, setAnnotationOpen] = useState(false)
      const [annotationStyle, setAnnotationStyle] = useState(() => normalizeAnnotationStyleValue(undefined))
      const [readingSort, setReadingSort] = useState('position')
      const [readingQuery, setReadingQuery] = useState('')
      const frameRef = useRef(null)
      const menuHostRef = useRef(null)
      const displayedChapterRef = useRef(null)
      const frameWrapRef = useRef(null)
      const probeFrameRef = useRef(null)
      const probeTokenRef = useRef(0)
      const imageCacheRef = useRef(new Map())
      const scrollRatioRef = useRef(0)
      const pendingScrollRef = useRef(0)
      const anchorRef = useRef('')
      const chapterRef = useRef(0)
      const restoringRef = useRef(false)
      const scrollBindingRef = useRef(null)
      const frameTokenRef = useRef(0)
      const layoutGenerationRef = useRef(0)
      const speechRangeRef = useRef(null)
      // Annotation ranges are cached per chapter document: the stored anchors
      // are chapter-local text offsets, so they must be mapped onto the live
      // DOM again after every chapter change.
      const annotationRangesRef = useRef({ document: null, source: null, ranges: [] })
      const highlightFallbackRef = useRef(false)
      const lastSavedProgressRef = useRef('')
      const pageIndexRef = useRef(0)
      const pageCountRef = useRef(1)
      const laidOutPagesRef = useRef(1)
      const pageColumnsRef = useRef(1)
      const pageAnchorRef = useRef(null)
      const previousModeRef = useRef(settings.pageMode)
      const turnPageRef = useRef(() => {})
      const themeTick = useThemeTick()
      const settingsRef = useRef(settings)
      // The annotation style is a separate slice of state: dragging its sliders
      // must not replace the reader settings object identity, or the paged
      // layout effect would reflow the chapter on every input event.
      const annotationStyleRef = useRef(annotationStyle)
      const palette = useMemo(() => readingPalette(settings), [settings, themeTick])

      // ----- [frame:highlights] -----
      // Read-aloud paints the spoken sentence as a true colour inversion and
      // every annotation of the current chapter above it. Both layers are
      // rebuilt from the live chapter DOM whenever the sentence, the page, the
      // font or the annotation list changes; a browser without the CSS Custom
      // Highlight API keeps the legacy marker band (`plan.fallback === 'overlay'`).
      const resolveAnnotationRanges = useCallback((documentNode, annotations, chapter) => {
        const textIndex = clientLib('text-index')
        if (textIndex === null || annotations.length === 0) return []
        const cache = annotationRangesRef.current
        if (cache.document === documentNode && cache.source === annotations && cache.chapter === chapter) return cache.ranges
        // One index per chapter document; only then are the stored text offsets
        // mapped onto live text nodes.
        const index = textIndex.buildSpeechIndex(documentNode)
        const ranges = []
        for (const annotation of annotations) {
          if (annotation === null || typeof annotation !== 'object') continue
          if (annotation.chapterIndex !== chapter) continue
          if (!Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) || annotation.end <= annotation.start) continue
          const start = index.entries[annotation.start]
          const end = index.entries[annotation.end - 1]
          if (!start || !end) continue
          try {
            const range = documentNode.createRange()
            range.setStart(start.node, Math.min(start.offset, (start.node.nodeValue || '').length))
            range.setEnd(end.node, Math.min(end.offset + 1, (end.node.nodeValue || '').length))
            ranges.push({ ...annotation, range })
          } catch {
            // A stale anchor must not break the repaint of the other entries.
          }
        }
        annotationRangesRef.current = { document: documentNode, source: annotations, chapter, ranges }
        return ranges
      }, [])

      const repaintHighlights = useCallback((documentNode) => {
        const highlights = clientLib('highlights')
        const liveFrame = frameRef.current
        if (!documentNode || (liveFrame !== null && liveFrame.contentDocument !== documentNode)) return null
        const speechRange = speechRangeRef.current
        const spoken = speechRange !== null && typeof documentNode.contains === 'function' && documentNode.contains(speechRange.startContainer)
          ? { range: speechRange }
          : null
        // A range from a replaced chapter is meaningless here; dropping it also
        // lets the next sentence start from a clean slate.
        if (spoken === null) speechRangeRef.current = null
        const stored = readerState.stateRef.current
        const storedAnnotations = stored !== null && stored !== undefined && Array.isArray(stored.annotations) ? stored.annotations : []
        const chapter = chapterRef.current
        const resolved = resolveAnnotationRanges(documentNode, storedAnnotations, chapter)
        if (highlights === null) {
          // The module itself failed to load: losing the band would lose the
          // only position cue read-aloud has, so keep the legacy marker.
          highlightFallbackRef.current = true
          if (spoken !== null) paintSpeechGlass(documentNode, spoken.range)
          else clearSpeechGlass(documentNode)
          return null
        }
        const plan = highlights.buildHighlightPlan({
          palette: readingPalette(settingsRef.current),
          readAloud: spoken,
          annotations: resolved,
          chapterIndex: chapter,
          // CSS.highlights lives on the chapter window, not on the parent
          // window that runs this glue: the probe must look at the former.
          win: documentNode.defaultView || null,
        })
        highlights.applyHighlightPlan(documentNode, plan)
        highlightFallbackRef.current = plan.fallback === 'overlay'
        if (plan.fallback === 'overlay') {
          // Without the CSS Custom Highlight API the sentence falls back to the
          // marker band; annotation data is untouched and simply not painted.
          if (spoken !== null) paintSpeechGlass(documentNode, spoken.range)
          else clearSpeechGlass(documentNode)
        } else {
          clearSpeechGlass(documentNode)
        }
        return plan
      }, [resolveAnnotationRanges])

      // A replaced chapter document must not keep its registry entries or its
      // ::highlight() style element alive.
      const clearDisplayedHighlights = useCallback(() => {
        const previous = displayedChapterRef.current
        if (previous === null || previous === undefined || !previous.document) return
        const liveFrame = frameRef.current
        const liveDocument = liveFrame === null ? null : liveFrame.contentDocument
        if (liveDocument === previous.document) return
        const highlights = clientLib('highlights')
        if (highlights === null) return
        try {
          highlights.clearHighlights(previous.document)
        } catch {
          // A detached document cannot be cleaned; nothing is left to clean.
        }
      }, [])

      // The reader preloads the clipboard helper, so copying stays synchronous
      // on the gesture; the promise fallback keeps a lost preload recoverable.
      const copyText = useCallback((text) => {
        const module = clientLib('clipboard')
        if (module !== null) return module.writeClipboard(text)
        return loadClientLib(base, 'clipboard').then((loaded) => loaded.writeClipboard(text)).catch(() => false)
      }, [base])

      const metrics = useMemo(() => buildChapterMetrics(data ? data.chapters : []), [data])
      const toc = useMemo(() => {
        if (data === null) return []
        if (data.toc.length > 0) return data.toc
        return data.chapters.map((entry, index) => ({
          label: entry.label || chapterLabel(t, index),
          chapterIndex: index,
          anchor: '',
          depth: 0,
        }))
      }, [data, t])

      const saveEpubProgress = useCallback(
        (index, ratio, immediate = false) => {
          if (data === null || !readerState.loaded) return
          const safeRatio = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
          const progressKey = `${index}:${safeRatio.toFixed(5)}:${anchorRef.current || ''}`
          if (!immediate && lastSavedProgressRef.current === progressKey) return
          lastSavedProgressRef.current = progressKey
          const percent = metrics.percentFor(index, safeRatio)
          readerState.save(
            {
              progress: {
                format: 'epub',
                chapterIndex: index,
                chapterPath: data.chapters[index] ? data.chapters[index].path : '',
                scrollRatio: safeRatio,
                percent,
                anchor: anchorRef.current || '',
                updatedAt: Date.now(),
              },
            },
            immediate,
          )
        },
        [data, metrics, readerState.loaded, readerState.save],
      )

      const exitReader = useCallback(
        (percent) => {
          readerState.flush(true)
          onBack(typeof percent === 'number' ? percent : null)
        },
        [onBack, readerState.flush],
      )

      const updateSettings = useCallback(
        (patch) => {
          const next = { ...settingsRef.current, ...patch }
          settingsRef.current = next
          setSettings(next)
          readerState.save({ settings: next })
        },
        [readerState.save],
      )

      const capturePagedAnchor = useCallback(() => {
        const frame = frameRef.current
        const documentNode = frame && frame.contentDocument
        const windowNode = frame && frame.contentWindow
        if (!documentNode || !documentNode.body || !windowNode) return
        const info = pagedMetrics(documentNode, windowNode)
        if (info === null) return
        const x = info.padLeft + 3
        const y = info.padTop + 3
        let range = null
        try {
          if (typeof documentNode.caretRangeFromPoint === 'function') {
            range = documentNode.caretRangeFromPoint(x, y)
          } else if (typeof documentNode.caretPositionFromPoint === 'function') {
            const position = documentNode.caretPositionFromPoint(x, y)
            if (position && position.offsetNode) {
              range = documentNode.createRange()
              range.setStart(position.offsetNode, position.offset)
              range.collapse(true)
            }
          }
        } catch {
          range = null
        }
        if (range && range.startContainer) {
          const rect = range.getBoundingClientRect()
          if (rect.width > 0 || rect.height > 0) {
            pageAnchorRef.current = { node: range.startContainer, offset: range.startOffset }
            return
          }
        }
        const nodes = documentNode.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figure,img,table')
        for (const node of nodes) {
          const rect = node.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) continue
          if (rect.right <= 0 || rect.left >= windowNode.innerWidth || rect.bottom <= 0 || rect.top >= windowNode.innerHeight) continue
          pageAnchorRef.current = { element: node }
          return
        }
      }, [])

      const pageForAnchor = useCallback((documentNode, windowNode, info) => {
        const anchorValue = pageAnchorRef.current
        if (anchorValue === null) return null
        const body = documentNode.body
        const previous = body.scrollLeft
        body.scrollLeft = 0
        let rect = null
        try {
          if (anchorValue.node && (anchorValue.node.isConnected || documentNode.contains(anchorValue.node))) {
            const node = anchorValue.node
            const limit = node.nodeType === 3 ? node.length : node.childNodes ? node.childNodes.length : 0
            const range = documentNode.createRange()
            range.setStart(node, Math.min(Math.max(0, anchorValue.offset || 0), limit))
            range.collapse(true)
            rect = range.getBoundingClientRect()
          } else if (anchorValue.element && (anchorValue.element.isConnected || documentNode.contains(anchorValue.element))) {
            rect = anchorValue.element.getBoundingClientRect()
          }
        } catch {
          rect = null
        }
        if (rect === null || (rect.width === 0 && rect.height === 0)) {
          body.scrollLeft = previous
          pageAnchorRef.current = null
          return null
        }
        const page = Math.max(0, Math.min(info.pages - 1, Math.floor((rect.left - info.padLeft + 1) / info.step)))
        body.scrollLeft = previous
        return page
      }, [])

      const layoutPagedFrame = useCallback(
        (frame, options = {}) => {
          const documentNode = frame && frame.contentDocument
          const windowNode = frame && frame.contentWindow
          if (!documentNode || !documentNode.body || !windowNode || documentNode.URL === 'about:blank') return
          const generation = ++layoutGenerationRef.current
          // The speech band is viewport-fixed; a re-layout (page turn, resize,
          // mode switch) would leave it over different text, so drop it first.
          clearSpeechGlass(documentNode)
          ensurePagedStyle(documentNode)
          documentNode.documentElement.classList.add('bb-paged')
          configurePagedColumns(documentNode, settingsRef.current)
          const body = documentNode.body
          body.scrollLeft = 0
          const info = pagedMetrics(documentNode, windowNode)
          if (info === null) return
          let page = pageIndexRef.current
          let resolvedAnchor = null
          const targetAnchor = typeof options.targetAnchor === 'string' ? options.targetAnchor : ''
          if (targetAnchor !== '') {
            const target = documentNode.getElementById(decodeAnchor(targetAnchor))
            if (target !== null) {
              body.scrollLeft = 0
              const rect = target.getBoundingClientRect()
              resolvedAnchor = { element: target }
              page = Math.floor((rect.left - info.padLeft + 1) / info.step)
            } else if (Number.isFinite(options.targetRatio)) {
              page = Math.round(options.targetRatio * (info.pages - 1))
            }
          } else if (options.restoreAnchor) {
            const anchored = pageForAnchor(documentNode, windowNode, info)
            if (anchored !== null) page = anchored
            else if (Number.isFinite(options.targetRatio)) page = Math.round(options.targetRatio * (info.pages - 1))
            // A height-only reflow (toolbar or read-aloud bar appearing) must not
            // move the reader: a stale anchor from an earlier spread used to snap
            // the page back to the start.
            const spreadAt = (value) => Math.floor(value / info.columns)
            if (laidOutPagesRef.current === info.pages && spreadAt(page) !== spreadAt(pageIndexRef.current)) {
              page = pageIndexRef.current
            }
          } else if (Number.isFinite(options.targetRatio)) {
            page = Math.round(options.targetRatio * (info.pages - 1))
          } else if (Number.isFinite(options.targetPage)) {
            page = options.targetPage
          }
          page = Math.floor(Math.max(0, Math.min(info.pages - 1, page)) / info.columns) * info.columns
          if (info.columns === 2 && info.pages % 2 === 1) body.setAttribute('data-bb-pad-spread', '')
          body.scrollLeft = page * info.step
          setPageIndex(page)
          pageIndexRef.current = page
          setPageCount(info.pages)
          pageCountRef.current = info.pages
          laidOutPagesRef.current = info.pages
          setPageColumns(info.columns)
          pageColumnsRef.current = info.columns
          const ratio = info.pages <= 1 ? 0 : (Math.min(page + info.columns, info.pages) - 1) / (info.pages - 1)
          scrollRatioRef.current = ratio
          setScrollRatio(ratio)
          // Keep the same reading anchor throughout successive reflows. Taking
          // the new page's first word after every resize drifts backwards as
          // line breaks change, even though each individual restore looks valid.
          if (resolvedAnchor) {
            pageAnchorRef.current = resolvedAnchor
          } else if (!options.restoreAnchor || pageAnchorRef.current === null) {
            pageAnchorRef.current = null
            // Capture right away: a scheduled capture loses to the next layout
            // call and leaves a stale anchor from the previous spread.
            if (generation === layoutGenerationRef.current) capturePagedAnchor()
          }
          if (options.save && generation === layoutGenerationRef.current) {
            saveEpubProgress(chapterRef.current, ratio)
          }
          // A reflow keeps the Range objects valid, but the overlay fallback
          // band is viewport-fixed and a repaint keeps both layers in step with
          // the new column geometry.
          if (generation === layoutGenerationRef.current) repaintHighlights(documentNode)
        },
        [capturePagedAnchor, pageForAnchor, repaintHighlights, saveEpubProgress],
      )

      useEffect(() => {
        chapterRef.current = chapter
      }, [chapter])

      useEffect(() => {
        if (!readerState.loaded) return undefined
        let cancelled = false
        setStatus('loading')
        setError('')
        setData(null)
        setEpubModule(null)
        setSnapshotModule(null)
        setSnapshotLoadError('')
        setChapter(0)
        setAnchor('')
        setScrollRatio(0)
        setAsideTab('toc')
        setPageIndex(0)
        setPageCount(1)
        pageIndexRef.current = 0
        pageCountRef.current = 1
        pageAnchorRef.current = null
        scrollRatioRef.current = 0
        pendingScrollRef.current = 0
        anchorRef.current = ''
        chapterRef.current = 0
        restoringRef.current = false
        imageCacheRef.current.clear()
        frameTokenRef.current += 1
        ;(async () => {
          try {
            const [module, snapshotSupport] = await Promise.all([
              loadEpubModule(base),
              loadReadingSnapshot(base).catch(failure => {
                if (!cancelled) setSnapshotLoadError(failure instanceof Error ? failure.message : String(failure))
                return null
              }),
              loadReadingFonts(base),
              // Warm the shared browser modules before the reader renders.
              preloadClientLibs(base),
            ])
            const response = await fetch(resourceUrl(base, `${API_ROOT}/books/${book.id}/file`))
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const bytes = new Uint8Array(await response.arrayBuffer())
            if (cancelled) return
            const parsed = module.parseEpub(bytes)
            parsed.sourceRevision = response.headers.get('X-Bookshelf-Source-Revision') || ''
            if (cancelled) return
            setSnapshotModule(snapshotSupport)
            const storedSettings = readerState.stateRef.current && readerState.stateRef.current.settings
            const stored = storedSettings && typeof storedSettings === 'object' && !Array.isArray(storedSettings) ? storedSettings : {}
            const nextSettings = {
              ...DEFAULT_READING_SETTINGS,
              ...(defaultSettings || {}),
              ...stored,
            }
            // An old per-book preset is an explicit override, including when
            // a newer global default now selects a named font or font style.
            if (typeof stored.fontFamily === 'string' && typeof stored.fontName !== 'string') {
              nextSettings.fontName = ''
              nextSettings.fontWeight = 0
              nextSettings.fontStyle = 'normal'
            }
            if (typeof stored.pageMargin !== 'string' && typeof stored.readingWidth === 'string') {
              nextSettings.pageMargin = stored.readingWidth === 'wide' ? 'compact' : 'standard'
            }
            if (nextSettings.theme === 'sepia') nextSettings.theme = 'auto'
            // The annotations module is preloaded by now, so the stored style is
            // normalised against DEFAULT_ANNOTATION_STYLE instead of trusting a
            // hand-edited state.json.
            const loadedAnnotationStyle = normalizeAnnotationStyleValue(nextSettings.annotationStyle)
            nextSettings.annotationStyle = loadedAnnotationStyle
            annotationStyleRef.current = loadedAnnotationStyle
            setAnnotationStyle(loadedAnnotationStyle)
            settingsRef.current = nextSettings
            // Loading stored settings is initialization, not a user mode switch.
            previousModeRef.current = nextSettings.pageMode
            setSettings(nextSettings)
            const saved = readerState.stateRef.current && readerState.stateRef.current.progress
            const savedValid =
              saved &&
              saved.format === 'epub' &&
              Number.isInteger(saved.chapterIndex) &&
              saved.chapterIndex >= 0 &&
              saved.chapterIndex < parsed.chapters.length
            let startChapter = 0
            let startAnchor = ''
            let startScroll = 0
            if (savedValid) {
              startChapter = saved.chapterIndex
              startAnchor = typeof saved.anchor === 'string' ? saved.anchor : ''
              startScroll = Math.min(1, Math.max(0, Number(saved.scrollRatio) || 0))
            } else if (!chapterHasVisibleContent(parsed.chapters[0] && parsed.chapters[0].html)) {
              const candidate = parsed.toc.find((entry) => entry.chapterIndex > 0 && chapterHasVisibleContent(parsed.chapters[entry.chapterIndex] && parsed.chapters[entry.chapterIndex].html))
              if (candidate !== undefined) {
                startChapter = candidate.chapterIndex
                startAnchor = candidate.anchor || ''
              } else {
                const firstContent = parsed.chapters.findIndex((entry) => chapterHasVisibleContent(entry.html))
                if (firstContent > 0) startChapter = firstContent
              }
            }
            chapterRef.current = startChapter
            anchorRef.current = startAnchor
            pendingScrollRef.current = startScroll
            scrollRatioRef.current = startScroll
            restoringRef.current = Boolean(savedValid) || startAnchor !== '' || startScroll > 0
            setChapter(startChapter)
            setAnchor(startAnchor)
            setScrollRatio(startScroll)
            setEpubModule(module)
            setData(parsed)
            setStatus('ready')
          } catch (failure) {
            if (!cancelled) {
              setError(failure instanceof Error ? failure.message : String(failure))
              setStatus('error')
            }
          }
        })()
        return () => {
          cancelled = true
        }
      }, [readerState.loaded, base, book.id, attempt, t])

      useEffect(
        () => () => {
          if (scrollBindingRef.current) {
            scrollBindingRef.current()
            scrollBindingRef.current = null
          }
          // Leaving the chapter (or the reader) must not leave the previous
          // document's highlight layers registered on its window.
          clearDisplayedHighlights()
        },
        [chapter, clearDisplayedHighlights],
      )

      const resourceIndex = useMemo(() => {
        const index = new Map()
        if (data === null) return index
        for (const path of Object.keys(data.resources)) index.set(path.toLowerCase(), path)
        data.chapters.forEach((entry, position) => index.set(`chapter:${entry.path.toLowerCase()}`, position))
        return index
      }, [data])

      const chapterHtml = useMemo(() => {
        if (data === null || epubModule === null) return ''
        try {
          return epubModule.renderChapterHtml({
            data,
            chapterIndex: chapter,
            resourceIndex,
            imageCache: imageCacheRef.current,
            readingCss: READING_CSS,
            tooLargeText: t('chapterTooLarge'),
          })
        } catch (failure) {
          return `<!doctype html><html><head><meta charset="utf-8"><style>${READING_CSS}</style></head><body><p>${escapeHtml(failure instanceof Error ? failure.message : String(failure))}</p></body></html>`
        }
      }, [data, epubModule, chapter, resourceIndex, t])

      const goTo = useCallback(
        (index, targetAnchor, targetRatio) => {
          if (data === null) return
          const safeIndex = Math.min(data.chapters.length - 1, Math.max(0, Number(index) || 0))
          const nextAnchor = typeof targetAnchor === 'string' ? targetAnchor : ''
          const nextRatio = Math.min(1, Math.max(0, Number.isFinite(targetRatio) ? targetRatio : 0))
          anchorRef.current = nextAnchor
          if (settingsRef.current.pageMode === 'paged') {
            if (safeIndex === chapterRef.current && frameRef.current !== null) {
              layoutPagedFrame(frameRef.current, { targetAnchor: nextAnchor, targetRatio: nextRatio, save: true })
              setAnchor(nextAnchor)
              return
            }
            chapterRef.current = safeIndex
            pendingScrollRef.current = nextRatio
            restoringRef.current = false
            pageAnchorRef.current = null
            setPageIndex(0)
            pageIndexRef.current = 0
            setPageCount(1)
            pageCountRef.current = 1
            setAnchor(nextAnchor)
            setChapter(safeIndex)
            setScrollRatio(nextRatio)
            scrollRatioRef.current = nextRatio
            saveEpubProgress(safeIndex, nextRatio)
            return
          }
          if (safeIndex === chapterRef.current) {
            const frame = frameRef.current
            const documentNode = frame && frame.contentDocument
            const windowNode = frame && frame.contentWindow
            if (documentNode && windowNode) {
              restoringRef.current = true
              if (nextAnchor !== '') {
                const target = documentNode.getElementById(decodeAnchor(nextAnchor))
                if (target) {
                  try {
                    target.scrollIntoView({ block: 'start' })
                  } catch {
                    // Detached by a later chapter change.
                  }
                }
              } else {
                const root = documentNode.scrollingElement || documentNode.documentElement
                if (root) {
                  const maximum = Math.max(0, root.scrollHeight - windowNode.innerHeight)
                  windowNode.scrollTo(0, maximum * nextRatio)
                }
              }
              setAnchor(nextAnchor)
              setScrollRatio(nextRatio)
              scrollRatioRef.current = nextRatio
              requestAnimationFrame(() => {
                const actual = frameScrollRatio(frame)
                restoringRef.current = false
                scrollRatioRef.current = actual
                setScrollRatio(actual)
                saveEpubProgress(safeIndex, actual)
              })
              return
            }
          }
          chapterRef.current = safeIndex
          pendingScrollRef.current = nextRatio
          restoringRef.current = true
          setAnchor(nextAnchor)
          setChapter(safeIndex)
          setScrollRatio(nextRatio)
          scrollRatioRef.current = nextRatio
          saveEpubProgress(safeIndex, nextRatio)
        },
        [data, layoutPagedFrame, saveEpubProgress],
      )

      const turnPage = useCallback(
        (direction) => {
          if (settingsRef.current.pageMode !== 'paged' || data === null) return
          const frame = frameRef.current
          if (frame === null) return
          const page = pageIndexRef.current
          const pages = pageCountRef.current
          const columns = pageColumnsRef.current
          if (direction < 0) {
            if (page > 0) {
              anchorRef.current = ''
              layoutPagedFrame(frame, { targetPage: page - columns, save: true })
              return
            }
            if (chapterRef.current > 0) {
              anchorRef.current = ''
              goTo(chapterRef.current - 1, '', 1)
            }
            return
          }
          if (page + columns < pages) {
            anchorRef.current = ''
            layoutPagedFrame(frame, { targetPage: page + columns, save: true })
            return
          }
          if (chapterRef.current < data.chapters.length - 1) {
            anchorRef.current = ''
            goTo(chapterRef.current + 1, '', 0)
          }
        },
        [data, goTo, layoutPagedFrame],
      )

      useEffect(() => {
        turnPageRef.current = turnPage
      }, [turnPage])

      // The selection menu belongs to one place in one chapter; moving away or
      // clicking elsewhere retires it.
      useEffect(() => {
        setSelectionMenu(null)
      }, [chapter, pageIndex])

      useEffect(() => {
        if (selectionMenu === null) return undefined
        const close = (event) => {
          if (event && event.target && typeof event.target.closest === 'function' && event.target.closest('.bs-selection-menu') !== null) return
          setSelectionMenu(null)
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          // Dismissing this menu must not also trigger the shell-level Escape
          // action (leaving the book), so the event stops here.
          event.preventDefault()
          event.stopPropagation()
          setSelectionMenu(null)
        }
        document.addEventListener('mousedown', close, true)
        document.addEventListener('keydown', onKey)
        window.addEventListener('resize', close)
        return () => {
          document.removeEventListener('mousedown', close, true)
          document.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', close)
        }
      }, [selectionMenu])

      // The annotation style popover is transient too: Escape closes it without
      // leaving the book.
      useEffect(() => {
        if (!annotationOpen) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setAnnotationOpen(false)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [annotationOpen])

      const onFrameLoad = useCallback(() => {
        const frame = frameRef.current
        const documentNode = frame && frame.contentDocument
        const windowNode = frame && frame.contentWindow
        if (!documentNode || !windowNode) return
        // A chapter swap replaces the frame document: the previous document's
        // ::highlight() rules and registry entries would otherwise leak.
        clearDisplayedHighlights()
        paintFrame(documentNode, settingsRef.current)
        wrapTables(documentNode)
        displayedChapterRef.current = { document: documentNode, chapter: chapterRef.current }
        // Paint the chapter's annotations before the first sentence arrives.
        repaintHighlights(documentNode)
        if (typeof documentNode.__bsBound !== 'boolean') {
          documentNode.__bsBound = true
          documentNode.addEventListener('click', (event) => {
            setSelectionMenu((current) => (current === null ? current : null))
            const target = event.target
            const link = target && typeof target.closest === 'function' ? target.closest('a') : null
            if (!link) return
            const chapterValue = link.getAttribute('data-bb-chapter')
            if (chapterValue !== null) {
              event.preventDefault()
              goTo(Number(chapterValue) || 0, link.getAttribute('data-bb-anchor') || '', 0)
              return
            }
            const hrefValue = link.getAttribute('href') || ''
            if (hrefValue.startsWith('#')) {
              event.preventDefault()
              let id = hrefValue.slice(1)
              try { id = decodeURIComponent(id) } catch { /* keep the literal id */ }
              if (id === '') return
              anchorRef.current = id
              const currentFrame = frameRef.current
              if (settingsRef.current.pageMode === 'paged' && currentFrame !== null) {
                layoutPagedFrame(currentFrame, { targetAnchor: id, save: true })
              } else {
                const target = documentNode.getElementById(id)
                if (target) {
                  try { target.scrollIntoView({ block: 'start' }) } catch { /* detached */ }
                }
              }
              return
            }
            if (link.getAttribute('data-bb-external') === 'true') {
              event.preventDefault()
              const href = link.getAttribute('href')
              if (href) window.open(href, '_blank', 'noopener,noreferrer')
            }
          })
          // A selection gets the reader's own menu: the desktop menu only knows
          // Copy, and the extra actions need the chapter text and read-aloud.
          documentNode.addEventListener('contextmenu', (event) => {
            const selection = typeof windowNode.getSelection === 'function' ? windowNode.getSelection() : null
            const text = selection === null ? '' : String(selection).trim()
            if (text === '') {
              setSelectionMenu((current) => (current === null ? current : null))
              return
            }
            event.preventDefault()
            // Capture the anchor while the selection is still live: the menu
            // click must not depend on the iframe selection surviving the click.
            const anchor = annotationAnchorForSelection(documentNode, selection, chapterRef.current)
            const liveFrame = frameRef.current
            const host = menuHostRef.current
            const frameRect = liveFrame === null ? null : liveFrame.getBoundingClientRect()
            const hostRect = host === null ? null : host.getBoundingClientRect()
            if (frameRect === null || hostRect === null) {
              setSelectionMenu({ text, anchor, x: 12, y: 12 })
              return
            }
            // Anchor the menu at the pointer, not at the sentence: the user
            // right-clicked a specific place and expects the menu there.
            setSelectionMenu({
              text,
              anchor,
              x: Math.round(frameRect.left - hostRect.left + event.clientX),
              y: Math.round(frameRect.top - hostRect.top + event.clientY),
            })
          })
        }
        documentNode.addEventListener('keydown', (event) => {
          if (settingsRef.current.pageMode !== 'paged' || event.defaultPrevented) return
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault()
            turnPageRef.current(-1)
          } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            event.preventDefault()
            turnPageRef.current(1)
          }
        })
        if (scrollBindingRef.current) {
          scrollBindingRef.current()
          scrollBindingRef.current = null
        }
        const token = frameTokenRef.current
        const boundChapter = chapterRef.current
        let lastRatio = scrollRatioRef.current
        let frameRequest = 0
        let saveTimer = 0
        let glassTimer = 0
        const onScroll = () => {
          setSelectionMenu((current) => (current === null ? current : null))
          if (restoringRef.current || settingsRef.current.pageMode === 'paged') return
          anchorRef.current = ''
          // The glass bands are viewport-fixed, so a manual scroll leaves them
          // behind; follow the sentence once the scroll settles.
          if (glassTimer !== 0) clearTimeout(glassTimer)
          glassTimer = setTimeout(() => {
            glassTimer = 0
            const range = speechRangeRef.current
            // Only the overlay fallback needs the fixed-position band; with the
            // CSS Custom Highlight API the inversion follows the text natively.
            if (highlightFallbackRef.current && range !== null && documentNode.contains(range.startContainer)) {
              paintSpeechGlass(documentNode, range)
            }
          }, 140)
          if (frameRequest !== 0) return
          frameRequest = requestAnimationFrame(() => {
            frameRequest = 0
            const ratio = frameScrollRatio(frame)
            lastRatio = ratio
            scrollRatioRef.current = ratio
            setScrollRatio((value) => (Math.abs(value - ratio) < 0.002 ? value : ratio))
            if (saveTimer !== 0) clearTimeout(saveTimer)
            saveTimer = setTimeout(() => {
              saveTimer = 0
              saveEpubProgress(chapterRef.current, scrollRatioRef.current)
            }, 650)
          })
        }
        windowNode.addEventListener('scroll', onScroll, { passive: true })
        scrollBindingRef.current = () => {
          windowNode.removeEventListener('scroll', onScroll)
          if (frameRequest !== 0) cancelAnimationFrame(frameRequest)
          if (saveTimer !== 0) clearTimeout(saveTimer)
          if (glassTimer !== 0) clearTimeout(glassTimer)
          if (!restoringRef.current && chapterRef.current === boundChapter) {
            saveEpubProgress(
              boundChapter,
              settingsRef.current.pageMode === 'paged' ? scrollRatioRef.current : lastRatio,
              true,
            )
          }
        }
        if (settingsRef.current.pageMode === 'paged') {
          restoringRef.current = false
          layoutPagedFrame(frame, {
            targetAnchor: anchorRef.current,
            targetRatio: pendingScrollRef.current,
            save: true,
          })
          const refresh = () => {
            if (settingsRef.current.pageMode === 'paged' && frame.contentDocument === documentNode) {
              layoutPagedFrame(frame, { restoreAnchor: true, save: true })
              if (highlightFallbackRef.current) {
                const range = speechRangeRef.current
                if (range !== null && documentNode.contains(range.startContainer)) paintSpeechGlass(documentNode, range)
              }
            }
          }
          if (documentNode.fonts && documentNode.fonts.ready) {
            documentNode.fonts.ready.then(refresh).catch(() => undefined)
          }
          for (const image of documentNode.querySelectorAll('img')) {
            if (!image.complete) image.addEventListener('load', refresh, { once: true })
          }
          const settleTimer = setTimeout(refresh, 280)
          let pagedResizeTimer = 0
          let pagedObserver = null
          const schedulePagedResize = () => {
            if (settingsRef.current.pageMode !== 'paged') return
            if (pagedResizeTimer !== 0) clearTimeout(pagedResizeTimer)
            pagedResizeTimer = setTimeout(() => {
              pagedResizeTimer = 0
              if (settingsRef.current.pageMode === 'paged' && frame.contentDocument === documentNode) {
                layoutPagedFrame(frame, { restoreAnchor: true, save: true })
              }
            }, 150)
          }
          if (typeof ResizeObserver !== 'undefined') {
            pagedObserver = new ResizeObserver(schedulePagedResize)
            pagedObserver.observe(documentNode.documentElement)
          }
          windowNode.addEventListener('resize', schedulePagedResize)
          const previousBinding = scrollBindingRef.current
          scrollBindingRef.current = () => {
            previousBinding()
            clearTimeout(settleTimer)
            if (pagedResizeTimer !== 0) clearTimeout(pagedResizeTimer)
            if (pagedObserver !== null) pagedObserver.disconnect()
            windowNode.removeEventListener('resize', schedulePagedResize)
          }
          return
        }
        const targetAnchor = anchorRef.current
        const targetRatio = pendingScrollRef.current
        const apply = () => {
          if (frameTokenRef.current !== token) return
          const currentDocument = frame.contentDocument
          const currentWindow = frame.contentWindow
          if (!currentDocument || !currentWindow) return
          if (targetAnchor !== '') {
            const target = currentDocument.getElementById(decodeAnchor(targetAnchor))
            if (target) {
              try {
                target.scrollIntoView({ block: 'start' })
              } catch {
                // The document changed again.
              }
            }
          } else {
            const root = currentDocument.scrollingElement || currentDocument.documentElement
            if (root) {
              const maximum = Math.max(0, root.scrollHeight - currentWindow.innerHeight)
              currentWindow.scrollTo(0, maximum * targetRatio)
            }
          }
        }
        restoringRef.current = targetAnchor !== '' || targetRatio > 0
        apply()
        const retry = setTimeout(apply, 140)
        const settle = setTimeout(() => {
          if (frameTokenRef.current !== token) return
          restoringRef.current = false
          const ratio = frameScrollRatio(frame)
          lastRatio = ratio
          scrollRatioRef.current = ratio
          setScrollRatio(ratio)
          saveEpubProgress(chapterRef.current, ratio)
        }, 380)
        const previousBinding = scrollBindingRef.current
        scrollBindingRef.current = () => {
          previousBinding()
          clearTimeout(retry)
          clearTimeout(settle)
        }
      }, [clearDisplayedHighlights, goTo, layoutPagedFrame, repaintHighlights, saveEpubProgress])

      useEffect(() => {
        const previousMode = previousModeRef.current
        previousModeRef.current = settings.pageMode
        const frame = frameRef.current
        const documentNode = frame && frame.contentDocument
        if (!documentNode) return
        paintFrame(documentNode, settings)
        // A font, size or theme change moves the glyphs; the plan depends on the
        // palette, so both highlight layers are rebuilt here.
        repaintHighlights(documentNode)
        if (settings.pageMode === 'paged') {
          if (previousMode === 'paged') {
            layoutPagedFrame(frame, { restoreAnchor: true, save: true })
          } else {
            pageAnchorRef.current = null
            layoutPagedFrame(frame, { targetRatio: scrollRatioRef.current, save: true })
          }
          let cancelled = false
          if (documentNode.fonts?.ready) documentNode.fonts.ready.then(() => {
            if (!cancelled && frame.contentDocument === documentNode && settingsRef.current.pageMode === 'paged') layoutPagedFrame(frame, { restoreAnchor: true, save: true })
          }).catch(() => undefined)
          return () => { cancelled = true }
        }
        if (previousMode === 'paged') {
          clearPagedLayout(documentNode)
          if (documentNode.body) documentNode.body.scrollLeft = 0
          const ratio = scrollRatioRef.current
          const windowNode = frame.contentWindow
          const root = documentNode.scrollingElement || documentNode.documentElement
          if (windowNode && root) {
            const maximum = Math.max(0, root.scrollHeight - windowNode.innerHeight)
            windowNode.scrollTo(0, maximum * ratio)
          }
          pageAnchorRef.current = null
          setPageIndex(0)
          pageIndexRef.current = 0
          setPageCount(1)
          pageCountRef.current = 1
          anchorRef.current = ''
          scrollRatioRef.current = ratio
          setScrollRatio(ratio)
          saveEpubProgress(chapterRef.current, ratio)
        }
      }, [settings, themeTick, layoutPagedFrame, repaintHighlights, saveEpubProgress])

      // Creating or deleting an annotation must repaint without a page turn.
      // The array identity only changes when the Host state actually stores a
      // new annotation list, so progress saves do not trigger a repaint.
      const annotationList = readerState.state !== null && Array.isArray(readerState.state.annotations) ? readerState.state.annotations : null
      useEffect(() => {
        const frame = frameRef.current
        const documentNode = frame && frame.contentDocument
        if (documentNode) repaintHighlights(documentNode)
      }, [annotationList, repaintHighlights])

      useEffect(() => {
        if (settings.pageMode !== 'paged' || status !== 'ready') return undefined
        const node = frameWrapRef.current
        if (node === null || typeof ResizeObserver === 'undefined') return undefined
        let timer = 0
        const observer = new ResizeObserver(() => {
          if (timer !== 0) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = 0
            const frame = frameRef.current
            if (frame !== null && settingsRef.current.pageMode === 'paged') {
              layoutPagedFrame(frame, { restoreAnchor: true, save: true })
            }
          }, 160)
        })
        observer.observe(node)
        return () => {
          observer.disconnect()
          if (timer !== 0) clearTimeout(timer)
        }
      }, [settings.pageMode, status, layoutPagedFrame])

      useEffect(() => {
        if (settings.pageMode !== 'paged' || status !== 'ready') return undefined
        const timer = setTimeout(() => {
          const frame = frameRef.current
          if (frame !== null && settingsRef.current.pageMode === 'paged') {
            layoutPagedFrame(frame, { restoreAnchor: true, save: true })
          }
        }, 180)
        return () => clearTimeout(timer)
      }, [tocOpen, settings.pageMode, status, layoutPagedFrame])

      useEffect(() => {
        if (status !== 'ready') return undefined
        const frame = frameRef.current
        if (frame === null) return undefined
        const measure = () => {
          setFrameSize((previous) => {
            const { width, height } = frame.getBoundingClientRect()
            return previous.width === width && previous.height === height ? previous : { width, height }
          })
        }
        measure()
        if (typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(measure)
        observer.observe(frame)
        return () => observer.disconnect()
      }, [status, chapter, settings.pageMode])

      useEffect(() => {
        if (
          settings.pageMode !== 'paged' ||
          status !== 'ready' ||
          data === null ||
          epubModule === null ||
          frameSize.width <= 0 ||
          frameSize.height <= 0
        ) {
          setBookPageCounts(null)
          return undefined
        }
        const probe = probeFrameRef.current
        if (probe === null) return undefined
        probe.style.width = `${frameSize.width}px`
        probe.style.height = `${frameSize.height}px`
        const token = ++probeTokenRef.current
        // Keep the last complete count while measuring its replacement. Switching
        // to chapter-only labels can wrap a narrow toolbar, resize the frame,
        // and restart measurement indefinitely. Initial/mode changes reset above.
        let cancelled = false
        let index = 0
        const counts = []
        const measureChapter = () => {
          if (cancelled || token !== probeTokenRef.current) return
          if (index >= data.chapters.length) {
            if (token === probeTokenRef.current) setBookPageCounts(counts.slice())
            return
          }
          let html = ''
          try {
            html = epubModule.renderChapterHtml({
              data,
              chapterIndex: index,
              resourceIndex,
              imageCache: imageCacheRef.current,
              readingCss: READING_CSS,
              tooLargeText: t('chapterTooLarge'),
            })
          } catch {
            html = '<!doctype html><html><body></body></html>'
          }
          probe.onload = async () => {
            if (cancelled || token !== probeTokenRef.current) return
            const documentNode = probe.contentDocument
            const windowNode = probe.contentWindow
            let pages = 1
            try {
              if (documentNode && windowNode && documentNode.body) {
                paintFrame(documentNode, settingsRef.current)
                wrapTables(documentNode)
                ensurePagedStyle(documentNode)
                documentNode.documentElement.classList.add('bb-paged')
                configurePagedColumns(documentNode, settingsRef.current)
                // Match visible-frame pagination after font metrics and layout
                // have settled, including newly selected native font faces.
                if (documentNode.fonts) await documentNode.fonts.ready
                await new Promise(resolve => requestAnimationFrame(resolve))
                if (cancelled || token !== probeTokenRef.current || probe.contentDocument !== documentNode) return
                configurePagedColumns(documentNode, settingsRef.current)
                const info = pagedMetrics(documentNode, windowNode)
                if (info !== null) pages = info.pages
              }
            } catch {
              pages = 1
            }
            if (cancelled || token !== probeTokenRef.current) return
            counts.push(pages)
            index += 1
            setTimeout(measureChapter, 0)
          }
          probe.srcdoc = html
        }
        measureChapter()
        return () => {
          cancelled = true
          probe.onload = null
        }
      }, [settings, status, data, epubModule, resourceIndex, frameSize.width, frameSize.height, t])

      const percent = data === null ? 0 : metrics.percentFor(chapter, scrollRatio)
      const bookmarks = readerState.state && Array.isArray(readerState.state.bookmarks) ? readerState.state.bookmarks : []
      const annotations = readerState.state && Array.isArray(readerState.state.annotations) ? readerState.state.annotations : []
      const currentRatio = scrollRatioRef.current
      const currentBookmark = bookmarks.find((bookmark) => {
        if (bookmark.format !== 'epub' || bookmark.chapterIndex !== chapter) return false
        if (settings.pageMode !== 'paged') return Math.abs((Number(bookmark.scrollRatio) || 0) - currentRatio) < 0.02
        if (bookmark.anchor && bookmark.anchor === anchorRef.current) return true
        const target = Math.round(Math.min(1, Math.max(0, Number(bookmark.scrollRatio) || 0)) * (pageCount - 1))
        return Math.floor(target / pageColumns) * pageColumns === pageIndex
      })
      const chapterTocLabel = (() => {
        const entry = toc.find((item) => item.chapterIndex === chapter && !item.anchor) || toc.find((item) => item.chapterIndex === chapter)
        return entry ? entry.label : chapterLabel(t, chapter)
      })()

      const toggleBookmark = useCallback(() => {
        if (status !== 'ready') return
        if (currentBookmark) {
          readerState.save({ bookmarks: bookmarks.filter((bookmark) => bookmark.id !== currentBookmark.id) }, true)
          return
        }
        const ratio = Math.min(1, Math.max(0, scrollRatioRef.current))
        const bookmarkPercent = metrics.percentFor(chapter, ratio)
        const label = `${chapterTocLabel} · ${Math.round(bookmarkPercent * 100)}%`
        const bookmark = {
          id: newBookmarkId(),
          label,
          format: 'epub',
          chapterIndex: chapter,
          scrollRatio: ratio,
          anchor: anchorRef.current || '',
          percent: bookmarkPercent,
          createdAt: Date.now(),
        }
        readerState.save({ bookmarks: [bookmark, ...bookmarks].slice(0, 500) }, true)
        setAsideTab('bookmarks')
      }, [bookmarks, chapter, chapterTocLabel, currentBookmark, metrics, readerState.save, status])

      // Style edits save the whole settings object (state.settings.annotationStyle
      // is additive on the Host) without replacing the reader settings state, so
      // dragging a slider never triggers the paged layout effect.
      const saveAnnotationStyle = useCallback((patch) => {
        const next = normalizeAnnotationStyleValue({ ...annotationStyleRef.current, ...patch })
        annotationStyleRef.current = next
        setAnnotationStyle(next)
        settingsRef.current = { ...settingsRef.current, annotationStyle: next }
        readerState.save({ settings: settingsRef.current })
      }, [readerState.save])

      // Create the annotation from the context-menu selection with the current
      // style. fromSelection() returns null for a selection that could not be
      // anchored: the menu disables those actions, so this is a last guard.
      // `hasSameAnchor` replaces an annotation of the same type on the exact
      // same span instead of stacking duplicates (§4.1).
      const createAnnotation = useCallback((type) => {
        const module = clientLib('annotations')
        if (module === null || selectionMenu === null || !selectionMenu.anchor) return
        const style = { ...annotationStyleRef.current, mode: type }
        const annotation = module.fromSelection({ ...selectionMenu.anchor, style })
        if (annotation === null) return
        const current = readerState.stateRef.current && Array.isArray(readerState.stateRef.current.annotations)
          ? readerState.stateRef.current.annotations
          : []
        const next = [annotation, ...current.filter((item) => !module.hasSameAnchor(item, annotation))].slice(0, 1000)
        readerState.save({ annotations: next }, true)
      }, [readerState, selectionMenu])

      const onSeekProgress = useCallback(
        (value) => {
          if (data === null) return
          const target = metrics.chapterAt(value)
          goTo(target.index, '', target.ratio)
        },
        [data, goTo, metrics],
      )

      useEffect(() => {
        if (settings.pageMode !== 'paged' || status !== 'ready') return undefined
        const onKeyDown = (event) => {
          if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
          const target = event.target
          if (
            target &&
            typeof target.closest === 'function' &&
            target.closest('input,textarea,select,button,[contenteditable="true"],.bs-apple-dialog,.bs-rename-dialog,.bs-reader-settings')
          ) {
            return
          }
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault()
            turnPage(-1)
          } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            event.preventDefault()
            turnPage(1)
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [settings.pageMode, status, turnPage])

      const paged = settings.pageMode === 'paged' && status === 'ready' && data !== null
      const currentPageLabel = (() => {
        if (data === null) return ''
        if (!paged) return t('chapterOf', { current: chapter + 1, total: data.chapters.length })
        const complete = Array.isArray(bookPageCounts) && bookPageCounts.length === data.chapters.length && bookPageCounts.every(value => Number.isInteger(value) && value > 0)
        const end = Math.min(pageIndex + pageColumns, pageCount)
        if (!complete) return end > pageIndex + 1
          ? t('pageRangeOfChapter', { current: pageIndex + 1, end, total: Math.max(1, pageCount) })
          : t('pageOfChapter', { current: pageIndex + 1, total: Math.max(1, pageCount) })
        const before = bookPageCounts.slice(0, Math.min(chapter, bookPageCounts.length)).reduce((sum, value) => sum + value, 0)
        const total = bookPageCounts.reduce((sum, value) => sum + value, 0)
        return end > pageIndex + 1
          ? t('pageRangeOf', { current: before + pageIndex + 1, end: before + end, total })
          : t('pageOf', { current: before + pageIndex + 1, total })
      })()
      const closeDiscussion = () => { discussionClickRef.current = false; setDiscussionState(null) }
      const discussPage = () => {
        if (discussionClickRef.current) return
        discussionClickRef.current = true
        const pending = discussion?.bridge?.pending
        if (pending) { setDiscussionState({ snapshot: pending.snapshot, captureError: '' }); return }
        try {
          if (!data?.sourceRevision) throw new Error(t('discussionSourceUnavailable'))
          if (!snapshotModule) throw new Error(t('discussionCaptureUnavailable', { message: snapshotLoadError || t('discussionUnavailable') }))
          const doc = frameRef.current?.contentDocument
          const entry = data.chapters[chapter]
          if (!doc?.body || !entry || restoringRef.current || displayedChapterRef.current?.document !== doc || displayedChapterRef.current?.chapter !== chapter) throw new Error(t('discussionPageNotReady'))
          // Capture synchronously, before showing a dialog or awaiting a workspace.
          // The snapshot module returns frozen nested JSON; the id seals this click.
          const captureInput = {
            document: doc,
            book: { id: book.id, title: book.title || data.title || '', author: book.author || data.author || '' },
            chapter: { path: entry.path, label: entry.label || chapterLabel(t, chapter) },
            sourceRevision: data.sourceRevision,
            pageMode: settings.pageMode,
            pageLabel: currentPageLabel,
          }
          const snapshotId = crypto.randomUUID()
          let captured = snapshotModule.captureReadingSnapshot(captureInput)
          let snapshot = Object.freeze({ ...captured, snapshotId })
          const encoder = new TextEncoder()
          const maximum = 256 * 1024
          if (encoder.encode(JSON.stringify(snapshot)).length > maximum) {
            // Reserve room for our identity without editing exact text segments.
            // This bounded second capture is synchronous in the same click/layout.
            captured = snapshotModule.captureReadingSnapshot({ ...captureInput, maxCharacters: 4000 })
            snapshot = Object.freeze({ ...captured, snapshotId })
          }
          if (encoder.encode(JSON.stringify(snapshot)).length > maximum) throw new Error(t('discussionTooLarge'))
          const preferred = typeof discussionWorkspace === 'string' ? discussionWorkspace : ''
          const presetExists = preferred !== '' && Array.isArray(workspaces) && workspaces.some((item) => item && item.workspaceId === preferred)
          if (presetExists && discussion && typeof discussion.start === 'function') {
            setDiscussionState(null)
            setDirectBusy(true)
            discussion.start({ workspaceId: preferred, snapshot }).then((outcome) => {
              setDirectBusy(false)
              if (!outcome?.opened) setDiscussionState({ snapshot, captureError: '', completed: true })
            }, (failure) => {
              setDirectBusy(false)
              setDiscussionState({ snapshot, captureError: '', startError: failure instanceof Error ? failure.message : String(failure) })
            })
            return
          }
          setDiscussionState({ snapshot, captureError: '' })
        } catch (failure) {
          setDiscussionState({ snapshot: null, captureError: failure instanceof Error ? failure.message : String(failure) })
        }
      }
      const controls = []
      controls.push(h('button', { key: 'discuss', type: 'button', className: 'bs-text-button', onClick: discussPage, disabled: status !== 'ready' || directBusy, title: t('discussPage'), 'aria-label': t('discussPage'), 'aria-haspopup': 'dialog' }, directBusy ? t('discussionCreating') : t('discussPage')))
      controls.push(
        h(
          'button',
          {
            key: 'toc',
            type: 'button',
            className: 'bs-icon-button',
            onClick: () => setTocOpen((value) => !value),
            'aria-pressed': tocOpen,
            title: t('toc'),
            'aria-label': t('toc'),
          },
          h(ListIcon),
        ),
      )
      controls.push(
        h(
          'button',
          {
            key: 'bookmark',
            type: 'button',
            className: 'bs-icon-button',
            onClick: toggleBookmark,
            'aria-pressed': Boolean(currentBookmark),
            disabled: status !== 'ready',
            title: currentBookmark ? t('removeBookmark') : t('addBookmark'),
            'aria-label': currentBookmark ? t('removeBookmark') : t('addBookmark'),
          },
          h(BookmarkIcon, { filled: Boolean(currentBookmark) }),
        ),
      )
      // Annotation style button, directly right of the bookmark button (§5).
      controls.push(
        h(
          'button',
          {
            key: 'annotation',
            type: 'button',
            className: 'bs-icon-button',
            onClick: () => {
              setSelectionMenu(null)
              setSettingsOpen(false)
              setAnnotationOpen((value) => !value)
            },
            'aria-pressed': annotationOpen,
            'aria-expanded': annotationOpen,
            disabled: status !== 'ready' || clientLib('annotations') === null,
            title: t('annotationStyle'),
            'aria-label': t('annotationStyle'),
          },
          h(MarkerIcon),
        ),
      )
      controls.push(h('span', { key: 'div1', className: 'bs-divider' }))
      controls.push(
        h(
          'button',
          {
            key: 'settings',
            type: 'button',
            className: 'bs-text-button',
            onClick: () => {
              setAnnotationOpen(false)
              setSettingsOpen((value) => !value)
            },
            'aria-expanded': settingsOpen,
            'aria-pressed': settingsOpen,
            title: t('readingSettings'),
            'aria-label': t('readingSettings'),
          },
          'Aa',
        ),
      )
      controls.push(h('span', { key: 'div2', className: 'bs-divider' }))
      controls.push(
        h(
          'button',
          {
            key: 'prev',
            type: 'button',
            className: 'bs-icon-button',
            onClick: () => (paged ? turnPage(-1) : goTo(chapter - 1, '', 0)),
            disabled: paged ? pageIndex <= 0 && chapter <= 0 : data === null || chapter <= 0,
            title: paged ? t('previousPage') : t('previousChapter'),
            'aria-label': paged ? t('previousPage') : t('previousChapter'),
            'aria-keyshortcuts': paged ? 'ArrowLeft PageUp' : undefined,
          },
          h(ChevronLeftIcon),
        ),
      )
      controls.push(
        h(
          'span',
          { key: 'count', className: 'bs-control-label', 'aria-live': 'polite', 'aria-atomic': 'true' },
          currentPageLabel,
        ),
      )
      controls.push(
        h(
          'button',
          {
            key: 'next',
            type: 'button',
            className: 'bs-icon-button',
            onClick: () => (paged ? turnPage(1) : goTo(chapter + 1, '', 0)),
            disabled: paged
              ? pageIndex + pageColumns >= pageCount && chapter >= data.chapters.length - 1
              : data === null || chapter >= data.chapters.length - 1,
            title: paged ? t('nextPage') : t('nextChapter'),
            'aria-label': paged ? t('nextPage') : t('nextChapter'),
            'aria-keyshortcuts': paged ? 'ArrowRight PageDown' : undefined,
          },
          h(ChevronRightIcon),
        ),
      )

      const sub =
        data === null || status !== 'ready'
          ? undefined
          : `${data.author || t('unknownAuthor')} · ${t('chapterOf', { current: chapter + 1, total: data.chapters.length })}`

      const speechLanguage = useMemo(() => epubSpeechLanguage(data), [data])
      const readAloud = useReadAloud({ base, t, language: speechLanguage })

      const waitForSpeechChapter = useCallback(async (index, previousDocument) => {
        const deadline = Date.now() + 4000
        while (Date.now() < deadline) {
          const frame = frameRef.current
          const documentNode = frame && frame.contentDocument
          const body = documentNode && documentNode.body
          const replaced = previousDocument === null || previousDocument === undefined || documentNode !== previousDocument
          if (replaced && body !== null && body !== undefined && chapterRef.current === index && (body.innerText || '').trim() !== '') {
            return documentNode
          }
          await new Promise((resolve) => setTimeout(resolve, 80))
        }
        throw new Error(t('ttsChapterTimeout'))
      }, [t])

      const createSpeechDriver = useCallback(() => {
        if (data === null) return null
        const chapters = data.chapters
        const modulePromise = loadTtsSentences(base)

        const batchForChapter = async (index, previousDocument = null) => {
          const module = await modulePromise
          const textIndex = clientLib('text-index')
          if (textIndex === null) throw new Error(t('ttsFailed'))
          const documentNode = await waitForSpeechChapter(index, previousDocument)
          const frame = frameRef.current
          const windowNode = frame && frame.contentWindow
          if (!windowNode) return []
          const sentences = module.splitSentences(documentNode.body.innerText || '')
          const entries = textIndex.buildSpeechBatches(documentNode, sentences)
          const paged = settingsRef.current.pageMode === 'paged'
          const startPage = pageIndexRef.current
          let start = 0
          if (paged) {
            const found = entries.findIndex((entry) => {
              const page = rangePage(documentNode, windowNode, entry.range)
              return page !== null && page >= startPage
            })
            if (found > 0) start = found
          } else {
            const found = entries.findIndex((entry) => {
              if (entry.range === null) return false
              const rect = entry.range.getBoundingClientRect()
              return rect.bottom > 0 && rect.top < windowNode.innerHeight
            })
            if (found > 0) start = found
          }
          return entries.slice(start).map((entry) => ({
            text: entry.text,
            enter: async () => {
              if (entry.range === null) return
              const frameNode = frameRef.current
              const currentDocument = frameNode && frameNode.contentDocument
              if (currentDocument !== documentNode) return
              speechRangeRef.current = entry.range
              // Paint after the page turn or scroll settles so the inversion (or
              // the fallback marker band) matches the final line boxes.
              const paint = () => {
                const live = frameRef.current
                if (!live || live.contentDocument !== documentNode) return
                repaintHighlights(documentNode)
              }
              if (paged) {
                const page = rangePage(documentNode, windowNode, entry.range)
                if (page !== null && page > pageIndexRef.current) {
                  layoutPagedFrame(frameNode, { targetPage: page, save: true })
                }
                windowNode.requestAnimationFrame(paint)
                return
              }
              const rect = entry.range.getBoundingClientRect()
              if (rect.top < 0 || rect.bottom > windowNode.innerHeight) {
                const element = entry.range.startContainer.parentElement || documentNode.body
                if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center' })
              }
              windowNode.requestAnimationFrame(paint)
            },
            // Select without moving the reader: only paint when the sentence
            // already sits on the visible page.
            preview: async () => {
              if (entry.range === null) return
              const frameNode = frameRef.current
              const currentDocument = frameNode && frameNode.contentDocument
              if (currentDocument !== documentNode) return
              if (paged) {
                const page = rangePage(documentNode, windowNode, entry.range)
                if (page === null || page !== pageIndexRef.current) return
              } else {
                const rect = entry.range.getBoundingClientRect()
                if (rect.bottom <= 0 || rect.top >= windowNode.innerHeight) return
              }
              speechRangeRef.current = entry.range
              windowNode.requestAnimationFrame(() => {
                const live = frameRef.current
                if (!live || live.contentDocument !== documentNode) return
                repaintHighlights(documentNode)
              })
            },
          }))
        }

        return {
          current: () => batchForChapter(chapterRef.current),
          advance: async () => {
            const next = chapterRef.current + 1
            if (next >= chapters.length) return null
            const frame = frameRef.current
            const previousDocument = frame && frame.contentDocument
            goTo(next, '', 0)
            return batchForChapter(next, previousDocument)
          },
        }
      }, [base, data, goTo, layoutPagedFrame, repaintHighlights, t, waitForSpeechChapter])

      const startReadAloud = useCallback(() => {
        const driver = createSpeechDriver()
        if (driver !== null) void readAloud.start(driver)
      }, [createSpeechDriver, readAloud])

      const previewReadAloud = useCallback(() => {
        const driver = createSpeechDriver()
        if (driver !== null) void readAloud.preview(driver)
      }, [createSpeechDriver, readAloud])

      // Bookmark / annotation panel model: merge, sort, search and counts live in
      // assets/lib/reading-list.mjs; the reader only supplies localised chapter
      // names and the page fallback. The module is preloaded with the reader, so
      // the panel falls back to the plain bookmark list only if that load failed.
      const readingListLib = clientLib('reading-list')
      const chapterLabels = useMemo(() => {
        const labels = new Map()
        for (const entry of toc) {
          if (!labels.has(entry.chapterIndex)) labels.set(entry.chapterIndex, entry.label || chapterLabel(t, entry.chapterIndex))
        }
        return labels
      }, [toc, t])
      const readingMerged = useMemo(() => {
        if (readingListLib === null) return []
        return readingListLib.mergeReadingItems({
          bookmarks,
          annotations,
          chapterLabels,
          pageLabel: (page) => t('pageLabel', { number: page }),
        })
      }, [annotations, bookmarks, chapterLabels, readingListLib, t])
      const readingItems = useMemo(() => {
        if (readingListLib === null) return []
        return readingListLib.sortReadingItems(readingListLib.filterReadingItems(readingMerged, readingQuery), readingSort)
      }, [readingListLib, readingMerged, readingQuery, readingSort])
      const readingCounts = useMemo(() => {
        if (readingListLib === null) return { total: 0, bookmark: 0, highlight: 0, underline: 0 }
        return readingListLib.countReadingItems(readingMerged)
      }, [readingListLib, readingMerged])
      const readingTabCount = readingListLib !== null ? readingCounts.total : bookmarks.length

      return h(
        ReaderShell,
        {
          t,
          base,
          book,
          onBack: exitReader,
          controls,
          state: sub,
          progress: status === 'ready' && data !== null ? { percent, onSeek: onSeekProgress } : undefined,
          speech: { readAloud, start: startReadAloud, preview: previewReadAloud },
        },
        status === 'loading'
          ? h(ReaderState, { message: t('parsing') })
          : status === 'error'
            ? h(ReaderState, {
                error: true,
                message: t('openFailed', { message: error }),
                onRetry: () => setAttempt((value) => value + 1),
                retryLabel: t('retry'),
              })
            : h(
                React.Fragment,
                null,
                h(
                'div',
                { ref: menuHostRef, className: 'bs-epub-body', style: { backgroundColor: palette.bg === 'transparent' ? 'var(--dsw-alias-bg-base)' : palette.bg } },
                tocOpen
                  ? h(
                      'aside',
                      { className: 'bs-epub-toc', 'aria-label': t('asideLabel') },
                      h(
                        'div',
                        { className: 'bs-aside-tabs', role: 'tablist' },
                        h(
                          'button',
                          {
                            type: 'button',
                            role: 'tab',
                            className: 'bs-aside-tab',
                            'aria-selected': asideTab === 'toc',
                            onClick: () => setAsideTab('toc'),
                          },
                          `${t('tocTab')} (${toc.length})`,
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            role: 'tab',
                            className: 'bs-aside-tab',
                            'aria-selected': asideTab === 'bookmarks',
                            onClick: () => setAsideTab('bookmarks'),
                          },
                          `${t('bookmarksTab')} (${readingTabCount})`,
                        ),
                      ),
                      asideTab === 'toc'
                        ? toc.map((entry, index) =>
                            h(
                              'button',
                              {
                                key: `${entry.chapterIndex}-${entry.anchor}-${index}`,
                                type: 'button',
                                className: 'bs-toc-label',
                                style: { paddingLeft: `${8 + Math.min(5, entry.depth) * 12}px` },
                                'aria-current': entry.chapterIndex === chapter ? 'true' : undefined,
                                onClick: () => goTo(entry.chapterIndex, entry.anchor, 0),
                                title: entry.label,
                              },
                              entry.label,
                            ),
                          )
                        : h(
                            React.Fragment,
                            null,
                            h(
                              'div',
                              { className: 'bs-reading-tools' },
                              h(
                                'select',
                                {
                                  className: 'bs-reading-sort',
                                  'aria-label': t('readingSort'),
                                  title: t('readingSort'),
                                  value: readingSort,
                                  onChange: (event) => setReadingSort(event.target.value),
                                },
                                h('option', { value: 'position' }, t('readingSortPosition')),
                                h('option', { value: 'recent' }, t('readingSortRecent')),
                                h('option', { value: 'kind' }, t('readingSortKind')),
                              ),
                              h('input', {
                                type: 'search',
                                className: 'bs-reading-search',
                                'aria-label': t('readingSearch'),
                                placeholder: t('readingSearchPlaceholder'),
                                value: readingQuery,
                                onChange: (event) => setReadingQuery(event.target.value),
                              }),
                            ),
                            readingListLib !== null
                              ? h(ReadingList, {
                                  t,
                                  items: readingItems,
                                  emptyLabel: readingQuery.trim() === '' ? t('noReadingItems') : t('noReadingMatches'),
                                  onSelect: (item) => {
                                    const source = item.source || {}
                                    const ratio = item.kind === 'bookmark' ? Number(source.scrollRatio) || 0 : 0
                                    goTo(typeof item.chapterIndex === 'number' ? item.chapterIndex : 0, typeof source.anchor === 'string' ? source.anchor : '', ratio)
                                  },
                                  onDelete: (item) => {
                                    const source = item.source || {}
                                    if (item.kind === 'bookmark') {
                                      readerState.save({ bookmarks: bookmarks.filter((bookmark) => bookmark.id !== source.id) }, true)
                                      return
                                    }
                                    readerState.save({ annotations: annotations.filter((annotation) => annotation.id !== source.id) }, true)
                                  },
                                })
                              : h(BookmarksList, {
                                  t,
                                  bookmarks,
                                  onSelect: (bookmark) => goTo(bookmark.chapterIndex || 0, bookmark.anchor || '', Number(bookmark.scrollRatio) || 0),
                                  onDelete: (bookmark) => readerState.save({ bookmarks: bookmarks.filter((item) => item.id !== bookmark.id) }, true),
                                }),
                          ),
                    )
                  : null,
                h(
                  'div',
                  { ref: frameWrapRef, className: 'bs-epub-frame-wrap' },
                  h('iframe', {
                    key: `chapter-${chapter}`,
                    ref: frameRef,
                    className: 'bs-epub-frame',
                    sandbox: 'allow-same-origin',
                    srcDoc: chapterHtml,
                    onLoad: onFrameLoad,
                    title: `${book.title} — ${chapterLabel(t, chapter)}`,
                  }),
                ),
                h('iframe', {
                  ref: probeFrameRef,
                  className: 'bs-epub-probe',
                  sandbox: 'allow-same-origin',
                  title: '',
                  'aria-hidden': 'true',
                  tabIndex: -1,
                }),
                selectionMenu !== null
                  ? h(SelectionMenu, {
                      t,
                      menu: selectionMenu,
                      onClose: () => setSelectionMenu(null),
                      onCopy: () => {
                        void copyText(selectionMenu.text)
                      },
                      onCopyCite: () => {
                        void copyText(`${selectionMenu.text}\n— ${book.title} · ${chapterLabel(t, chapter)}`)
                      },
                      onSpeak: () => {
                        void readAloud.speakText(selectionMenu.text)
                      },
                      onHighlight: () => createAnnotation('highlight'),
                      onUnderline: () => createAnnotation('underline'),
                      canAnnotate: selectionMenu.anchor !== null && clientLib('annotations') !== null,
                    })
                  : null,
                ),
                directBusy ? h('div', { className: 'bs-discussion-backdrop' },
                  h('section', { className: 'bs-discussion-dialog', role: 'status', 'aria-live': 'polite', 'aria-label': t('discussionCreating') },
                    h('p', null, t('discussionCreating'))) ) : null,
                discussionState ? h(DiscussionDialog, { t, discussion, workspaces, preferredWorkspaceId: discussionWorkspace, ...discussionState, onClose: closeDiscussion }) : null,
                annotationOpen
                  ? h(AnnotationStyleMenu, {
                      t,
                      style: annotationStyle,
                      onChange: saveAnnotationStyle,
                      onClose: () => setAnnotationOpen(false),
                    })
                  : null,
                settingsOpen
                  ? h(ReaderSettingsPopover, {
                      t,
                      settings,
                      onChange: updateSettings,
                      onClose: () => setSettingsOpen(false),
                    })
                  : null,
              ),
      )
    }

    // ===== [shelf] =====
    // Shelf dialogs, cards, the main panel and the right-sidebar helpers.

    function AppleBooksPicker({ t, base, onClose, onImported }) {
      const [query, setQuery] = useState('')
      const [books, setBooks] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [total, setTotal] = useState(0)
      const [nextOffset, setNextOffset] = useState(null)
      const [importing, setImporting] = useState('')
      const [notice, setNotice] = useState(null)
      const requestRef = useRef(0)

      const load = useCallback(
        async (searchText, offset) => {
          const request = requestRef.current + 1
          requestRef.current = request
          setLoading(true)
          setError('')
          try {
            const params = new URLSearchParams({ limit: '50' })
            if (searchText.trim() !== '') params.set('query', searchText.trim())
            if (offset > 0) params.set('offset', String(offset))
            const payload = await requestJson(base, `/apple-books?${params.toString()}`)
            if (requestRef.current !== request) return
            const page = Array.isArray(payload.books) ? payload.books : []
            setBooks((current) => (offset > 0 && Array.isArray(current) ? [...current, ...page] : page))
            setTotal(Number(payload.total) || page.length)
            setNextOffset(typeof payload.nextOffset === 'number' ? payload.nextOffset : null)
          } catch (failure) {
            if (requestRef.current !== request) return
            setError(failure instanceof TypeError ? t('serviceUnreachable') : failure instanceof Error ? failure.message : String(failure))
            setBooks([])
            setTotal(0)
            setNextOffset(null)
          } finally {
            if (requestRef.current === request) setLoading(false)
          }
        },
        [base, t],
      )

      useEffect(() => {
        const timer = setTimeout(() => {
          void load(query, 0)
        }, query === '' ? 0 : 300)
        return () => clearTimeout(timer)
      }, [query, load])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      const importBook = useCallback(
        async (book) => {
          if (importing !== '' || book.imported) return
          setImporting(book.assetID)
          setNotice(null)
          try {
            const response = await fetch(
              resourceUrl(base, `${API_ROOT}/apple-books/import?assetID=${encodeURIComponent(book.assetID)}`),
              { method: 'POST' },
            )
            const payload = await parseResponse(response)
            const imported = payload && payload.book ? payload.book : book
            setNotice({
              kind: 'ok',
              text: payload && payload.duplicate ? t('appleAlreadyImported') : t('appleImported', { title: imported.title || book.title }),
            })
            if (typeof onImported === 'function') onImported(imported, Boolean(payload && payload.duplicate))
          } catch (failure) {
            setNotice({
              kind: 'error',
              text: t('appleImportFailed', { message: failure instanceof Error ? failure.message : String(failure) }),
            })
          } finally {
            setImporting('')
          }
        },
        [base, importing, onImported, t],
      )

      const results = Array.isArray(books) ? books : []
      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: onClose }),
        h(
          'div',
          {
            className: 'bs-apple-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('importAppleBooks'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('importAppleBooks')),
              h('p', { className: 'bs-apple-hint' }, t('applePickerHint')),
            ),
            h(
              'button',
              { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') },
              h(CloseIcon),
            ),
          ),
          h(
            'div',
            { className: 'bs-apple-search' },
            h(SearchIcon),
            h('input', {
              type: 'text',
              className: 'bs-search-input',
              value: query,
              placeholder: t('appleSearchPlaceholder'),
              'aria-label': t('appleSearchPlaceholder'),
              autoFocus: true,
              spellCheck: false,
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Escape' && query !== '') {
                  event.preventDefault()
                  event.stopPropagation()
                  setQuery('')
                }
              },
            }),
            query !== ''
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'bs-search-clear',
                    onClick: () => setQuery(''),
                    title: t('clearSearch'),
                    'aria-label': t('clearSearch'),
                  },
                  h(CloseIcon, { size: 13 }),
                )
              : null,
          ),
          notice !== null
            ? h(
                'div',
                { className: `bs-apple-notice bs-apple-notice-${notice.kind}`, role: 'status', 'aria-live': 'polite' },
                notice.text,
              )
            : null,
          h(
            'div',
            { className: 'bs-apple-list', role: 'list' },
            loading && results.length === 0
              ? h('div', { className: 'bs-apple-state' }, h(Spinner), h('span', null, t('appleLoading')))
              : error !== ''
                ? h(
                    'div',
                    { className: 'bs-apple-state bs-apple-error' },
                    h(AlertIcon, { size: 22 }),
                    h('strong', null, t('appleUnavailableTitle')),
                    h('span', null, error),
                    h('span', { className: 'bs-apple-permission' }, t('applePermissionHint')),
                  )
                : results.length === 0
                  ? h(
                      'div',
                      { className: 'bs-apple-state' },
                      h(BookIcon, { size: 24 }),
                      h('strong', null, t('appleNoBooks')),
                      h('span', null, t('appleNoBooksHint')),
                    )
                  : results.map((book) =>
                      h(
                        'div',
                        { className: 'bs-apple-row', key: book.assetID, role: 'listitem' },
                        h('span', { className: 'bs-apple-format' }, String(book.format || '').toUpperCase() === 'AUDIOBOOK' ? 'AUDIO' : String(book.format || '').toUpperCase()),
                        h(
                          'div',
                          { className: 'bs-apple-info' },
                          h('div', { className: 'bs-apple-book-title', title: book.title }, book.title),
                          h(
                            'div',
                            { className: 'bs-apple-meta' },
                            [
                              book.author || t('unknownAuthor'),
                              book.format === 'audiobook'
                                ? t('appleUnsupported')
                                : !book.sourceAvailable
                                  ? t('appleSourceUnavailable')
                                  : book.progress > 0
                                    ? t('appleProgress', { percent: Math.round(book.progress * 100) })
                                    : '',
                              book.lastOpened ? t('appleLastOpened', { date: formatDate(book.lastOpened) }) : '',
                            ]
                              .filter(Boolean)
                              .join(' · '),
                          ),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'bs-button bs-apple-import',
                            disabled: !book.importable || book.imported || importing !== '',
                            onClick: () => importBook(book),
                          },
                          importing === book.assetID
                            ? t('appleImporting')
                            : book.imported
                              ? t('appleOnShelf')
                              : !book.importable
                                ? book.format === 'audiobook'
                                  ? t('appleUnsupportedShort')
                                  : t('appleSourceUnavailableShort')
                                : t('appleImport'),
                        ),
                      ),
                    ),
          ),
          h(
            'footer',
            { className: 'bs-apple-foot' },
            h('span', { className: 'bs-apple-count' }, t('appleTotal', { count: total })),
            nextOffset !== null
              ? h(
                  'button',
                  { type: 'button', className: 'bs-button', disabled: loading, onClick: () => load(query, nextOffset) },
                  loading ? t('appleLoading') : t('appleLoadMore'),
                )
              : null,
            h('button', { type: 'button', className: 'bs-button', onClick: onClose }, t('dismiss')),
          ),
        ),
      )
    }

    function ImportMenu({ t, disabled = false, busy = false, onPickFiles, onLinkFolder }) {
      const [open, setOpen] = useState(false)
      const wrapRef = useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (wrapRef.current !== null && !wrapRef.current.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      const choose = (action) => {
        setOpen(false)
        action()
      }

      return h(
        'div',
        { className: 'bs-import-menu-wrap', ref: wrapRef },
        h(
          'button',
          {
            type: 'button',
            className: 'bs-button bs-button-primary bs-import-trigger',
            onClick: () => setOpen((value) => !value),
            disabled,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': t('import'),
            title: t('import'),
          },
          busy ? h(Spinner, { small: true }) : h(PlusIcon),
          h('span', null, busy ? t('importing') : t('import')),
          h(ChevronDownIcon, { size: 12 }),
        ),
        open
          ? h(
              'div',
              { className: 'bs-import-menu', role: 'menu', 'aria-label': t('import') },
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-import-menu-item',
                  role: 'menuitem',
                  onClick: () => choose(onPickFiles),
                },
                h(BookIcon, { size: 16 }),
                h(
                  'span',
                  { className: 'bs-import-menu-info' },
                  h('strong', null, t('importFilesMenu')),
                  h('span', null, t('importFilesHint')),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-import-menu-item',
                  role: 'menuitem',
                  onClick: () => choose(onLinkFolder),
                },
                h(LinkIcon, { size: 16 }),
                h(
                  'span',
                  { className: 'bs-import-menu-info' },
                  h('strong', null, t('importFolderMenu')),
                  h('span', null, t('importFolderHint')),
                ),
              ),
            )
          : null,
      )
    }

    function LinkImportDialog({ t, base, onClose, onChanged }) {
      const [session, setSession] = useState(null)
      const [picking, setPicking] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState(null)
      const [adding, setAdding] = useState('')
      const [added, setAdded] = useState(new Set())
      const [modes, setModes] = useState({})
      const [filter, setFilter] = useState('')

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      const pickFolder = useCallback(async () => {
        setPicking(true)
        setError('')
        setNotice(null)
        try {
          const response = await fetch(resourceUrl(base, `${API_ROOT}/links/pick`), { method: 'POST' })
          const payload = await parseResponse(response)
          if (payload && payload.cancelled) {
            setNotice({ kind: 'ok', text: t('linkPickCancelled') })
            return
          }
          setSession(payload)
          setFilter('')
          setAdded(new Set())
          setModes({})
        } catch (failure) {
          setError(t('linkPickFailed', { message: failure instanceof Error ? failure.message : String(failure) }))
        } finally {
          setPicking(false)
        }
      }, [base, t])

      const addFile = useCallback(
        async (file) => {
          if (session === null || adding !== '') return
          setAdding(file.name)
          setNotice(null)
          try {
            const response = await fetch(resourceUrl(base, `${API_ROOT}/links/import`), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token: session.token, name: file.name }),
            })
            const payload = await parseResponse(response)
            setAdded((current) => {
              const next = new Set(current)
              next.add(file.name)
              return next
            })
            const mode = payload && payload.mode === 'copy' ? 'copy' : 'symlink'
            setModes((current) => ({ ...current, [file.name]: mode }))
            const title = payload && payload.book ? payload.book.title : file.name
            setNotice({
              kind: 'ok',
              text: payload && payload.duplicate
                ? t('linkAlready')
                : mode === 'copy'
                  ? t('linkAddedCopy', { title })
                  : t('linkAdded', { title }),
            })
            if (typeof onChanged === 'function') onChanged()
          } catch (failure) {
            setNotice({
              kind: 'error',
              text: t('linkFailed', { message: failure instanceof Error ? failure.message : String(failure) }),
            })
          } finally {
            setAdding('')
          }
        },
        [adding, base, onChanged, session, t],
      )

      const files = session && Array.isArray(session.files) ? session.files : []
      const normalized = filter.trim().toLocaleLowerCase()
      const visible = normalized === '' ? files : files.filter((file) => file.name.toLocaleLowerCase().includes(normalized))
      const folder = session && typeof session.directory === 'string'
        ? session.directory.split('/').filter(Boolean).pop() || session.directory
        : ''

      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: onClose }),
        h(
          'div',
          {
            className: 'bs-apple-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('addLocalBooks'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('addLocalBooks')),
              h('p', { className: 'bs-apple-hint' }, t('linkImportHint')),
            ),
            h(
              'button',
              { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') },
              h(CloseIcon),
            ),
          ),
          session === null
            ? h(
                'div',
                { className: 'bs-link-choose' },
                h('div', { className: 'bs-link-choose-icon' }, h(LinkIcon, { size: 26 })),
                h('strong', null, t('linkChooseTitle')),
                h('span', null, t('linkPickHint')),
                error !== ''
                  ? h('p', { className: 'bs-link-error', role: 'alert' }, error)
                  : null,
                notice !== null
                  ? h('p', { className: 'bs-link-note' }, notice.text)
                  : null,
                h(
                  'button',
                  { type: 'button', className: 'bs-button bs-button-primary', onClick: pickFolder, disabled: picking },
                  picking ? t('linkPicking') : t('linkPickFolder'),
                ),
              )
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'bs-link-folderbar' },
                  h('div', { className: 'bs-link-folder' },
                    h('strong', { title: session.directory }, folder),
                    h('span', null, t('linkFileCount', { count: files.length })),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'bs-button', onClick: pickFolder, disabled: picking || adding !== '' },
                    picking ? t('linkPicking') : t('linkChooseAnother'),
                  ),
                ),
                error !== ''
                  ? h('div', { className: 'bs-apple-notice bs-apple-notice-error', role: 'alert' }, error)
                  : null,
                h(
                  'div',
                  { className: 'bs-apple-search' },
                  h(SearchIcon),
                  h('input', {
                    type: 'text',
                    className: 'bs-search-input',
                    value: filter,
                    placeholder: t('linkFilterPlaceholder'),
                    'aria-label': t('linkFilterPlaceholder'),
                    spellCheck: false,
                    onChange: (event) => setFilter(event.target.value),
                  }),
                ),
                notice !== null
                  ? h(
                      'div',
                      { className: `bs-apple-notice bs-apple-notice-${notice.kind}`, role: 'status', 'aria-live': 'polite' },
                      notice.text,
                    )
                  : null,
                h(
                  'div',
                  { className: 'bs-apple-list', role: 'list' },
                  visible.length === 0
                    ? h(
                        'div',
                        { className: 'bs-apple-state' },
                        h(BookIcon, { size: 24 }),
                        h('strong', null, t('linkNoFiles')),
                        h('span', null, t('linkNoFilesHint')),
                      )
                    : visible.map((file) =>
                        h(
                          'div',
                          { className: 'bs-apple-row', key: file.name, role: 'listitem' },
                          h('span', { className: 'bs-apple-format' }, String(file.format || '').toUpperCase()),
                          h(
                            'div',
                            { className: 'bs-apple-info' },
                            h('div', { className: 'bs-apple-book-title', title: file.name }, file.name.replace(/\.[^.]+$/, '')),
                            h(
                              'div',
                              { className: 'bs-apple-meta' },
                              `${formatBytes(file.bytes)} · ${t((modes[file.name] || file.mode) === 'copy' ? 'linkCopyShort' : 'linkSoftShort')}`,
                            ),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'bs-button bs-apple-import',
                              disabled: file.linked || added.has(file.name) || adding !== '',
                              onClick: () => addFile(file),
                            },
                            adding === file.name
                              ? t('linkAdding')
                              : file.linked || added.has(file.name)
                                ? t('linkAlready')
                                : t('linkAdd'),
                          ),
                        ),
                      ),
                ),
                h(
                  'footer',
                  { className: 'bs-apple-foot' },
                  h('span', { className: 'bs-apple-count' }, t('linkSoftNote')),
                  h('button', { type: 'button', className: 'bs-button', onClick: onClose }, t('linkDone')),
                ),
              ),
        ),
      )
    }

    function BookRenameDialog({ t, book, field, saving, error, onClose, onSave }) {
      const [title, setTitle] = useState(book.title || '')
      const [author, setAuthor] = useState(book.author || '')

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      const submit = (event) => {
        event.preventDefault()
        if (saving) return
        onSave({ title: title.trim(), author: author.trim() })
      }

      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: onClose }),
        h(
          'div',
          {
            className: 'bs-apple-dialog bs-rename-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('rename'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('rename')),
            ),
            h(
              'button',
              { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') },
              h(CloseIcon),
            ),
          ),
          h(
            'form',
            { className: 'bs-rename-form', onSubmit: submit },
            h(
              'div',
              { className: 'bs-rename-body' },
              h(
                'label',
                { className: 'bs-rename-field' },
                h('span', { className: 'bs-rename-label' }, t('bookTitleLabel')),
                h('input', {
                  type: 'text',
                  className: 'bs-rename-input',
                  value: title,
                  maxLength: 500,
                  autoFocus: field === 'title',
                  onChange: (event) => setTitle(event.target.value),
                }),
              ),
              h(
                'label',
                { className: 'bs-rename-field' },
                h('span', { className: 'bs-rename-label' }, t('bookAuthorLabel')),
                h('input', {
                  type: 'text',
                  className: 'bs-rename-input',
                  value: author,
                  maxLength: 500,
                  autoFocus: field === 'author',
                  onChange: (event) => setAuthor(event.target.value),
                }),
              ),
              error !== ''
                ? h('p', { className: 'bs-rename-error', role: 'alert' }, error)
                : null,
            ),
            h(
              'div',
              { className: 'bs-apple-foot bs-rename-foot' },
              h(
                'button',
                { type: 'button', className: 'bs-button', onClick: onClose, disabled: saving },
                t('cancel'),
              ),
              h(
                'button',
                { type: 'submit', className: 'bs-button bs-button-primary', disabled: saving || title.trim() === '' },
                saving ? t('saving') : t('save'),
              ),
            ),
          ),
        ),
      )
    }

    // Whole-book audio is rendered from text extracted here, because the Host
    // has no DOM parser: EPUB uses the same parser as the reader, PDF reuses
    // the reader's PDF.js. Only the resulting plain text crosses the wire.
    async function extractBookText(base, book) {
      const response = await fetch(resourceUrl(base, `${API_ROOT}/books/${book.id}/file`))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (book.format === 'epub') {
        const [module, speech] = await Promise.all([loadEpubModule(base), loadTtsSentences(base)])
        const data = module.parseEpub(bytes)
        const parts = []
        for (const chapter of data.chapters || []) {
          const text = speech.htmlToSpeakText((chapter && chapter.html) || '')
          if (text !== '') parts.push(text)
        }
        return parts.join('\n\n')
      }
      if (book.format === 'pdf') {
        const [pdfjs, textIndex] = await Promise.all([loadPdfjs(base), loadClientLib(base, 'text-index')])
        const loading = pdfjs.getDocument({
          data: bytes,
          cMapUrl: absoluteServiceUrl(base, `${ASSET_ROOT}/cmaps/`),
          cMapPacked: true,
          standardFontDataUrl: absoluteServiceUrl(base, `${ASSET_ROOT}/standard_fonts/`),
          wasmUrl: absoluteServiceUrl(base, `${ASSET_ROOT}/wasm/`),
          isEvalSupported: false,
        })
        const document = await loading.promise
        try {
          const parts = []
          for (let number = 1; number <= document.numPages; number += 1) {
            const page = await document.getPage(number)
            const content = await page.getTextContent()
            parts.push(textIndex.joinPdfItems(content.items))
          }
          return parts.join('\n\n')
        } finally {
          void loading.destroy().catch(() => undefined)
        }
      }
      return ''
    }

    function formatDuration(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const rest = total % 60
      if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
      return `${minutes}:${String(rest).padStart(2, '0')}`
    }

    function formatMoney(value) {
      const number = Number(value) || 0
      return number >= 0.01 ? number.toFixed(2) : number.toFixed(4)
    }

    // DeepSeek renders a book into one WAV. The dialog shows the estimate before
    // anything is synthesised; the render then runs in the Host, so closing the
    // dialog does not stop it.
    function AudiobookDialog({ t, base, book, onClose, onOpenSettings }) {
      const [phase, setPhase] = useState('extracting')
      const [plan, setPlan] = useState(null)
      const [providers, setProviders] = useState([])
      const [provider, setProvider] = useState('deepseek')
      const [voice, setVoice] = useState('stella')
      const [speed, setSpeed] = useState(1)
      const [job, setJob] = useState(null)
      const [error, setError] = useState('')
      const aliveRef = useRef(true)

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      useEffect(() => () => { aliveRef.current = false }, [])

      useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const capabilities = await requestJson(base, '/tts/capabilities')
            const available = (capabilities.providers || []).filter((item) => item.available !== false)
            const selected = available.find((item) => item.id === 'deepseek')
            if (cancelled) return
            setProviders(available)
            if (selected && selected.configured === false) setError(t('audiobookNoKey'))
            const text = await extractBookText(base, book)
            if (cancelled) return
            if (text.trim() === '') throw new Error(t('audiobookNoText'))
            const payload = await requestJson(base, `/books/${book.id}/audio/plan`, {
              method: 'POST',
              body: JSON.stringify({ text, voice: 'stella', speed: 1, provider: 'deepseek' }),
            })
            if (cancelled) return
            setPlan(payload.plan)
            const current = await requestJson(base, `/books/${book.id}/audio`)
            if (cancelled) return
            setJob(current.state)
            setPhase(current.state.status === 'done' ? 'done' : current.state.status === 'running' ? 'running' : 'ready')
          } catch (failure) {
            if (cancelled) return
            setError(failure instanceof Error ? failure.message : String(failure))
            setPhase('error')
          }
        })()
        return () => { cancelled = true }
      }, [base, book, t])

      useEffect(() => {
        if (phase !== 'running') return undefined
        let cancelled = false
        const poll = async () => {
          try {
            const payload = await requestJson(base, `/books/${book.id}/audio`)
            if (cancelled) return
            setJob(payload.state)
            if (payload.state.status === 'done') setPhase('done')
            else if (payload.state.status === 'failed') {
              setError(payload.state.error || t('audiobookFailed'))
              setPhase('error')
            } else if (payload.state.status === 'cancelled') setPhase('ready')
          } catch {
            // A transient poll failure must not discard a running render.
          }
        }
        const timer = setInterval(() => { void poll() }, 1000)
        void poll()
        return () => { cancelled = true; clearInterval(timer) }
      }, [phase, base, book.id, t])

      const replan = async (nextProvider, nextVoice, nextSpeed) => {
        setProvider(nextProvider)
        setVoice(nextVoice)
        setSpeed(nextSpeed)
        setError('')
        try {
          const payload = await requestJson(base, `/books/${book.id}/audio/plan`, {
            method: 'POST',
            body: JSON.stringify({ provider: nextProvider, voice: nextVoice, speed: nextSpeed }),
          })
          if (aliveRef.current) setPlan(payload.plan)
        } catch (failure) {
          if (aliveRef.current) setError(failure instanceof Error ? failure.message : String(failure))
        }
      }

      const start = async () => {
        setError('')
        setPhase('running')
        try {
          const payload = await requestJson(base, `/books/${book.id}/audio/start`, {
            method: 'POST',
            body: JSON.stringify({ provider, voice, speed }),
          })
          if (aliveRef.current) setJob(payload.state)
        } catch (failure) {
          if (!aliveRef.current) return
          setError(failure instanceof Error ? failure.message : String(failure))
          setPhase('error')
        }
      }

      const cancel = async () => {
        try {
          const payload = await requestJson(base, `/books/${book.id}/audio/cancel`, { method: 'POST', body: '{}' })
          if (!aliveRef.current) return
          setJob(payload.state)
          setPhase('ready')
        } catch (failure) {
          if (aliveRef.current) setError(failure instanceof Error ? failure.message : String(failure))
        }
      }

      const providerOptions = providers.length > 0
        ? providers
        : [{ id: 'deepseek', label: 'DeepSeek 语音', voices: [], configured: true }]
      const currentProvider = providerOptions.find((item) => item.id === provider) || providerOptions[0]
      const voiceOptions = provider === 'deepseek'
        ? (Array.isArray(currentProvider.voices) && currentProvider.voices.length > 0
            ? currentProvider.voices
            : [{ id: 'stella', label: '海星 · 女声' }, { id: 'tide', label: '暗潮 · 男声' }])
        : [{ id: '', label: t('audiobookDefaultVoice') }].concat(
            (Array.isArray(currentProvider.voices) ? currentProvider.voices : []).map((item) => ({ id: item.id, label: item.label || item.id })),
          )
      const changeProvider = (nextProvider) => {
        void replan(nextProvider, nextProvider === 'deepseek' ? 'stella' : '', speed)
      }
      const estimate = plan
      const percent = job && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0
      const downloadUrl = resourceUrl(base, `${API_ROOT}/books/${book.id}/audio/file`)
      const busy = phase === 'extracting' || phase === 'running'
      const downloadExt = (job && job.audio && job.audio.ext) || (estimate && estimate.format === 'mp3' ? '.mp3' : '.wav')
      // Only DeepSeek has a published per-character price; other services keep
      // the estimate free of cost and billed-character rows.
      const costItems = estimate && estimate.priced
        ? [
            h('div', { className: 'bs-audiobook-item', key: 'billed' }, h('span', { className: 'bs-audiobook-label' }, t('audiobookBilled')), h('span', { className: 'bs-audiobook-value' }, estimate.billedCharacters.toLocaleString())),
            h(
              'div',
              { className: 'bs-audiobook-item', key: 'cost' },
              h('span', { className: 'bs-audiobook-label' }, t('audiobookCost')),
              h('span', { className: 'bs-audiobook-value' }, `¥${formatMoney(estimate.cost)}`),
              estimate.promo
                ? h('span', { className: 'bs-audiobook-label' }, t('audiobookPromo', { price: formatMoney(estimate.listCost) }))
                : null,
            ),
          ]
        : []

      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: onClose }),
        h(
          'div',
          {
            className: 'bs-apple-dialog bs-audiobook-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('audiobookTitle'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('audiobookTitle')),
              h('p', { className: 'bs-apple-sub' }, book.title || t('untitled')),
            ),
            h('button', { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') }, h(CloseIcon)),
          ),
          h(
            'div',
            { className: 'bs-audiobook-body' },
            phase === 'extracting'
              ? h('p', { className: 'bs-audiobook-hint' }, h(Spinner, { small: true }), ' ', t('audiobookParsing'))
              : null,
            error !== ''
              ? h('p', { className: 'bs-rename-error', role: 'alert' }, error)
              : null,
            estimate !== null
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'bs-audiobook-fields' },
                    h(
                      'label',
                      { className: 'bs-rename-field' },
                      h('span', { className: 'bs-rename-label' }, t('audiobookProviderLabel')),
                      h('select', {
                        className: 'bs-tts-select',
                        'aria-label': t('audiobookProviderLabel'),
                        value: provider,
                        disabled: busy,
                        onChange: (event) => changeProvider(event.target.value),
                      }, providerOptions.map((item) => h('option', { key: item.id, value: item.id }, item.label || item.id))),
                    ),
                    h(
                      'label',
                      { className: 'bs-rename-field' },
                      h('span', { className: 'bs-rename-label' }, t('audiobookVoiceLabel')),
                      h('select', {
                        className: 'bs-tts-select',
                        'aria-label': t('audiobookVoiceLabel'),
                        value: voice,
                        disabled: busy,
                        onChange: (event) => { void replan(provider, event.target.value, speed) },
                      }, voiceOptions.map((item) => h('option', { key: item.id, value: item.id }, item.label || item.id))),
                    ),
                    h(
                      'label',
                      { className: 'bs-rename-field' },
                      h('span', { className: 'bs-rename-label' }, t('audiobookSpeedLabel')),
                      h('select', {
                        className: 'bs-tts-select',
                        'aria-label': t('audiobookSpeedLabel'),
                        value: String(speed),
                        disabled: busy,
                        onChange: (event) => { void replan(provider, voice, Number(event.target.value)) },
                      }, [0.75, 1, 1.25, 1.5, 2].map((value) => h('option', { key: value, value: String(value) }, `${value}×`))),
                    ),
                  ),
                  h(
                    'p',
                    { className: 'bs-audiobook-hint' },
                    h('button', { type: 'button', className: 'bs-audiobook-link', onClick: onOpenSettings }, t('audiobookSettingsLink')),
                  ),
                  h(
                    'div',
                    { className: 'bs-audiobook-grid' },
                    h('div', { className: 'bs-audiobook-item' }, h('span', { className: 'bs-audiobook-label' }, t('audiobookCharacters')), h('span', { className: 'bs-audiobook-value' }, estimate.characters.toLocaleString())),
                    h('div', { className: 'bs-audiobook-item' }, h('span', { className: 'bs-audiobook-label' }, t('audiobookSentences')), h('span', { className: 'bs-audiobook-value' }, estimate.sentences.toLocaleString())),
                    h('div', { className: 'bs-audiobook-item' }, h('span', { className: 'bs-audiobook-label' }, t('audiobookDuration')), h('span', { className: 'bs-audiobook-value' }, `≈ ${formatDuration(estimate.durationSeconds)}`)),
                    h('div', { className: 'bs-audiobook-item' }, h('span', { className: 'bs-audiobook-label' }, t('audiobookSize')), h('span', { className: 'bs-audiobook-value' }, formatBytes(estimate.bytes))),
                    ...costItems,
                  ),
                  h('p', { className: 'bs-audiobook-hint' }, t('audiobookHint')),
                  estimate.priced ? null : h('p', { className: 'bs-audiobook-hint' }, t('audiobookUnpricedHint')),
                )
              : null,
            job !== null && (phase === 'running' || phase === 'done')
              ? h(
                  'div',
                  { className: 'bs-audiobook-progress' },
                  h('div', {
                    className: 'bs-audiobook-progress-fill',
                    style: { width: `${phase === 'done' ? 100 : percent}%` },
                  }),
                )
              : null,
            job !== null && phase === 'running'
              ? h('p', { className: 'bs-audiobook-hint' }, t('audiobookProgress', { done: job.done, total: job.total, size: formatBytes(job.bytes || 0) }))
              : null,
            phase === 'done' && job && job.audio
              ? h(
                  'div',
                  { className: 'bs-audiobook-done' },
                  h('p', { className: 'bs-audiobook-hint' }, t('audiobookDone', { size: formatBytes(job.audio.bytes), seconds: job.audio.seconds ? formatDuration(job.audio.seconds) : formatDuration(estimate ? estimate.durationSeconds : 0) })),
                  h('a', { className: 'bs-button bs-button-primary', href: downloadUrl, download: `${book.title || book.id}${downloadExt}` }, t('audiobookDownload')),
                )
              : null,
            phase === 'running'
              ? h('p', { className: 'bs-audiobook-hint' }, t('audiobookBackground'))
              : null,
          ),
          h(
            'div',
            { className: 'bs-apple-foot' },
            h('button', { type: 'button', className: 'bs-button', onClick: onClose }, phase === 'done' ? t('dismiss') : t('cancel')),
            phase === 'running'
              ? h('button', { type: 'button', className: 'bs-button', onClick: () => { void cancel() } }, t('audiobookCancel'))
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'bs-button bs-button-primary',
                    onClick: () => { void start() },
                    disabled: estimate === null || phase === 'extracting',
                  },
                  phase === 'done' ? t('audiobookRegenerate') : t('audiobookStart'),
                ),
          ),
        ),
      )
    }

    function BookCard({ book, base = '', t, onOpen, onDelete, confirming, deleting, onAskDelete, onCancelDelete, onRename, onEditTags, onGenerateAudio }) {
      // The Host sends the effective status (manual override or progress). The
      // card label must follow it, or a manual "finished" would still print the
      // percent-derived "continue reading".
      const percent = bookPercent(book)
      const status = bookStatus(book)
      const finished = status === 'finished'
      const subParts = bookSubParts(book, t)
      const coverSrc = bookCoverUrl(book, base)
      const [loadedCover, setLoadedCover] = useState('')
      const [failedCover, setFailedCover] = useState('')
      const [menuOpen, setMenuOpen] = useState(false)
      const wrapRef = useRef(null)
      const coverFailed = coverSrc !== '' && failedCover === coverSrc
      const coverLoaded = coverSrc !== '' && loadedCover === coverSrc

      useEffect(() => {
        if (!menuOpen) return undefined
        const onPointerDown = (event) => {
          const node = wrapRef.current
          if (node !== null && !node.contains(event.target)) setMenuOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          setMenuOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [menuOpen])

      const cover = h(
        'span',
        { className: 'bs-cover-frame' },
        h('span', { className: 'bs-cover-title' }, book.title || t('untitled')),
        h('span', { className: 'bs-cover-author' }, book.author || t('unknownAuthor')),
        coverSrc !== '' && !coverFailed
          ? h('img', {
              className: 'bs-cover-img',
              src: coverSrc,
              alt: '',
              loading: 'lazy',
              decoding: 'async',
              'data-loaded': coverLoaded ? 'true' : undefined,
              onLoad: () => setLoadedCover(coverSrc),
              onError: () => setFailedCover(coverSrc),
            })
          : null,
        h('span', { className: 'bs-cover-format' }, String(book.format || '').toUpperCase()),
      )
      const interactive = confirming
        ? h(
            'div',
            { className: 'bs-cover', style: coverStyle(book), role: 'group', 'aria-label': t('deleteTitle') },
            cover,
            h(
              'div',
              { className: 'bs-confirm' },
              h('p', { className: 'bs-confirm-title' }, t('deleteBody', { title: book.title })),
              h(
                'div',
                { className: 'bs-confirm-actions' },
                h(
                  'button',
                  { type: 'button', className: 'bs-confirm-button danger', disabled: deleting, onClick: () => onDelete(book) },
                  deleting ? t('deleting') : t('confirmDelete'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'bs-confirm-button', disabled: deleting, onClick: onCancelDelete },
                  t('cancel'),
                ),
              ),
            ),
          )
        : h(
            'button',
            {
              type: 'button',
              className: 'bs-cover',
              style: coverStyle(book),
              onClick: () => onOpen(book),
              'aria-label': t('openBook', { title: book.title || t('untitled') }),
            },
            cover,
          )

      return h(
        'article',
        { className: 'bs-card' },
        h(
          'div',
          { className: 'bs-cover-wrap', ref: wrapRef },
          interactive,
          confirming
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'bs-delete',
                  onClick: () => {
                    setMenuOpen(false)
                    onAskDelete(book)
                  },
                  title: t('delete'),
                  'aria-label': t('deleteBook', { title: book.title || t('untitled') }),
                },
                h(TrashIcon),
              ),
          confirming
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'bs-more',
                  onClick: () => setMenuOpen((value) => !value),
                  'aria-haspopup': 'menu',
                  'aria-expanded': menuOpen,
                  title: t('more'),
                  'aria-label': t('more'),
                },
                h(MoreIcon),
              ),
          confirming || !menuOpen
            ? null
            : h(
                'div',
                { className: 'bs-cover-menu', role: 'menu', 'aria-label': t('more') },
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => {
                      setMenuOpen(false)
                      onRename(book, 'title')
                    },
                  },
                  t('rename'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => {
                      setMenuOpen(false)
                      onEditTags(book)
                    },
                  },
                  t('bookTags'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => {
                      setMenuOpen(false)
                      onGenerateAudio(book)
                    },
                  },
                  t('audiobookMenu'),
                ),
              ),
        ),
        h(
          'div',
          { className: 'bs-meta' },
          h('div', { className: 'bs-book-title', title: book.title }, book.title || t('untitled')),
          h(
            'div',
            { className: 'bs-book-sub', title: subParts.filter(Boolean).join(' · ') },
            subParts.filter(Boolean).join(' · '),
          ),
          percent > 0 && !finished
            ? h(
                'div',
                {
                  className: 'bs-card-progress',
                  role: 'progressbar',
                  'aria-label': t('readingProgress'),
                  'aria-valuemin': 0,
                  'aria-valuemax': 100,
                  'aria-valuenow': Math.round(percent * 100),
                  'data-finished': finished ? 'true' : undefined,
                },
                h('div', { className: 'bs-card-progress-fill', style: { width: `${percent * 100}%` } }),
              )
            : null,
        ),
      )
    }

    function BookRow({ book, base = '', t, onOpen, onDelete, confirming, deleting, onAskDelete, onCancelDelete, onRename, onEditTags, onGenerateAudio }) {
      const percent = bookPercent(book)
      const finished = bookStatus(book) === 'finished'
      const subParts = bookSubParts(book, t)
      const coverSrc = bookCoverUrl(book, base)
      const [coverFailed, setCoverFailed] = useState(false)
      const [menuOpen, setMenuOpen] = useState(false)
      const [menuUp, setMenuUp] = useState(false)
      const actionsRef = useRef(null)

      useEffect(() => {
        if (!menuOpen) return undefined
        const onPointerDown = (event) => {
          const node = actionsRef.current
          if (node !== null && !node.contains(event.target)) setMenuOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          setMenuOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [menuOpen])

      const thumb = h(
        'span',
        { className: 'bs-row-thumb', style: coverStyle(book) },
        coverSrc !== '' && !coverFailed
          ? h('img', {
              className: 'bs-row-cover',
              src: coverSrc,
              alt: '',
              loading: 'lazy',
              decoding: 'async',
              onError: () => setCoverFailed(true),
            })
          : null,
        h('span', { className: 'bs-row-format' }, String(book.format || '').toUpperCase()),
      )

      if (confirming) {
        return h(
          'article',
          { className: 'bs-row bs-row-confirming', role: 'listitem', 'aria-label': t('deleteTitle') },
          thumb,
          h(
            'div',
            { className: 'bs-row-text' },
            h('span', { className: 'bs-row-title' }, t('deleteTitle')),
            h('span', { className: 'bs-row-sub', title: t('deleteBody', { title: book.title }) }, t('deleteBody', { title: book.title })),
          ),
          h(
            'div',
            { className: 'bs-row-confirm-actions' },
            h(
              'button',
              { type: 'button', className: 'bs-row-confirm-button danger', disabled: deleting, onClick: () => onDelete(book) },
              deleting ? t('deleting') : t('confirmDelete'),
            ),
            h('button', { type: 'button', className: 'bs-row-confirm-button', disabled: deleting, onClick: onCancelDelete }, t('cancel')),
          ),
        )
      }

      return h(
        'article',
        { className: 'bs-row', role: 'listitem', 'data-finished': finished ? 'true' : undefined },
        h(
          'button',
          {
            type: 'button',
            className: 'bs-row-open',
            onClick: () => onOpen(book),
            'aria-label': t('openBook', { title: book.title || t('untitled') }),
          },
          thumb,
          h(
            'span',
            { className: 'bs-row-text' },
            h('span', { className: 'bs-row-title', title: book.title }, book.title || t('untitled')),
            h(
              'span',
              { className: 'bs-row-sub', title: subParts.filter(Boolean).join(' · ') },
              subParts.filter(Boolean).join(' · '),
            ),
            percent > 0 && !finished
              ? h(
                  'span',
                  {
                    className: 'bs-row-progress',
                    role: 'progressbar',
                    'aria-label': t('readingProgress'),
                    'aria-valuemin': 0,
                    'aria-valuemax': 100,
                    'aria-valuenow': Math.round(percent * 100),
                  },
                  h('span', { className: 'bs-row-progress-fill', style: { width: `${percent * 100}%` } }),
                )
              : null,
          ),
        ),
        h(
          'div',
          { className: 'bs-row-actions', ref: actionsRef },
          h(
            'button',
            {
              type: 'button',
              className: 'bs-row-more',
              onClick: () => {
                const node = actionsRef.current
                const button = node ? node.querySelector('.bs-row-more') : null
                const scroller = node ? node.closest('.bs-scroll') : null
                if (button && scroller) {
                  // Roughly the height of the three-item menu: flip it above
                  // the row so the last rows of a short list stay reachable.
                  setMenuUp(button.getBoundingClientRect().bottom + 120 > scroller.getBoundingClientRect().bottom)
                }
                setMenuOpen((value) => !value)
              },
              'aria-haspopup': 'menu',
              'aria-expanded': menuOpen,
              title: t('more'),
              'aria-label': t('more'),
            },
            h(MoreIcon),
          ),
          !menuOpen
            ? null
            : h(
                'div',
                { className: menuUp ? 'bs-row-menu bs-row-menu-up' : 'bs-row-menu', role: 'menu', 'aria-label': t('more') },
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => {
                      setMenuOpen(false)
                      onRename(book, 'title')
                    },
                  },
                  t('rename'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => {
                      setMenuOpen(false)
                      onEditTags(book)
                    },
                  },
                  t('bookTags'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    onClick: () => {
                      setMenuOpen(false)
                      onGenerateAudio(book)
                    },
                  },
                  t('audiobookMenu'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    className: 'bs-row-menu-danger',
                    onClick: () => {
                      setMenuOpen(false)
                      onAskDelete(book)
                    },
                  },
                  t('delete'),
                ),
              ),
        ),
      )
    }

    function sortBookList(list, mode) {
      const titleOf = (book) => String(book && book.title ? book.title : '')
      const authorOf = (book) => String(book && book.author ? book.author : '').trim()
      const compareTitle = (left, right) => titleOf(left).localeCompare(titleOf(right), undefined, { numeric: true, sensitivity: 'base' })
      return list.slice().sort((left, right) => {
        if (mode === 'read') {
          const leftRead = Number(left.progress && left.progress.updatedAt) || 0
          const rightRead = Number(right.progress && right.progress.updatedAt) || 0
          if (leftRead !== rightRead) return rightRead - leftRead
          return (Number(right.addedAt) || 0) - (Number(left.addedAt) || 0)
        }
        if (mode === 'title') return compareTitle(left, right)
        if (mode === 'author') {
          const leftAuthor = authorOf(left)
          const rightAuthor = authorOf(right)
          if (leftAuthor === '' && rightAuthor !== '') return 1
          if (rightAuthor === '' && leftAuthor !== '') return -1
          const order = leftAuthor.localeCompare(rightAuthor, undefined, { sensitivity: 'base' })
          return order !== 0 ? order : compareTitle(left, right)
        }
        return (Number(right.addedAt) || 0) - (Number(left.addedAt) || 0)
      })
    }

    // ----- [shelf:tags] -----
    // Tag manager and per-book tag assignment.
    function BookTagsDialog({ t, book, tags, saving, error, onClose, onSave, onCreateTag }) {
      const [status, setStatus] = useState(book.statusManual ? book.status : 'auto')
      const [selected, setSelected] = useState(() => new Set(Array.isArray(book.tags) ? book.tags : []))
      const [available, setAvailable] = useState(tags)
      const [newName, setNewName] = useState('')
      const [creating, setCreating] = useState(false)
      const [createError, setCreateError] = useState('')

      useEffect(() => {
        setAvailable((current) => {
          const known = new Set(current.map((tag) => tag.id))
          const added = tags.filter((tag) => !known.has(tag.id))
          return added.length === 0 ? current : [...current, ...added]
        })
      }, [tags])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      const toggle = (id) => {
        setSelected((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const create = async () => {
        const name = newName.trim()
        if (name === '' || creating) return
        setCreating(true)
        setCreateError('')
        try {
          const tag = await onCreateTag(name)
          setAvailable((current) => [...current, tag])
          setSelected((current) => new Set([...current, tag.id]))
          setNewName('')
        } catch (failure) {
          setCreateError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setCreating(false)
        }
      }

      const statusChoices = [
        ['auto', t('statusAuto')],
        ...STATUS_CATEGORIES.map((value) => [value, t(STATUS_LABEL_KEYS[value])]),
      ]

      const submit = (event) => {
        event.preventDefault()
        if (saving) return
        onSave({ status: status === 'auto' ? null : status, tags: Array.from(selected) })
      }

      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: saving ? undefined : onClose }),
        h(
          'div',
          {
            className: 'bs-apple-dialog bs-tag-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('bookTags'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('bookTags')),
              h('p', { className: 'bs-apple-hint' }, book.title || t('untitled')),
            ),
            h(
              'button',
              { type: 'button', className: 'bs-icon-button', onClick: onClose, title: t('dismiss'), 'aria-label': t('dismiss') },
              h(CloseIcon),
            ),
          ),
          h(
            'form',
            { className: 'bs-rename-form', onSubmit: submit },
            h(
              'div',
              { className: 'bs-tag-body' },
              h(
                'div',
                { className: 'bs-tag-section' },
                h('p', { className: 'bs-tag-section-title' }, t('statusLabel')),
                h(
                  'div',
                  { className: 'bs-tag-choices' },
                  statusChoices.map(([value, label]) =>
                    h(
                      'button',
                      {
                        key: value,
                        type: 'button',
                        className: 'bs-tag-choice',
                        'aria-pressed': status === value,
                        onClick: () => setStatus(value),
                      },
                      label,
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'bs-tag-section' },
                h('p', { className: 'bs-tag-section-title' }, t('tagsLabel')),
                available.length === 0
                  ? h('p', { className: 'bs-tag-empty' }, t('tagsEmpty'))
                  : h(
                      'div',
                      { className: 'bs-tag-choices' },
                      available.map((tag) =>
                        h(
                          'button',
                          {
                            key: tag.id,
                            type: 'button',
                            className: 'bs-tag-choice',
                            'aria-pressed': selected.has(tag.id),
                            onClick: () => toggle(tag.id),
                          },
                          tag.name,
                        ),
                      ),
                    ),
              ),
              h(
                'div',
                { className: 'bs-tag-section' },
                h('p', { className: 'bs-tag-section-title' }, t('newTagLabel')),
                h(
                  'div',
                  { className: 'bs-tag-new' },
                  h('input', {
                    type: 'text',
                    className: 'bs-rename-input',
                    value: newName,
                    maxLength: 32,
                    placeholder: t('newTagPlaceholder'),
                    'aria-label': t('newTagPlaceholder'),
                    onChange: (event) => setNewName(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      void create()
                    },
                  }),
                  h(
                    'button',
                    { type: 'button', className: 'bs-button', disabled: creating || newName.trim() === '', onClick: create },
                    creating ? t('saving') : t('createTag'),
                  ),
                ),
              ),
              createError !== ''
                ? h('p', { className: 'bs-rename-error', role: 'alert', style: { margin: '0 18px 10px' } }, createError)
                : null,
              error !== ''
                ? h('p', { className: 'bs-rename-error', role: 'alert', style: { margin: '0 18px 10px' } }, error)
                : null,
            ),
            h(
              'div',
              { className: 'bs-apple-foot bs-tag-foot' },
              h('button', { type: 'button', className: 'bs-button', onClick: onClose, disabled: saving }, t('cancel')),
              h(
                'button',
                { type: 'submit', className: 'bs-button bs-button-primary', disabled: saving },
                saving ? t('saving') : t('save'),
              ),
            ),
          ),
        ),
      )
    }

    function TagManagerDialog({ t, tags, books, onClose, onCreate, onRename, onDelete, onChanged }) {
      const [newName, setNewName] = useState('')
      const [drafts, setDrafts] = useState(() => Object.fromEntries(tags.map((tag) => [tag.id, tag.name])))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [confirm, setConfirm] = useState(null)

      useEffect(() => {
        setDrafts((current) => {
          const next = { ...current }
          for (const tag of tags) if (!(tag.id in next)) next[tag.id] = tag.name
          return next
        })
      }, [tags])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || busy) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onClose, busy])

      const counts = (() => {
        const values = new Map()
        for (const book of books) {
          for (const id of Array.isArray(book.tags) ? book.tags : []) values.set(id, (values.get(id) || 0) + 1)
        }
        return values
      })()

      const report = (failure) => {
        setError(failure instanceof Error ? failure.message : String(failure))
      }

      const create = async () => {
        const name = newName.trim()
        if (name === '' || busy) return
        setBusy(true)
        setError('')
        try {
          const tag = await onCreate(name)
          setDrafts((current) => ({ ...current, [tag.id]: tag.name }))
          setNewName('')
          onChanged()
        } catch (failure) {
          report(failure)
        } finally {
          setBusy(false)
        }
      }

      const rename = async (tag) => {
        const name = (drafts[tag.id] || '').trim()
        if (name === '' || name === tag.name || busy) return
        setBusy(true)
        setError('')
        try {
          const updated = await onRename(tag.id, name)
          setDrafts((current) => ({ ...current, [updated.id]: updated.name }))
          onChanged()
        } catch (failure) {
          report(failure)
        } finally {
          setBusy(false)
        }
      }

      const remove = async (tag) => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await onDelete(tag.id)
          setConfirm(null)
          setDrafts((current) => {
            const next = { ...current }
            delete next[tag.id]
            return next
          })
          onChanged()
        } catch (failure) {
          report(failure)
        } finally {
          setBusy(false)
        }
      }

      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: busy ? undefined : onClose }),
        h(
          'div',
          {
            className: 'bs-apple-dialog bs-tag-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('manageTags'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('manageTags')),
              h('p', { className: 'bs-apple-hint' }, t('manageTagsHint')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bs-icon-button',
                onClick: onClose,
                title: t('dismiss'),
                'aria-label': t('dismiss'),
                disabled: busy,
              },
              h(CloseIcon),
            ),
          ),
          h(
            'div',
            { className: 'bs-tag-section' },
            h(
              'div',
              { className: 'bs-tag-new' },
              h('input', {
                type: 'text',
                className: 'bs-rename-input',
                value: newName,
                maxLength: 32,
                placeholder: t('newTagPlaceholder'),
                'aria-label': t('newTagPlaceholder'),
                onChange: (event) => setNewName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void create()
                },
              }),
              h(
                'button',
                { type: 'button', className: 'bs-button', disabled: busy || newName.trim() === '', onClick: create },
                t('createTag'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'bs-tag-manage-list' },
            tags.length === 0
              ? h('p', { className: 'bs-tag-empty' }, t('tagsEmpty'))
              : tags.map((tag) =>
                  h(
                    'div',
                    { key: tag.id, className: 'bs-tag-manage-row' },
                    h('input', {
                      type: 'text',
                      className: 'bs-rename-input',
                      value: drafts[tag.id] ?? tag.name,
                      maxLength: 32,
                      'aria-label': t('tagNameLabel'),
                      onChange: (event) => setDrafts((current) => ({ ...current, [tag.id]: event.target.value })),
                      onKeyDown: (event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void rename(tag)
                      },
                    }),
                    h('span', { className: 'bs-tag-manage-count' }, t('tagBookCount', { count: counts.get(tag.id) || 0 })),
                    confirm !== null && confirm.id === tag.id
                      ? h(
                          React.Fragment,
                          null,
                          h(
                            'button',
                            { type: 'button', className: 'bs-button bs-tag-danger', disabled: busy, onClick: () => remove(tag) },
                            t('confirmDeleteTag'),
                          ),
                          h(
                            'button',
                            { type: 'button', className: 'bs-button', disabled: busy, onClick: () => setConfirm(null) },
                            t('cancel'),
                          ),
                        )
                      : h(
                          React.Fragment,
                          null,
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'bs-button',
                              disabled: busy || (drafts[tag.id] ?? tag.name).trim() === tag.name,
                              onClick: () => rename(tag),
                            },
                            t('renameTag'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'bs-icon-button bs-tag-danger',
                              disabled: busy,
                              onClick: () => setConfirm({ id: tag.id }),
                              title: t('deleteTag'),
                              'aria-label': t('deleteTag'),
                            },
                            h(TrashIcon),
                          ),
                        ),
                  ),
                ),
          ),
          confirm !== null
            ? h(
                'p',
                { className: 'bs-tag-section bs-tag-empty' },
                t('deleteTagHint', { count: counts.get(confirm.id) || 0 }),
              )
            : null,
          error !== ''
            ? h('p', { className: 'bs-rename-error', role: 'alert', style: { margin: '0 18px 10px' } }, error)
            : null,
          h(
            'div',
            { className: 'bs-apple-foot bs-tag-foot' },
            h('button', { type: 'button', className: 'bs-button', onClick: onClose, disabled: busy }, t('done')),
          ),
        ),
      )
    }

    function FinishBookDialog({ t, book, saving, error, onConfirm, onDismiss }) {
      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || saving) return
          event.preventDefault()
          event.stopPropagation()
          onDismiss()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [onDismiss, saving])

      return h(
        React.Fragment,
        null,
        h('div', { className: 'bs-apple-backdrop', onClick: saving ? undefined : onDismiss }),
        h(
          'div',
          {
            className: 'bs-apple-dialog bs-tag-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('finishPromptTitle'),
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { className: 'bs-apple-head' },
            h(
              'div',
              { className: 'bs-apple-heading' },
              h('h2', { className: 'bs-apple-title' }, t('finishPromptTitle')),
              h('p', { className: 'bs-apple-hint' }, book.title || t('untitled')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bs-icon-button',
                onClick: onDismiss,
                title: t('dismiss'),
                'aria-label': t('dismiss'),
                disabled: saving,
              },
              h(CloseIcon),
            ),
          ),
          h('p', { className: 'bs-finish-body' }, t('finishPromptBody', { title: book.title || t('untitled') })),
          error !== ''
            ? h('p', { className: 'bs-rename-error', role: 'alert', style: { margin: '0 18px 10px' } }, error)
            : null,
          h(
            'div',
            { className: 'bs-apple-foot bs-tag-foot' },
            h('button', { type: 'button', className: 'bs-button', onClick: onDismiss, disabled: saving }, t('finishPromptDismiss')),
            h(
              'button',
              { type: 'button', className: 'bs-button bs-button-primary', onClick: onConfirm, disabled: saving },
              saving ? t('saving') : t('finishPromptConfirm'),
            ),
          ),
        ),
      )
    }

    function ErrorPanel({ t, message, onRetry }) {
      return h(
        'div',
        { className: 'bs-center' },
        h('div', { className: 'bs-empty-icon' }, h(AlertIcon)),
        h('h2', { className: 'bs-empty-title' }, t('loadFailedTitle')),
        h('p', { className: 'bs-empty-text' }, message),
        h('p', { className: 'bs-empty-text' }, t('serviceHint')),
        h('button', { type: 'button', className: 'bs-button', onClick: onRetry }, t('retry')),
      )
    }

    // View navigation belongs to the plugin lifetime, not a mounted main slot.
    // Durable per-book progress/settings continue to belong to the Host.
    function useShelfView(viewState, key) {
      const [value, setValue] = useState(() => viewState[key])
      const update = useCallback((next) => {
        viewState[key] = next
        setValue(next)
      }, [viewState, key])
      return [value, update]
    }

    function Bookshelf(props) {
      const t = props.t
      const viewState = props.viewState
      useState(() => {
        try {
          const key = ['bookshelf', 'open', 'v1'].join('.')
          const request = JSON.parse(sessionStorage.getItem(key) || 'null')
          if (request && typeof request.bookId === 'string' && request.bookId) {
            viewState.openBookId = request.bookId
            sessionStorage.removeItem(key)
          }
        } catch { /* Storage may be unavailable; ordinary tab restoration still works. */ }
        return null
      })
      const [books, setBooks] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [reload, setReload] = useState(0)
      const [openBookId, setOpenBookId] = useShelfView(viewState, 'openBookId')
      const open = Array.isArray(books) ? books.find((book) => book.id === openBookId) || null : null
      const setOpen = useCallback((book) => setOpenBookId(book ? book.id : null), [setOpenBookId])
      const [busy, setBusy] = useState(null)
      const [notice, setNotice] = useState(null)
      const [deleteTarget, setDeleteTarget] = useState(null)
      const [deleting, setDeleting] = useState(false)
      const [dragging, setDragging] = useState(false)
      const fileInputRef = useRef(null)
      const [query, setStoredQuery] = useShelfView(viewState, 'query')
      const [sortMode, setStoredSort] = useShelfView(viewState, 'sortMode')
      const [category, setStoredCategory] = useShelfView(viewState, 'category')
      const [layout, setStoredLayout] = useShelfView(viewState, 'layout')
      const activeLayout = layout === 'list' ? 'list' : 'grid'
      const [tagDefinitions, setTagDefinitions] = useState([])
      const [finishPrompt, setFinishPrompt] = useState(null)
      const [finishSaving, setFinishSaving] = useState(false)
      const [finishError, setFinishError] = useState('')
      const [tagTarget, setTagTarget] = useState(null)
      const [audioBook, setAudioBook] = useState(null)
      const [settingsInitialTab, setSettingsInitialTab] = useState('reading')
      const [tagSaving, setTagSaving] = useState(false)
      const [tagError, setTagError] = useState('')
      const [tagsOpen, setTagsOpen] = useState(false)
      const shelfScrollRef = useRef(null)
      const setQuery = useCallback((value) => {
        viewState.scrollTop = 0
        if (shelfScrollRef.current) shelfScrollRef.current.scrollTop = 0
        setStoredQuery(value)
      }, [viewState, setStoredQuery])
      const setSortMode = useCallback((value) => {
        viewState.scrollTop = 0
        if (shelfScrollRef.current) shelfScrollRef.current.scrollTop = 0
        setStoredSort(value)
      }, [viewState, setStoredSort])
      const setCategory = useCallback((value) => {
        viewState.scrollTop = 0
        if (shelfScrollRef.current) shelfScrollRef.current.scrollTop = 0
        setStoredCategory(value)
      }, [viewState, setStoredCategory])
      const setLayout = useCallback((value) => {
        const next = value === 'list' ? 'list' : 'grid'
        viewState.scrollTop = 0
        if (shelfScrollRef.current) shelfScrollRef.current.scrollTop = 0
        setStoredLayout(next)
        storeLayout(next)
      }, [viewState, setStoredLayout])
      const [appleOpen, setAppleOpen] = useState(false)
      const [capabilities, setCapabilities] = useState(null)
      const [appleBooksEnabled, setAppleBooksEnabled] = useState(() => {
        try { return localStorage.getItem(APPLE_BOOKS_ENABLED_KEY) !== '0' } catch { return true }
      })
      const updateAppleBooksEnabled = useCallback((value) => {
        const enabled = Boolean(value)
        setAppleBooksEnabled(enabled)
        try { if (enabled) localStorage.removeItem(APPLE_BOOKS_ENABLED_KEY); else localStorage.setItem(APPLE_BOOKS_ENABLED_KEY, '0') } catch {}
      }, [])
      const appleBooksAvailable = capabilities?.appleBooks === true
      const [linkOpen, setLinkOpen] = useState(false)
      const [renameState, setRenameState] = useState(null)
      const [renameSaving, setRenameSaving] = useState(false)
      const [renameError, setRenameError] = useState('')
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [defaultReadingSettings, setDefaultReadingSettings] = useState(null)
      const [discussionWorkspace, setDiscussionWorkspace] = useState(() => {
        try { return localStorage.getItem(DISCUSSION_WORKSPACE_KEY) || '' } catch { return '' }
      })
      const updateDiscussionWorkspace = useCallback((value) => {
        const id = typeof value === 'string' ? value : ''
        setDiscussionWorkspace(id)
        try { if (id === '') localStorage.removeItem(DISCUSSION_WORKSPACE_KEY); else localStorage.setItem(DISCUSSION_WORKSPACE_KEY, id) } catch {}
      }, [])
      const presetWorkspace = Array.isArray(props.workspaces)
        ? props.workspaces.find((item) => item && item.workspaceId === discussionWorkspace)
        : undefined
      const coverAttemptsRef = useRef(new Set())
      const defaultsRef = useRef(null)
      const base = useMemo(() => transportBase(), [])
      const effectiveDefaults = defaultReadingSettings || DEFAULT_READING_SETTINGS
      const closeReader = useCallback(
        async (percent) => {
          const book = open
          setOpen(null)
          if (book === null) {
            setReload((value) => value + 1)
            return
          }
          // The reader flushed its last page before calling back; wait for that
          // write so the refreshed list already reflects where reading stopped.
          const pending = stateWrites.get(resourceUrl(base, `${API_ROOT}/books/${book.id}/state`))
          if (pending) await pending.catch(() => undefined)
          setReload((value) => value + 1)
          if (typeof percent === 'number' && percent >= FINISHED_PERCENT && book.status !== 'finished') {
            setFinishError('')
            setFinishSaving(false)
            setFinishPrompt(book)
          }
        },
        [base, open, setOpen],
      )

      useEffect(() => {
        if (books === null) return
        if (openBookId !== null && !books.some((book) => book.id === openBookId)) setOpenBookId(null)
        if (shelfScrollRef.current) shelfScrollRef.current.scrollTop = viewState.scrollTop
      }, [books, openBookId, setOpenBookId, viewState])

      const openRename = useCallback((book, field) => {
        setRenameError('')
        setRenameState({ book, field })
      }, [])

      const closeRename = useCallback(() => {
        if (renameSaving) return
        setRenameState(null)
        setRenameError('')
      }, [renameSaving])

      const saveRename = useCallback(
        async (values) => {
          if (renameState === null) return
          setRenameSaving(true)
          setRenameError('')
          try {
            await requestJson(base, `/books/${renameState.book.id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            })
            setRenameState(null)
            setNotice({ kind: 'ok', text: t('renamed') })
            setReload((value) => value + 1)
          } catch (failure) {
            setRenameError(t('renameFailed', { message: failure instanceof Error ? failure.message : String(failure) }))
          } finally {
            setRenameSaving(false)
          }
        },
        [base, renameState, t],
      )

      // ---------------------------------------------------------- tag edits
      const openBookTags = useCallback((book) => {
        setTagError('')
        setTagTarget(book)
      }, [])

      const closeBookTags = useCallback(() => {
        if (tagSaving) return
        setTagTarget(null)
        setTagError('')
      }, [tagSaving])

      const createTag = useCallback(
        async (name) => {
          const payload = await requestJson(base, '/tags', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          const tag = payload && payload.tag
          if (!tag || typeof tag.id !== 'string') throw new Error(t('tagRequestFailed'))
          setTagDefinitions((current) => (current.some((entry) => entry.id === tag.id) ? current : [...current, tag]))
          return tag
        },
        [base, t],
      )

      const renameTag = useCallback(
        async (id, name) => {
          const payload = await requestJson(base, `/tags/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          const tag = payload && payload.tag
          if (!tag || typeof tag.id !== 'string') throw new Error(t('tagRequestFailed'))
          setTagDefinitions((current) => current.map((entry) => (entry.id === tag.id ? tag : entry)))
          return tag
        },
        [base, t],
      )

      const deleteTag = useCallback(
        async (id) => {
          const payload = await requestJson(base, `/tags/${id}`, { method: 'DELETE' })
          setTagDefinitions((current) => current.filter((entry) => entry.id !== id))
          if (category === `tag:${id}`) setCategory('all')
          return payload
        },
        [base, category, setCategory],
      )

      const saveBookTags = useCallback(
        async (values) => {
          if (tagTarget === null) return
          setTagSaving(true)
          setTagError('')
          try {
            await requestJson(base, `/books/${tagTarget.id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            })
            setTagTarget(null)
            setNotice({ kind: 'ok', text: t('tagsSaved') })
            setReload((value) => value + 1)
          } catch (failure) {
            setTagError(t('tagsSaveFailed', { message: failure instanceof Error ? failure.message : String(failure) }))
          } finally {
            setTagSaving(false)
          }
        },
        [base, tagTarget, t],
      )

      // ------------------------------------------------------- finish prompt
      const dismissFinishPrompt = useCallback(() => {
        if (finishSaving) return
        setFinishPrompt(null)
        setFinishError('')
      }, [finishSaving])

      const confirmFinished = useCallback(async () => {
        if (finishPrompt === null || finishSaving) return
        setFinishSaving(true)
        setFinishError('')
        try {
          await requestJson(base, `/books/${finishPrompt.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'finished' }),
          })
          setFinishPrompt(null)
          setNotice({ kind: 'ok', text: t('markedFinished') })
          setReload((value) => value + 1)
        } catch (failure) {
          setFinishError(
            t('finishPromptSaveFailed', { message: failure instanceof Error ? failure.message : String(failure) }),
          )
        } finally {
          setFinishSaving(false)
        }
      }, [base, finishPrompt, finishSaving, t])

      useEffect(() => {
        if (books === null) return
        if (typeof category !== 'string' || category === 'all') return
        if (category.startsWith('tag:')) {
          const id = category.slice('tag:'.length)
          if (!tagDefinitions.some((tag) => tag.id === id)) setCategory('all')
          return
        }
        if (!STATUS_CATEGORIES.includes(category)) setCategory('all')
      }, [books, category, tagDefinitions, setCategory])

      useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError('')
        requestJson(base, '/books')
          .then((payload) => {
            if (cancelled) return
            setBooks(Array.isArray(payload && payload.books) ? payload.books : [])
            setTagDefinitions(Array.isArray(payload && payload.tags) ? payload.tags : [])
          })
          .catch((failure) => {
            if (cancelled) return
            setError(failure instanceof TypeError ? t('serviceUnreachable') : failure instanceof Error ? failure.message : String(failure))
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [base, reload])

      useEffect(() => {
        let cancelled = false
        readDefaults(base)
          .then((value) => {
            if (cancelled || defaultsRef.current !== null) return
            const next = { ...DEFAULT_READING_SETTINGS, ...value }
            defaultsRef.current = next
            setDefaultReadingSettings(next)
          })
          .catch((failure) => {
            if (cancelled || defaultsRef.current !== null) return
            console.error('bookshelf: could not load default reading settings', failure)
            defaultsRef.current = { ...DEFAULT_READING_SETTINGS }
            setDefaultReadingSettings({ ...DEFAULT_READING_SETTINGS })
          })
        return () => {
          cancelled = true
        }
      }, [base])

      useEffect(() => {
        let cancelled = false
        requestJson(base, '/capabilities')
          .then((value) => { if (!cancelled) setCapabilities(value && typeof value === 'object' ? value : { appleBooks: false }) })
          .catch((failure) => {
            if (cancelled) return
            console.error('bookshelf: could not load platform capabilities', failure)
            setCapabilities({ appleBooks: false })
          })
        return () => { cancelled = true }
      }, [base])

      const updateDefaultSettings = useCallback(
        (patch) => {
          const current = defaultsRef.current || DEFAULT_READING_SETTINGS
          const next = { ...current, ...patch }
          defaultsRef.current = next
          setDefaultReadingSettings(next)
          writeDefaults(base, next).catch((failure) => {
            setNotice({
              kind: 'error',
              text: t('defaultsSaveFailed', { message: failure instanceof Error ? failure.message : String(failure) }),
            })
          })
        },
        [base, t],
      )

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 6500)
        return () => clearTimeout(timer)
      }, [notice])

      useEffect(() => {
        if (!Array.isArray(books) || books.length === 0) return undefined
        let cancelled = false
        const pending = books
          .filter(
            (book) =>
              book &&
              book.format === 'epub' &&
              typeof book.id === 'string' &&
              !book.cover &&
              !coverAttemptsRef.current.has(book.id) &&
              (Number(book.bytes) || 0) < 48 * 1024 * 1024,
          )
          .slice(0, 40)
        if (pending.length === 0) return undefined
        ;(async () => {
          let changed = false
          for (const book of pending) {
            coverAttemptsRef.current.add(book.id)
            try {
              const response = await fetch(resourceUrl(base, `${API_ROOT}/books/${book.id}/file`))
              if (!response.ok) continue
              const bytes = new Uint8Array(await response.arrayBuffer())
              const module = await loadEpubModule(base)
              const cover = typeof module.readEpubCover === 'function' ? module.readEpubCover(bytes) : null
              if (cover && (await putBookCover(base, book.id, cover))) changed = true
            } catch (failure) {
              console.error('bookshelf: could not extract an EPUB cover', failure)
            }
          }
          if (changed && !cancelled) setReload((value) => value + 1)
        })()
        return () => {
          cancelled = true
        }
      }, [books, base])

      useEffect(() => {
        if (open === null && deleteTarget === null) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
          if (deleteTarget !== null) {
            setDeleteTarget(null)
            return
          }
          if (open !== null && document.querySelector('.bs-reader[data-focus-mode="true"]') !== null) return
          if (open !== null) {
            event.preventDefault()
            closeReader()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [open, deleteTarget, closeReader])

      const importFiles = useCallback(
        async (fileList) => {
          const files = Array.from(fileList || []).filter((file) => file && typeof file.arrayBuffer === 'function')
          if (files.length === 0) return
          let imported = 0
          let failure = ''
          for (const file of files) {
            setBusy(file.name)
            try {
              const format = formatOf(file)
              if (format === null) throw new Error(t('unsupportedFile', { name: file.name }))
              if (file.size > MAX_IMPORT_BYTES) throw new Error(t('tooLarge', { name: file.name }))
              const bytes = new Uint8Array(await file.arrayBuffer())
              let title = String(file.name || '').replace(/\.[^.]+$/, '')
              let author = ''
              let epubModule = null
              if (format === 'epub') {
                try {
                  epubModule = await loadEpubModule(base)
                  const metadata = epubModule.readEpubMetadata(bytes)
                  if (metadata.title) title = metadata.title
                  if (metadata.author) author = metadata.author
                } catch {
                  // Keep the filename title; the reader reports a parse failure later.
                }
              }
              const query = new URLSearchParams({
                name: file.name || `${title}.${format}`,
                title,
                author,
                format,
              })
              const response = await fetch(resourceUrl(base, `${API_ROOT}/books?${query.toString()}`), {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream' },
                body: bytes,
              })
              const payload = await parseResponse(response)
              if (epubModule !== null && payload && payload.book && payload.book.id) {
                try {
                  const cover = typeof epubModule.readEpubCover === 'function' ? epubModule.readEpubCover(bytes) : null
                  if (cover) await putBookCover(base, payload.book.id, cover)
                } catch {
                  // A missing cover must not fail the import.
                }
              }
              imported += 1
            } catch (importFailure) {
              failure = importFailure instanceof TypeError ? t('serviceUnreachable') : importFailure instanceof Error ? importFailure.message : String(importFailure)
            }
          }
          setBusy(null)
          if (imported > 0) {
            setNotice({ kind: 'ok', text: t('importedCount', { count: imported }) })
            setReload((value) => value + 1)
          }
          if (failure !== '') setNotice({ kind: 'error', text: t('importFailed', { message: failure }) })
        },
        [base, t],
      )

      const pickFiles = useCallback(() => {
        if (busy !== null) return
        const input = fileInputRef.current
        if (input === null) return
        // Reset first so choosing the same file twice still fires `change`.
        input.value = ''
        input.click()
      }, [busy])

      const onFileInputChange = useCallback(
        (event) => {
          // Copy the FileList before resetting the input: resetting clears the
          // live list and would import nothing.
          const files = Array.from(event.currentTarget.files || [])
          event.currentTarget.value = ''
          void importFiles(files)
        },
        [importFiles],
      )

      const removeBook = useCallback(
        async (book) => {
          setDeleting(true)
          try {
            await requestJson(base, `/books/${book.id}`, { method: 'DELETE' })
            setBooks((values) => (Array.isArray(values) ? values.filter((entry) => entry.id !== book.id) : values))
            setDeleteTarget(null)
            setNotice({ kind: 'ok', text: t('deleted') })
          } catch (failure) {
            setNotice({
              kind: 'error',
              text: t('deleteFailed', { message: failure instanceof Error ? failure.message : String(failure) }),
            })
          } finally {
            setDeleting(false)
          }
        },
        [base, t],
      )

      const onDragEnter = useCallback((event) => {
        if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }, [])

      const onDragOver = useCallback((event) => {
        if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }, [])

      const onDragLeave = useCallback((event) => {
        if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
        setDragging(false)
      }, [])

      const onDrop = useCallback(
        (event) => {
          if (!event.dataTransfer) return
          event.preventDefault()
          setDragging(false)
          void importFiles(event.dataTransfer.files)
        },
        [importFiles],
      )

      if (open !== null) {
        const Reader = open.format === 'pdf' ? PdfReader : EpubReader
        // Resolve defaults before mounting; an early mount would freeze fallback
        // settings until the next open when the defaults request finishes later.
        if (open.format === 'epub' && defaultReadingSettings === null) {
          return h('div', { className: 'bs-root' }, h('style', null, CSS), h(ReaderState, { message: t('loading') }))
        }
        return h(Reader, { key: open.id, t, book: open, onBack: closeReader, defaultSettings: effectiveDefaults, discussion: props.discussion, workspaces: props.workspaces, discussionWorkspace: presetWorkspace ? presetWorkspace.workspaceId : '' })
      }

      const count = Array.isArray(books) ? books.length : 0
      const isBusy = busy !== null
      const normalizedQuery = query.trim().toLocaleLowerCase()
      // Category counts ignore the search box: a tab always reports how many
      // books it holds, while the grid below narrows with the query.
      const statusCounts = { unread: 0, reading: 0, finished: 0 }
      const tagCounts = new Map()
      if (Array.isArray(books)) {
        for (const book of books) {
          if (STATUS_CATEGORIES.includes(book.status)) statusCounts[book.status] += 1
          for (const id of Array.isArray(book.tags) ? book.tags : []) tagCounts.set(id, (tagCounts.get(id) || 0) + 1)
        }
      }
      const categoryTabs = [
        { key: 'all', label: t('categoryAll'), count },
        ...STATUS_CATEGORIES.map((status) => ({
          key: status,
          label: t(STATUS_LABEL_KEYS[status]),
          count: statusCounts[status],
        })),
        ...tagDefinitions.map((tag) => ({
          key: `tag:${tag.id}`,
          label: tag.name,
          count: tagCounts.get(tag.id) || 0,
        })),
      ]
      const activeCategory = typeof category === 'string' && category !== '' ? category : 'all'
      const matchesCategory = (book) => {
        if (activeCategory === 'all') return true
        if (activeCategory.startsWith('tag:')) {
          return Array.isArray(book.tags) && book.tags.includes(activeCategory.slice('tag:'.length))
        }
        return book.status === activeCategory
      }
      const visibleBooks = (() => {
        const source = Array.isArray(books) ? books : []
        const inCategory = source.filter(matchesCategory)
        const filtered =
          normalizedQuery === ''
            ? inCategory
            : inCategory.filter((book) =>
                `${book.title || ''} ${book.author || ''} ${book.name || ''}`.toLocaleLowerCase().includes(normalizedQuery),
              )
        return sortBookList(filtered, sortMode)
      })()
      const showLoading = loading && books === null
      const showEmpty = !loading && error === '' && books !== null && books.length === 0
      const showCategoryEmpty =
        !loading && error === '' && books !== null && books.length > 0 && visibleBooks.length === 0 && normalizedQuery === ''
      const showNoResults =
        !loading && error === '' && books !== null && books.length > 0 && visibleBooks.length === 0 && normalizedQuery !== ''
      const bookViewProps = (book) => ({
        key: book.id,
        book,
        base,
        t,
        onOpen: (value) => setOpen(value),
        onDelete: removeBook,
        onAskDelete: (value) => setDeleteTarget(value),
        onCancelDelete: () => setDeleteTarget(null),
        onRename: openRename,
        onEditTags: openBookTags,
        onGenerateAudio: (value) => setAudioBook(value),
        confirming: deleteTarget !== null && deleteTarget.id === book.id,
        deleting: deleting && deleteTarget !== null && deleteTarget.id === book.id,
      })

      return h(
        'div',
        {
          className: 'bs-shelf bs-root',
          'data-layout': activeLayout,
          onDragEnter,
          onDragOver,
          onDragLeave,
          onDrop,
        },
        h('style', { key: 'style' }, CSS),
        h('input', {
          key: 'file-input',
          ref: fileInputRef,
          className: 'bs-file-input',
          type: 'file',
          accept: '.epub,.pdf,application/pdf,application/epub+zip',
          multiple: true,
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onFileInputChange,
        }),
        dragging
          ? h(
              'div',
              { className: 'bs-drop', key: 'drop' },
              h(PlusIcon, { size: 22 }),
              h('span', null, t('dropHint')),
            )
          : null,
        h(
          'header',
          { className: 'bs-header' },
          h(
            'div',
            { className: 'bs-heading' },
            h('h1', { className: 'bs-title' }, t('title')),
            h(
              'p',
              { className: 'bs-subtitle' },
              isBusy
                ? t('importingFile', { name: busy })
                : count > 0
                  ? normalizedQuery !== ''
                    ? t('searchCount', { shown: visibleBooks.length, total: count })
                    : t('bookCount', { count })
                  : t('subtitle'),
            ),
          ),
          h(
            'div',
            { className: 'bs-header-actions' },
            appleBooksAvailable && appleBooksEnabled
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'bs-button bs-apple-button',
                    onClick: () => setAppleOpen(true),
                    disabled: isBusy,
                    title: t('importAppleBooks'),
                    'aria-label': t('importAppleBooks'),
                  },
                  h(BookIcon, { size: 14 }),
                  h('span', { className: 'bs-apple-button-label' }, t('appleBooks')),
                )
              : null,
            h(ImportMenu, {
              t,
              disabled: isBusy,
              busy: isBusy,
              onPickFiles: pickFiles,
              onLinkFolder: () => setLinkOpen(true),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'bs-icon-button',
                onClick: () => setTagsOpen(true),
                disabled: isBusy,
                title: t('manageTags'),
                'aria-label': t('manageTags'),
              },
              h(TagIcon),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bs-icon-button',
                onClick: () => {
                  setSettingsInitialTab('reading')
                  setSettingsOpen(true)
                },
                'aria-haspopup': 'dialog',
                'aria-expanded': settingsOpen,
                title: t('shelfSettings'),
                'aria-label': t('shelfSettings'),
              },
              h(SettingsIcon),
            ),
          ),
        ),
        count > 0
          ? h(
              'div',
              { className: 'bs-tabs', role: 'group', 'aria-label': t('categories') },
              categoryTabs.map((tab) =>
                h(
                  'button',
                  {
                    key: tab.key,
                    type: 'button',
                    className: 'bs-tab',
                    'aria-pressed': activeCategory === tab.key,
                    onClick: () => setCategory(tab.key),
                  },
                  h('span', null, tab.label),
                  h('span', { className: 'bs-tab-count' }, String(tab.count)),
                ),
              ),
            )
          : null,
        count > 0
          ? h(
              'div',
              { className: 'bs-shelf-tools' },
              h(
                'div',
                { className: 'bs-search' },
                h(SearchIcon),
                h('input', {
                  type: 'text',
                  className: 'bs-search-input',
                  value: query,
                  placeholder: t('searchPlaceholder'),
                  'aria-label': t('searchPlaceholder'),
                  spellCheck: false,
                  onChange: (event) => setQuery(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Escape' && query !== '') {
                      event.preventDefault()
                      event.stopPropagation()
                      setQuery('')
                    }
                  },
                }),
                query !== ''
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'bs-search-clear',
                        onClick: () => setQuery(''),
                        title: t('clearSearch'),
                        'aria-label': t('clearSearch'),
                      },
                      h(CloseIcon, { size: 13 }),
                    )
                  : null,
              ),
              h(
                'label',
                { className: 'bs-sort' },
                h('span', { className: 'bs-sort-label' }, t('sortBy')),
                h(
                  'select',
                  {
                    className: 'bs-sort-select',
                    value: sortMode,
                    'aria-label': t('sortBy'),
                    onChange: (event) => setSortMode(event.target.value),
                  },
                  h('option', { value: 'added' }, t('sortAdded')),
                  h('option', { value: 'read' }, t('sortRead')),
                  h('option', { value: 'title' }, t('sortTitle')),
                  h('option', { value: 'author' }, t('sortAuthor')),
                ),
              ),
              h(
                'div',
                { className: 'bs-layout-toggle', role: 'group', 'aria-label': t('layoutLabel') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'bs-layout-button',
                    'aria-pressed': activeLayout === 'grid',
                    title: t('layoutCover'),
                    'aria-label': t('layoutCover'),
                    onClick: () => setLayout('grid'),
                  },
                  h(GridIcon),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'bs-layout-button',
                    'aria-pressed': activeLayout === 'list',
                    title: t('layoutList'),
                    'aria-label': t('layoutList'),
                    onClick: () => setLayout('list'),
                  },
                  h(ListIcon, { size: 16 }),
                ),
              ),
            )
          : null,
        notice !== null
          ? h(
              'div',
              { className: `bs-banner bs-banner-${notice.kind}`, role: 'status', 'aria-live': 'polite' },
              h('span', null, notice.text),
              h(
                'button',
                { type: 'button', className: 'bs-banner-close', onClick: () => setNotice(null), 'aria-label': t('dismiss') },
                h(CloseIcon),
              ),
            )
          : null,
        h(
          'div',
          {
            className: 'bs-scroll',
            ref: shelfScrollRef,
            onScroll: (event) => { if (books !== null) viewState.scrollTop = event.currentTarget.scrollTop },
          },
          showLoading
            ? h('div', { className: 'bs-center' }, h(Spinner), h('div', { className: 'bs-empty-text' }, t('loading')))
            : error !== ''
              ? h(ErrorPanel, { t, message: t('loadFailed', { message: error }), onRetry: () => setReload((value) => value + 1) })
              : showEmpty
                ? h(
                    'div',
                    { className: 'bs-center' },
                    h('div', { className: 'bs-empty-icon' }, h(BookIcon, { size: 28 })),
                    h('h2', { className: 'bs-empty-title' }, t('emptyTitle')),
                    h('p', { className: 'bs-empty-text' }, t('emptyHint')),
                    h(
                      'div',
                      { className: 'bs-empty-actions' },
                      h(ImportMenu, {
                        t,
                        busy: isBusy,
                        onPickFiles: pickFiles,
                        onLinkFolder: () => setLinkOpen(true),
                      }),
                    ),
                  )
                : showCategoryEmpty
                  ? h(
                      'div',
                      { className: 'bs-center' },
                      h('div', { className: 'bs-empty-icon' }, h(BookIcon, { size: 28 })),
                      h('h2', { className: 'bs-empty-title' }, t('emptyCategoryTitle')),
                      h('p', { className: 'bs-empty-text' }, t('emptyCategoryHint')),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'bs-button',
                          onClick: () => {
                            setCategory('all')
                            setQuery('')
                          },
                        },
                        t('showAllBooks'),
                      ),
                    )
                  : showNoResults
                  ? h(
                      'div',
                      { className: 'bs-center' },
                      h('div', { className: 'bs-empty-icon' }, h(SearchIcon, { size: 26 })),
                      h('h2', { className: 'bs-empty-title' }, t('noResults')),
                      h('p', { className: 'bs-empty-text' }, t('noResultsHint')),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'bs-button',
                          onClick: () => {
                            setQuery('')
                            setSortMode('added')
                          },
                        },
                        t('clearFilters'),
                      ),
                    )
                  : activeLayout === 'list'
                    ? h(
                        'div',
                        { className: 'bs-list', role: 'list' },
                        visibleBooks.map((book) => h(BookRow, bookViewProps(book))),
                      )
                    : h(
                        'div',
                        { className: 'bs-grid' },
                        visibleBooks.map((book) => h(BookCard, bookViewProps(book))),
                      ),
        ),
        appleBooksAvailable && appleOpen
          ? h(AppleBooksPicker, {
              t,
              base,
              onClose: () => setAppleOpen(false),
              onImported: (book, duplicate) => {
                setAppleOpen(false)
                setNotice({
                  kind: 'ok',
                  text: duplicate ? t('appleAlreadyImported') : t('appleImported', { title: book.title }),
                })
                setReload((value) => value + 1)
              },
            })
          : null,
        settingsOpen
          ? h(ShelfSettingsDialog, {
              t,
              base,
              onClose: () => setSettingsOpen(false),
              defaults: effectiveDefaults,
              onDefaultsChange: updateDefaultSettings,
              workspaces: props.workspaces,
              discussionWorkspace: presetWorkspace ? presetWorkspace.workspaceId : '',
              onDiscussionWorkspaceChange: updateDiscussionWorkspace,
              appleBooksAvailable,
              appleBooksEnabled,
              onAppleBooksEnabledChange: updateAppleBooksEnabled,
              initialTab: settingsInitialTab,
            })
          : null,
        renameState !== null
          ? h(BookRenameDialog, {
              t,
              book: renameState.book,
              field: renameState.field,
              saving: renameSaving,
              error: renameError,
              onClose: closeRename,
              onSave: saveRename,
            })
          : null,
        linkOpen
          ? h(LinkImportDialog, {
              t,
              base,
              onClose: () => setLinkOpen(false),
              onChanged: () => setReload((value) => value + 1),
            })
          : null,
        tagTarget !== null
          ? h(BookTagsDialog, {
              t,
              book: tagTarget,
              tags: tagDefinitions,
              saving: tagSaving,
              error: tagError,
              onClose: closeBookTags,
              onSave: saveBookTags,
              onCreateTag: createTag,
            })
          : null,
        audioBook !== null
          ? h(AudiobookDialog, {
              t,
              base,
              book: audioBook,
              onClose: () => setAudioBook(null),
              onOpenSettings: () => {
                setAudioBook(null)
                setSettingsInitialTab('speech')
                setSettingsOpen(true)
              },
            })
          : null,
        finishPrompt !== null
          ? h(FinishBookDialog, {
              t,
              book: finishPrompt,
              saving: finishSaving,
              error: finishError,
              onConfirm: confirmFinished,
              onDismiss: dismissFinishPrompt,
            })
          : null,
        tagsOpen
          ? h(TagManagerDialog, {
              t,
              tags: tagDefinitions,
              books: Array.isArray(books) ? books : [],
              onClose: () => setTagsOpen(false),
              onCreate: createTag,
              onRename: renameTag,
              onDelete: deleteTag,
              onChanged: () => setReload((value) => value + 1),
            })
          : null,
      )
    }

    class BookshelfBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('bookshelf: render failed', error)
      }

      render() {
        if (this.state.error !== null) {
          return h(
            'div',
            { className: 'bs-root' },
            h('style', { key: 'style' }, CSS),
            h(
              'div',
              { className: 'bs-center' },
              h('div', { className: 'bs-empty-icon' }, h(AlertIcon)),
              h('h2', { className: 'bs-empty-title' }, this.props.t('crashTitle')),
              h('p', { className: 'bs-empty-text' }, String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)),
            ),
          )
        }
        return this.props.children
      }
    }

    function BookshelfPanel(props) {
      const workspaces = typeof props.useWorkspaces === 'function' ? props.useWorkspaces(state => state.items) : []
      return h(BookshelfBoundary, { t: props.t }, h(Bookshelf, { t: props.t, viewState: props.viewState, discussion: props.discussion, workspaces }))
    }

    // ===== [locales] =====
    // The shelf dictionary ships inline so the very first paint is translated
    // before any browser asset module arrives. Every other dictionary lives in
    // assets/locales/*.mjs; once those modules load, the loader swaps the
    // bootstrap registration for the merged full set (dictionary registration
    // bumps the locale revision, so already-rendered outlets re-render).
    //
    // Keep bootstrap keys out of the locale modules: the merge below is a plain
    // Object.assign over disjoint domains, and a duplicated key would let the
    // inline string win over the module string.
    const LOCALE_DOMAINS = ['import', 'apple-books', 'audiobook', 'speech', 'selection', 'reader', 'tags', 'settings', 'discussion', 'sidebar']

    const bootstrapEn = {
      panel: 'Bookshelf',
      title: 'Bookshelf',
      subtitle: 'Import PDF and EPUB books and read them here.',
      bookCount: '{count} books',
      searchPlaceholder: 'Search title or author',
      clearSearch: 'Clear search',
      searchCount: '{shown} of {total} books',
      sortBy: 'Sort',
      sortAdded: 'Recently added',
      sortRead: 'Recently read',
      sortTitle: 'Title',
      sortAuthor: 'Author',
      layoutLabel: 'Shelf layout',
      layoutCover: 'Cover view',
      layoutList: 'List view',
      appleBooks: 'Apple Books',
      more: 'More',
      addLocalBooks: 'Add local books',
      noResults: 'No matching books',
      noResultsHint: 'Try a different title, author, or file name.',
      clearFilters: 'Clear search and sorting',
      import: 'Import books',
      loadFailed: 'Could not load the bookshelf: {message}',
      loadFailedTitle: 'The bookshelf is unavailable',
      loading: 'Loading bookshelf…',
      emptyTitle: 'Your bookshelf is empty',
      emptyHint: 'Import a PDF or EPUB file, or link a folder, to start reading.',
      dropHint: 'Drop to import',
      serviceHint: 'The local bookshelf service must be running. Reload the page if this keeps happening.',
      serviceUnreachable: 'The local bookshelf service is unreachable.',
      retry: 'Retry',
      delete: 'Delete',
      deleteBook: 'Delete {title}',
      openBook: 'Read {title}',
      deleteTitle: 'Delete this book?',
      deleteBody: '“{title}” will be removed from the bookshelf. The linked original file is not deleted.',
      confirmDelete: 'Remove from shelf',
      deleting: 'Removing…',
      deleted: 'Removed from the bookshelf.',
      deleteFailed: 'Could not delete the book: {message}',
      cancel: 'Cancel',
      dismiss: 'Dismiss',
      untitled: 'Untitled',
      unknownAuthor: 'Unknown author',
      back: 'Back to bookshelf',
      readingProgress: 'Reading progress',
      continueReading: 'Continue reading',
      finishedReading: 'Finished',
      statusLabel: 'Status',
      statusAuto: 'Follow progress',
      statusUnread: 'Unread',
      statusReading: 'Reading',
      statusFinished: 'Finished',
      finishedPercent: 'Finished {percent}%',
      finishPromptTitle: 'Mark as finished?',
      finishPromptBody: 'You reached the last page of “{title}”. Mark this book as finished?',
      finishPromptConfirm: 'Mark as finished',
      finishPromptDismiss: 'Not now',
      markedFinished: 'Marked as finished.',
      finishPromptSaveFailed: 'Could not mark the book as finished: {message}',
      categories: 'Categories',
      categoryAll: 'All',
      emptyCategoryTitle: 'No books here yet',
      emptyCategoryHint: 'Assign this category to a book, or pick another one.',
      showAllBooks: 'Show all books',
      crashTitle: 'The bookshelf hit an error',
    }

    const bootstrapZh = {
      panel: '书架',
      title: '书架',
      subtitle: '导入 PDF 和 EPUB 书籍，在这里阅读。',
      bookCount: '共 {count} 本',
      searchPlaceholder: '搜索书名或作者',
      clearSearch: '清除搜索',
      searchCount: '显示 {shown} / {total} 本',
      sortBy: '排序',
      sortAdded: '最近添加',
      sortRead: '最近阅读',
      sortTitle: '书名',
      sortAuthor: '作者',
      layoutLabel: '书架排列',
      layoutCover: '封面',
      layoutList: '列表',
      appleBooks: 'Apple Books',
      more: '更多',
      addLocalBooks: '添加本地书籍',
      noResults: '没有找到匹配的书',
      noResultsHint: '换一个书名、作者或文件名试试。',
      clearFilters: '清除搜索和排序',
      import: '导入书籍',
      loadFailed: '无法载入书架：{message}',
      loadFailedTitle: '书架暂时不可用',
      loading: '正在载入书架…',
      emptyTitle: '书架还是空的',
      emptyHint: '导入一本 PDF 或 EPUB，或软链接一个文件夹，开始阅读。',
      dropHint: '松开即可导入',
      serviceHint: '请确认本地书架服务正在运行。如果一直如此，请刷新页面。',
      serviceUnreachable: '无法连接本地书架服务。',
      retry: '重试',
      delete: '删除',
      deleteBook: '删除《{title}》',
      openBook: '阅读《{title}》',
      deleteTitle: '删除这本书？',
      deleteBody: '《{title}》将从书架移除，链接的原始文件不会被删除。',
      confirmDelete: '从书架移除',
      deleting: '正在移除…',
      deleted: '已从书架移除。',
      deleteFailed: '删除失败：{message}',
      cancel: '取消',
      dismiss: '关闭',
      untitled: '无标题',
      unknownAuthor: '未知作者',
      back: '返回书架',
      readingProgress: '阅读进度',
      continueReading: '继续阅读',
      finishedReading: '已读完',
      statusLabel: '状态',
      statusAuto: '跟随阅读进度',
      statusUnread: '未读',
      statusReading: '正在阅读',
      statusFinished: '已读完',
      finishedPercent: '已读完 {percent}%',
      finishPromptTitle: '标记为已读完？',
      finishPromptBody: '《{title}》已经读到最后一页，要标记为已读完吗？',
      finishPromptConfirm: '标记为已读完',
      finishPromptDismiss: '暂不标记',
      markedFinished: '已标记为已读完。',
      finishPromptSaveFailed: '标记失败：{message}',
      categories: '分类',
      categoryAll: '全部',
      emptyCategoryTitle: '这个分类下还没有书',
      emptyCategoryHint: '给一本书打上这个分类，或者换一个分类看看。',
      showAllBooks: '显示全部书籍',
      crashTitle: '书架出现了一个错误',
    }

    let localeDictionariesPromise = null

    function loadLocaleDictionaries(base) {
      if (localeDictionariesPromise === null) {
        localeDictionariesPromise = Promise.all(
          LOCALE_DOMAINS.map((domain) => import(absoluteServiceUrl(base, `${ASSET_ROOT}/locales/${domain}.mjs?v=${ASSET_VERSION}`))),
        )
          .then((modules) => {
            const en = { ...bootstrapEn }
            const zh = { ...bootstrapZh }
            for (const module of modules) {
              Object.assign(en, module.en)
              Object.assign(zh, module.zh)
            }
            return { en, zh }
          })
          .catch((error) => {
            localeDictionariesPromise = null
            throw error
          })
      }
      return localeDictionariesPromise
    }

    // ===== [apply] =====
    // Plugin definition: register dictionaries, then mount the shelf panel and
    // the right-sidebar surface.

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands', 'remote.session', 'uiWorkspace', 'layout', 'sidebarRight', 'sidebarRightTabs', 'uiConversation'],
      apply(ctx) {
        // Register the inline shelf dictionary synchronously for the first paint;
        // register() rejects a second dictionary for the same namespace+locale, so
        // the swap below releases the bootstrap registration before installing the
        // merged set from assets/locales. A failed module load keeps the bootstrap
        // dictionary: the shelf still works and the next apply retries.
        ctx.effect(() => {
          let release = ctx.locale.register(NS, { en: bootstrapEn, zh: bootstrapZh })
          let disposed = false
          void loadLocaleDictionaries(transportBase())
            .then((dictionaries) => {
              if (disposed) return
              release()
              release = ctx.locale.register(NS, dictionaries)
            })
            .catch((failure) => {
              console.error('bookshelf: locale dictionaries failed', failure)
            })
          return () => {
            disposed = true
            release()
          }
        }, 'bookshelf: dictionaries')
        const t = ctx.locale.bind(NS)
        const viewState = { openBookId: null, query: '', sortMode: 'added', category: 'all', layout: readStoredLayout(), scrollTop: 0 }
        let bridge = null, bridgePromise = null, operationPromise = null, disposed = false
        const listeners = new Set()
        const notify = () => { for (const listener of listeners) listener() }
        const discussion = {
          get bridge() { return bridge },
          get running() { return Boolean(operationPromise || bridge?.running) },
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
          load() {
            if (!bridgePromise) {
              // The nonce defeats a stale browser/desktop asset cache for this
              // small bridge module; client.js itself is reloaded with the page.
              bridgePromise = import(absoluteServiceUrl(transportBase(), `${ASSET_ROOT}/discussion.mjs?v=${ASSET_VERSION}&n=${Date.now().toString(36)}`)).then(module => {
                if (module.DISCUSSION_BRIDGE_VERSION !== DISCUSSION_BRIDGE_VERSION) throw new Error(t('discussionStale'))
                let storage
                try { storage = sessionStorage } catch { /* In-memory retries remain available. */ }
                bridge = module.createDiscussionBridge({ remote: ctx.remote, uiWorkspace: ctx.uiWorkspace, layout: ctx.layout, storage,
                  onPrepared: ({ sessionId, snapshotId, file }) => {
                    // The shell reads its persisted draft before first paint, so
                    // this is the reliable way to place the editable prompt and
                    // @file chip in the composer of the still-blank session.
                    try {
                      if (!file || typeof file.mention !== 'string' || !file.mention) return
                      const prefix = t('discussionPromptPrefix')
                      const mention = file.mention
                      const text = `${prefix}${mention}\n\n`
                      const key = `dsh.conversation.${sessionId}`
                      let stored = {}
                      try { stored = JSON.parse(localStorage.getItem(key) || '{}') } catch {}
                      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {}
                      const draft = { text, references: [{ source: 'reference', ref: mention,
                        offset: prefix.length, length: mention.length, label: file.label || 'Books page',
                        appearance: 'file', clipboardText: mention }] }
                      localStorage.setItem(key, JSON.stringify({ ...stored, draft }))
                    } catch { /* The composer-dock seed remains available. */ }
                  },
                  onOpened: (sessionId, snapshotId) => {
                    // The blank conversation header hides its utilities, so open
                    // Books from here as a fallback to the composer-dock opener.
                    const key = ['bookshelf', 'opened', sessionId, snapshotId].join('.')
                    let attempts = 0
                    const tick = () => {
                      if (attempts++ > 60) return
                      if (ctx.sidebarRight?.mounted?.getSnapshot() !== sessionId) { requestAnimationFrame(tick); return }
                      try {
                        if (localStorage.getItem(key) !== '1') { ctx.sidebarRight.openTab(BOOKS_TAB_KIND); localStorage.setItem(key, '1') }
                      } catch { /* The composer dock may still open it, or the guide remains. */ }
                    }
                    requestAnimationFrame(tick)
                  } })
                if (disposed) bridge.dispose()
                notify()
                return bridge
              }).catch(error => { bridgePromise = null; throw error })
            }
            return bridgePromise
          },
          start(input) {
            // This coordinator outlives Reader/Dialog components, including when
            // the user closes the chooser while native creation is in flight.
            if (operationPromise) return operationPromise
            if (!bridge) return Promise.reject(new Error(t('discussionUnavailable')))
            operationPromise = bridge.start(input).finally(() => { operationPromise = null; notify() })
            notify()
            return operationPromise
          },
          discard() { bridge?.discard(); notify() },
        }
        ctx.effect(() => {
          void discussion.load().catch(() => {})
          return () => { disposed = true; bridge?.dispose(); listeners.clear() }
        }, 'bookshelf: discussion bridge')
        const SIDEBAR_DRAFT_PREFIX = ['bookshelf', 'draft', 'v1'].join('.')
        const sidebarOpenKey = (sessionId, snapshotId) => ['bookshelf', 'opened', sessionId, snapshotId].join('.')
        const openShelfFromSidebar = (bookId) => {
          if (bookId) sessionStorage.setItem(['bookshelf', 'open', 'v1'].join('.'), JSON.stringify({ bookId }))
          ctx.layout.selectPanel('bookshelf')
        }

        function SidebarStatic(props) {
          const snapshot = props.useProjection(SIDEBAR_PROJECTION_KEY)
          const base = useMemo(() => transportBase(), [])
          const [library, setLibrary] = useState(null)
          const [loading, setLoading] = useState(false)
          const [error, setError] = useState('')
          const request = useRef(null)
          const input = props.useInput?.(state => state)
          const currentDraft = typeof input?.draft === 'string' ? input.draft : ''
          useEffect(() => () => request.current?.abort(), [])
          async function choose() {
            request.current?.abort()
            const controller = new AbortController()
            request.current = controller
            setLoading(true)
            setError('')
            try {
              const payload = await requestJson(base, '/books')
              if (!payload || !Array.isArray(payload.books)) throw new Error(t('sidebarFailed'))
              if (!controller.signal.aborted) setLibrary(payload.books.filter(book => book.format === 'epub'))
            } catch (failure) {
              if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message || t('sidebarFailed') : t('sidebarFailed'))
            } finally {
              if (!controller.signal.aborted) setLoading(false)
            }
          }
          function navigate(bookId) {
            try { openShelfFromSidebar(bookId) }
            catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
          }
          const saved = snapshot?.version === 1 && typeof snapshot.text === 'string' ? snapshot : null
          const title = saved?.title || t('sidebarTitle')
          useEffect(() => {
            if (!saved || !props.inputActions || typeof props.sessionId !== 'string') return
            const key = `${SIDEBAR_DRAFT_PREFIX}.${props.sessionId}`
            let seed
            try { seed = JSON.parse(sessionStorage.getItem(key) || 'null') } catch {}
            if (!seed || typeof seed.mention !== 'string' || seed.mention === '') return
            const consume = () => { try { sessionStorage.removeItem(key) } catch {} }
            if (currentDraft.includes(seed.mention) || currentDraft.trim() !== '') { consume(); return }
            const mention = seed.mention
            const prefix = t('discussionPromptPrefix')
            const text = `${prefix}${mention}\n\n`
            const reference = { source: 'reference', ref: mention, label: seed.label || 'Books page',
              appearance: 'file', clipboardText: mention, offset: prefix.length, length: mention.length }
            try { props.inputActions.setDraft({ text, references: [reference] }); consume() } catch { /* Keep the seed for the dock fallback. */ }
          }, [saved?.snapshotId, props.sessionId, props.inputActions, currentDraft])
          return h('section', { className: 'bsb-reader', 'aria-label': t('sidebarTitle') },
            h('style', null, SIDEBAR_CSS),
            h('header', { className: 'bsb-header' },
              h('h2', { className: 'bsb-title' }, title),
              saved ? h('div', { className: 'bsb-meta' }, [saved.author, saved.chapterTitle, saved.pageLabel].filter(Boolean).join(' · ')) : null,
              saved ? h('div', { className: 'bsb-meta' }, t('sidebarCaptured') + ' · ' + new Date(saved.capturedAt).toLocaleString()) : null,
              h('div', { className: 'bsb-actions' },
                h('button', { type: 'button', className: 'bsb-button', onClick: () => navigate(saved?.bookId) }, t(saved ? 'sidebarResume' : 'sidebarShelf')),
                !saved ? h('button', { type: 'button', className: 'bsb-button', onClick: choose, disabled: loading }, t(loading ? 'sidebarLoading' : 'sidebarChoose')) : null)),
            h('div', { className: 'bsb-body' },
              saved ? h('article', { className: 'bsb-segment', 'data-snapshot-id': saved.snapshotId }, saved.text)
                : h('p', { className: 'bsb-message' }, t('sidebarEmpty')),
              saved?.selection?.text ? h('details', { className: 'bsb-selection' },
                h('summary', null, t('sidebarSelection')), h('p', null, saved.selection.text)) : null,
              library ? h('div', { className: 'bsb-picker' },
                h('p', { className: 'bsb-message' }, t(library.length ? 'sidebarGuidance' : 'sidebarNoBooks')),
                library.map(book => h('button', { key: book.id, type: 'button', className: 'bsb-button', onClick: () => navigate(book.id) }, book.title || book.name))) : null),
            h('footer', { className: 'bsb-footer', role: error ? 'alert' : 'status' }, error ||
              (saved ? [t('sidebarFixed'), t(saved.truncated || saved.coverage?.status === 'partial' ? 'sidebarTruncated' : 'sidebarPartial')].join(' ')
                : t('sidebarGuidance'))))
        }

        function SidebarHeader(props) {
          const snapshot = props.useProjection(SIDEBAR_PROJECTION_KEY)
          const [error, setError] = useState('')
          const saved = snapshot?.snapshotId ? snapshot : null
          const key = sidebarOpenKey(props.sessionId, saved?.snapshotId)
          function reveal() {
            if (ctx.sidebarRight.mounted.getSnapshot() !== props.sessionId) return false
            ctx.sidebarRight.openTab(BOOKS_TAB_KIND)
            try { localStorage.setItem(key, '1') } catch {}
            setError('')
            return true
          }
          useEffect(() => {
            if (!saved) return
            try { if (localStorage.getItem(key) === '1') return } catch {}
            let frame, attempts = 0, disposed = false
            const tryOpen = () => {
              if (disposed || ctx.sidebarRight.mounted.getSnapshot() !== props.sessionId) return
              frame = requestAnimationFrame(() => {
                if (disposed) return
                try { if (localStorage.getItem(key) === '1') return; reveal() }
                catch { if (++attempts < 3) tryOpen(); else setError(t('sidebarAutoFailed')) }
              })
            }
            const unsubscribe = ctx.sidebarRight.mounted.subscribe(tryOpen)
            tryOpen()
            return () => { disposed = true; cancelAnimationFrame(frame); unsubscribe() }
          }, [props.sessionId, saved?.snapshotId])
          if (!saved) return null
          return h('button', { type: 'button', title: error || t('sidebarOpen'), 'aria-label': error ? t('sidebarRetry') : t('sidebarOpen'),
            style: { boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px',
              border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 12, lineHeight: 1, cursor: 'pointer' },
            onClick: () => { try { reveal() } catch { setError(t('sidebarAutoFailed')) } } },
            error ? t('sidebarRetry') : t('sidebarOpen'))
        }

        function SidebarComposerSeed(props) {
          const sessionId = props.sessionId
          const inputActions = props.inputActions
          const snapshot = props.useProjection(SIDEBAR_PROJECTION_KEY)
          const input = props.useInput?.(state => state)
          const currentDraft = typeof input?.draft === 'string' ? input.draft : ''
          const [error, setError] = useState('')
          const seeded = useRef('')
          const seedKey = `${SIDEBAR_DRAFT_PREFIX}.${sessionId}`
          useEffect(() => {
            if (typeof sessionId !== 'string' || !inputActions || seeded.current === sessionId) return
            let seed
            try { seed = JSON.parse(sessionStorage.getItem(seedKey) || 'null') } catch {}
            if (!seed || typeof seed.mention !== 'string' || seed.mention === '') return
            if (currentDraft.includes(seed.mention)) { seeded.current = sessionId; try { sessionStorage.removeItem(seedKey) } catch {} return }
            if (currentDraft.trim() !== '') return
            seeded.current = sessionId
            try { sessionStorage.removeItem(seedKey) } catch {}
            const mention = seed.mention
            const prefix = t('discussionPromptPrefix')
            const text = `${prefix}${mention}\n\n`
            const reference = { source: 'reference', ref: mention, label: seed.label || 'Books page',
              appearance: 'file', clipboardText: mention, offset: prefix.length, length: mention.length }
            try { inputActions.setDraft({ text, references: [reference] }) }
            catch (failure) {
              try { inputActions.setDraft(text) }
              catch { setError(failure instanceof Error ? failure.message : String(failure)) }
            }
          }, [sessionId, inputActions, seedKey, currentDraft])
          useEffect(() => {
            if (!snapshot?.snapshotId || typeof sessionId !== 'string') return
            const key = sidebarOpenKey(sessionId, snapshot.snapshotId)
            try { if (localStorage.getItem(key) === '1') return } catch {}
            let frame, attempts = 0, disposed = false
            const tryOpen = () => {
              if (disposed || ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return
              frame = requestAnimationFrame(() => {
                if (disposed) return
                try { if (localStorage.getItem(key) === '1') return; ctx.sidebarRight.openTab(BOOKS_TAB_KIND); localStorage.setItem(key, '1') }
                catch { if (++attempts < 3) tryOpen() }
              })
            }
            const unsubscribe = ctx.sidebarRight.mounted.subscribe(tryOpen)
            tryOpen()
            return () => { disposed = true; cancelAnimationFrame(frame); unsubscribe() }
          }, [sessionId, snapshot?.snapshotId])
          if (error === '') return null
          return h('div', { role: 'alert', style: { padding: '4px 2px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, t('sidebarSeedFailed'))
        }

        function quietSidebarCommandDefinition() {
          return {
            kind: 'bookshelf-sidebar-command', target: 'chat',
            match: {
              'command/run': event => event.data?.name === 'bookshelf-snapshot' && typeof event.data.commandId === 'string'
                ? { id: event.data.commandId, role: 'start', exclusive: true } : null,
              'command/done': event => {
                if (typeof event.data?.commandId !== 'string' || typeof event.data.text !== 'string') return null
                try {
                  const value = JSON.parse(event.data.text)
                  return ((event.data.kind === 'success' && value.marker === 'bookshelf-page-snapshot-v1' && value.snapshot?.snapshotId)
                    || (event.data.kind === 'error' && value.marker === 'bookshelf-page-snapshot-error-v1' && typeof value.message === 'string'))
                    ? { id: event.data.commandId, role: 'update', exclusive: true } : null
                } catch { return null }
              },
            },
            start: () => ({}), update: context => context.state ?? {}, buildViewNode: () => null,
          }
        }

        if (ctx.sidebarRightTabs && ctx.sidebarRight && ctx.uiConversation) ctx.effect(() => {
          const releaseType = ctx.sidebarRightTabs.register({
            id: SIDEBAR_TAB_ID, kind: BOOKS_TAB_KIND, title: () => t('sidebarTitle'),
            guide: [{ id: SIDEBAR_TAB_ID, order: 35, title: () => t('sidebarTitle'), description: () => t('sidebarEmpty'), icon: BookIcon }],
          })
          const releaseBody = ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: SIDEBAR_TAB_ID }, SidebarStatic))
          const releaseHeader = ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register({ name: 'conversation.session.header.utilities', id: SIDEBAR_TAB_ID + '/snapshot', order: 30 }, SidebarHeader))
          const releaseComposer = ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register({ name: 'conversation.composer.dock', id: SIDEBAR_TAB_ID + '/seed', order: 5 }, SidebarComposerSeed))
          const releaseQuiet = ctx.uiConversation.events.register(quietSidebarCommandDefinition())
          return () => { releaseQuiet(); releaseComposer(); releaseHeader(); releaseBody(); releaseType() }
        }, 'bookshelf: right sidebar')

        const Panel = (props) => h(BookshelfPanel, { ...props, viewState, discussion })
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            Panel,
          ),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 5,
              locale: NS,
              label: () => t('panel'),
            },
            ShelfIcon,
          ),
        )
      },
    }
  },
})
