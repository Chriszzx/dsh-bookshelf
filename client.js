window.__ModuleLoader__.load({
  id: 'dsh-bookshelf',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'bookshelf'
    const PANEL_ID = 'bookshelf'
    const API_ROOT = 'bookshelf/api'
    const ASSET_ROOT = 'bookshelf/assets'
    // Bump when a served browser asset changes so a loaded page cannot keep an
    // older module from its HTTP cache.
    const ASSET_VERSION = '5'
    const DISCUSSION_WORKSPACE_KEY = 'bookshelf.discussion.workspace.v1'
    const APPLE_BOOKS_ENABLED_KEY = 'bookshelf.appleBooks.enabled.v1'
    const BOOKS_TAB_KIND = 'bookshelf-reader'
    // Kept stable across the package rename so an open Books tab and existing
    // page-snapshot sessions keep their ids.
    const SIDEBAR_TAB_ID = '@local/dsh-bookshelf/reader'
    const SIDEBAR_PROJECTION_KEY = 'shelfPageSnapshot'
    const DISCUSSION_BRIDGE_VERSION = 5
    const MAX_IMPORT_BYTES = 256 * 1024 * 1024

    const CSS = `
.bs-root{box-sizing:border-box;position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}
.bs-root *,.bs-root *::before,.bs-root *::after{box-sizing:border-box}
.bs-file-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.bs-shelf{display:flex;flex-direction:column;height:100%;min-height:0}
.bs-header{flex:none;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:calc(var(--dsh-frame-top-clearance,0px) + 20px) 32px 16px}
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
.bs-scroll{flex:1;min-height:0;overflow:auto;padding:6px 32px 56px;overscroll-behavior:contain}
.bs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:24px 20px;max-width:1180px;margin:0 auto}
.bs-card{position:relative;display:flex;flex-direction:column;gap:9px;min-width:0}
.bs-cover{position:relative;display:block;width:100%;aspect-ratio:3/4;margin:0;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;text-align:left;color:#f6f1e7;box-shadow:0 1px 2px rgba(0,0,0,.12),0 10px 24px -16px rgba(0,0,0,.55)}
button.bs-cover{cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}
button.bs-cover:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,.16),0 16px 30px -16px rgba(0,0,0,.6)}
button.bs-cover:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.bs-cover-wrap{position:relative;z-index:1;display:block}
.bs-cover-frame{position:absolute;inset:0;display:flex;flex-direction:column;padding:34px 14px 13px}
.bs-cover-frame::before{content:"";position:absolute;inset:8px;border:1px solid rgba(255,255,255,.2);border-radius:4px;pointer-events:none}
.bs-cover-title{position:relative;padding-right:26px;font-family:'Iowan Old Style','Palatino Linotype','Songti SC','STSong','Noto Serif CJK SC',serif;font-size:15.5px;line-height:1.35;font-weight:600;letter-spacing:.01em;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;text-shadow:0 1px 2px rgba(0,0,0,.28)}
.bs-cover-author{position:relative;margin-top:auto;padding-top:12px;padding-right:34px;font-size:11px;line-height:1.4;color:rgba(246,241,231,.76);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-cover-format{position:absolute;top:10px;left:10px;right:auto;padding:2px 5px;border-radius:3px;background:rgba(0,0,0,.3);color:rgba(255,255,255,.86);font-size:9px;font-weight:600;letter-spacing:.12em;line-height:1.4;z-index:3}
.bs-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;opacity:0;background:var(--dsw-alias-bg-base);transition:opacity .18s ease}
.bs-cover-img[data-loaded="true"]{opacity:1}
.bs-cover-frame::before{z-index:2}
.bs-cover-format{z-index:3}
.bs-cover-title,.bs-cover-author{z-index:0}
.bs-shelf-tools{flex:none;display:flex;align-items:center;gap:10px;padding:9px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
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
.bs-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 32px 10px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.5;overflow-wrap:anywhere}
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
.bs-reader-bar{flex:none;display:flex;align-items:center;gap:8px;min-height:54px;padding:calc(var(--dsh-frame-top-clearance,0px) + 10px) 18px 10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
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
.bs-bookmarks-panel{position:absolute;top:calc(var(--dsh-frame-top-clearance,0px) + 58px);right:16px;z-index:6;width:min(300px,calc(100vw - 40px));max-height:min(60vh,420px);overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 48px -20px rgba(0,0,0,.55)}
.bs-bookmarks-panel-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.bs-popover-backdrop{position:absolute;inset:0;z-index:8;background:transparent}
.bs-reader-settings{position:absolute;top:calc(var(--dsh-frame-top-clearance,0px) + 58px);right:14px;z-index:9;width:min(332px,calc(100vw - 28px));max-height:calc(100vh - 110px);overflow:auto;padding:10px 13px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 22px 60px -24px rgba(0,0,0,.6)}
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
.bs-focus-controls{position:absolute;top:calc(var(--dsh-frame-top-clearance,0px) + 10px);right:14px;z-index:7;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 30px -16px rgba(0,0,0,.55);opacity:.5;transition:opacity .15s ease}
.bs-focus-controls:hover,.bs-focus-controls:focus-within{opacity:1}
.bs-reader:fullscreen{width:100vw;height:100vh;border-radius:0;background:var(--dsw-alias-bg-base)}
.bs-reader:fullscreen .bs-reader-bar{padding-top:10px}
.bs-reader:fullscreen .bs-focus-controls{top:10px}
.bs-reader:fullscreen .bs-reader-settings{top:58px}
.bs-divider{width:1px;height:16px;margin:0 5px;background:var(--dsw-alias-border-l1)}
.bs-text-button{font:inherit;font-size:11.5px;line-height:1.4;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.bs-text-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.bs-text-button:disabled{opacity:.45;cursor:default}
.bs-text-button[aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary)}
.bs-text-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
@media (max-width:720px){
  .bs-header{padding-left:20px;padding-right:20px}
  .bs-scroll{padding-left:20px;padding-right:20px}
  .bs-banner{margin-left:20px;margin-right:20px}
  .bs-reader-sub{display:none}
  .bs-epub-toc{position:absolute;left:0;top:0;bottom:0;z-index:4;width:min(82vw,290px);background:var(--dsw-alias-bg-overlay);box-shadow:18px 0 40px -28px rgba(0,0,0,.8)}
  .bs-reader-bar{padding-left:8px;padding-right:10px;gap:5px}
  .bs-reader-title-wrap{padding:0 2px}
  .bs-reader-controls{gap:2px;flex-wrap:wrap;justify-content:flex-end;row-gap:3px}
  .bs-reader-controls .bs-divider{margin:0 2px}
  .bs-reader-settings{right:8px;left:8px;width:auto}
  .bs-focus-controls{right:8px}
  .bs-shelf-tools{padding:8px 12px;gap:6px}
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
.bs-rename-dialog{width:min(430px,calc(100vw - 28px));max-height:calc(100vh - 40px)}
.bs-rename-form{display:flex;flex-direction:column;min-height:0}
.bs-rename-body{display:flex;flex-direction:column;gap:12px;padding:10px 18px 14px}
.bs-rename-field{display:flex;flex-direction:column;gap:5px}
.bs-rename-label{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.bs-rename-input{font:inherit;font-size:13px;line-height:1.4;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none}
.bs-rename-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.bs-rename-error{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.bs-rename-foot{justify-content:flex-end}
@media (hover:none){.bs-more{opacity:1}}
`

    const READING_CSS = `
:root{color-scheme:var(--bb-scheme,light)}
html,body{margin:0;padding:0;background:var(--bb-bg,transparent)}
body{max-width:var(--bb-max-width,46rem);margin:0 auto;padding:var(--bb-padding-y,44px) var(--bb-padding-x,34px) 120px;color:var(--bb-fg,#1f2328);font-family:var(--bb-font-family,'Iowan Old Style','Palatino Linotype','Songti SC','STSong','Noto Serif CJK SC',serif);font-size:var(--bb-font-size,19px);line-height:var(--bb-line-height,1.85);text-align:justify;overflow-wrap:break-word;hyphens:auto}
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
      serif: "'Iowan Old Style','Palatino Linotype','Songti SC','STSong','Noto Serif CJK SC',serif",
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
      fontSize: 19,
      lineHeight: 1.85,
      pageMargin: 'standard',
      theme: 'auto',
      pageMode: 'scroll',
      pageSpread: 'auto',
    }

    const READING_THEMES = {
      light: {
        fg: '#1f2328',
        bg: '#fbfaf7',
        muted: '#6b7280',
        border: 'rgba(24,28,35,.14)',
        accent: '#3155d8',
        codeBg: '#f0efea',
        scheme: 'light',
      },
      dark: {
        fg: '#e7e8ea',
        bg: '#17181c',
        muted: '#a6aab2',
        border: 'rgba(255,255,255,.14)',
        accent: '#8fb0ff',
        codeBg: 'rgba(255,255,255,.06)',
        scheme: 'dark',
      },
    }

    function readingPalette(settings) {
      const mode = settings && settings.theme
      if (READING_THEMES[mode]) return { ...READING_THEMES[mode], mode }
      const styles = typeof getComputedStyle === 'function' ? getComputedStyle(document.body) : null
      const read = (name, fallback) => {
        if (styles === null) return fallback
        const value = (styles.getPropertyValue(name) || '').trim()
        return value === '' ? fallback : value
      }
      const dark = document.body.hasAttribute('data-ds-dark-theme')
      return {
        mode: 'auto',
        fg: read('--dsw-alias-label-primary', '#1f2328'),
        bg: 'transparent',
        muted: read('--dsw-alias-label-secondary', '#6b7280'),
        border: read('--dsw-alias-border-l1', 'rgba(120,120,130,.28)'),
        accent: read('--dsw-alias-brand-primary', '#3155d8'),
        codeBg: dark ? 'rgba(255,255,255,.06)' : 'rgba(20,24,32,.045)',
        scheme: dark ? 'dark' : 'light',
      }
    }

    // ---------------------------------------------------------------- helpers

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

    // ------------------------------------------------------------- module loads

    let pdfjsPromise = null
    let epubModulePromise = null
    let readingSnapshotPromise = null

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

    // ------------------------------------------------------------------- icons

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
.bsb-segment{white-space:pre-wrap;overflow-wrap:break-word;font-family:'Iowan Old Style','Songti SC','STSong','Noto Serif CJK SC',serif;font-size:17px;line-height:1.8;margin:0 auto;max-width:38em;user-select:text}
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

    // ------------------------------------------------------------------ reader

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
          if (patch === null || Object.keys(patch).length === 0) return
          writeBookState(base, book.id, patch, keepalive).catch((failure) => {
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

    function ReaderSettingsPopover({ t, settings, onChange, onClose, title, hint, workspaces, discussionWorkspace, onDiscussionWorkspaceChange, appleBooksAvailable, appleBooksEnabled, onAppleBooksEnabledChange }) {
      const heading = title || t('readingSettings')
      const workspaceChoices = Array.isArray(workspaces) ? workspaces.filter((item) => item && typeof item.workspaceId === 'string') : null
      const selectedWorkspace = workspaceChoices !== null && workspaceChoices.some((item) => item.workspaceId === discussionWorkspace) ? discussionWorkspace : ''
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
          workspaceChoices !== null && typeof onDiscussionWorkspaceChange === 'function'
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
          appleBooksAvailable === true && typeof onAppleBooksEnabledChange === 'function'
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
          h(ReadingSegmented, {
            label: t('fontFamily'),
            value: settings.fontFamily,
            options: [
              { value: 'serif', label: t('fontSerif') },
              { value: 'sans', label: t('fontSans') },
              { value: 'mono', label: t('fontMono') },
            ],
            onChange: (value) => onChange({ fontFamily: value }),
          }),
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
        ),
      )
    }

    function ReaderShell({ t, book, onBack, controls, children, state, progress }) {
      const shellRef = useRef(null)
      const [focusMode, setFocusMode] = useState(false)
      const [isFullscreen, setIsFullscreen] = useState(false)

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
              { className: 'bs-reader-bar' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-icon-button',
                  onClick: onBack,
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
        focusMode ? null : progress ? h(ReadingProgress, { t, percent: progress.percent, onSeek: progress.onSeek }) : null,
        focusMode
          ? h(
              'div',
              { className: 'bs-focus-controls' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'bs-icon-button',
                  onClick: onBack,
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

    function useThemeTick() {
      const [tick, setTick] = useState(0)
      useEffect(() => {
        const target = document.body
        if (target === null) return undefined
        const observer = new MutationObserver(() => setTick((value) => value + 1))
        observer.observe(target, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => observer.disconnect()
      }, [])
      return tick
    }

    function paintFrame(documentNode, settings) {
      if (!documentNode || !documentNode.documentElement) return
      const palette = readingPalette(settings)
      const margins = PAGE_MARGINS[settings.pageMargin] || PAGE_MARGINS.standard
      const root = documentNode.documentElement
      const body = documentNode.body
      root.style.setProperty('--bb-font-family', READER_FONTS[settings.fontFamily] || READER_FONTS.serif)
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

    // --------------------------------------------------------------- PDF view

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
      const restorePageRef = useRef(1)
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
            pdfjs = await loadPdfjs(base)
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
            restorePageRef.current = savedPage
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
        if (status !== 'ready' || !pdfDocument) return undefined
        const target = Math.min(pdfDocument.numPages, Math.max(1, restorePageRef.current || 1))
        const timer = setTimeout(() => {
          scrollToPage(target)
          settleTimerRef.current = setTimeout(() => {
            restoringRef.current = false
            savePdfProgress(target)
          }, 180)
        }, 90)
        return () => {
          clearTimeout(timer)
          clearTimeout(settleTimerRef.current)
        }
      }, [status, pdfDocument, scrollToPage, savePdfProgress])

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
        setViewMode(next)
        savePdfSettings({ pdfView: next })
      }
      const percent = pdfDocument ? Math.min(1, Math.max(0, currentPage / pdfDocument.numPages)) : 0

      useEffect(() => {
        if (status !== 'ready' || pdfDocument === null) return undefined
        const timer = setTimeout(() => {
          scrollToPage(currentPageRef.current)
        }, 100)
        return () => clearTimeout(timer)
      }, [effectiveZoom, fitMode, viewMode, width, height, status, pdfDocument, scrollToPage])

      const onScroll = useCallback(() => {
        if (viewMode === 'single') return
        if (frameRef.current !== 0) return
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0
          const node = scrollRef.current
          if (node === null) return
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

      return h(
        ReaderShell,
        {
          t,
          book,
          onBack,
          controls,
          state: status === 'ready' && pdfDocument ? t('pdfPages', { total: pdfDocument.numPages }) : undefined,
          progress: status === 'ready' && pdfDocument ? { percent, onSeek: onSeekProgress } : undefined,
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

    // -------------------------------------------------------------- EPUB view

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
      const frameRef = useRef(null)
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
      const lastSavedProgressRef = useRef('')
      const pageIndexRef = useRef(0)
      const pageCountRef = useRef(1)
      const pageColumnsRef = useRef(1)
      const pageAnchorRef = useRef(null)
      const previousModeRef = useRef(settings.pageMode)
      const turnPageRef = useRef(() => {})
      const themeTick = useThemeTick()
      const settingsRef = useRef(settings)
      const palette = useMemo(() => readingPalette(settings), [settings, themeTick])

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
            requestAnimationFrame(() => {
              if (generation === layoutGenerationRef.current) capturePagedAnchor()
            })
          }
          if (options.save && generation === layoutGenerationRef.current) {
            saveEpubProgress(chapterRef.current, ratio)
          }
        },
        [capturePagedAnchor, pageForAnchor, saveEpubProgress],
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
            if (typeof stored.pageMargin !== 'string' && typeof stored.readingWidth === 'string') {
              nextSettings.pageMargin = stored.readingWidth === 'wide' ? 'compact' : 'standard'
            }
            if (nextSettings.theme === 'sepia') nextSettings.theme = 'auto'
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
        },
        [chapter],
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

      const onFrameLoad = useCallback(() => {
        const frame = frameRef.current
        const documentNode = frame && frame.contentDocument
        const windowNode = frame && frame.contentWindow
        if (!documentNode || !windowNode) return
        paintFrame(documentNode, settingsRef.current)
        wrapTables(documentNode)
        displayedChapterRef.current = { document: documentNode, chapter: chapterRef.current }
        if (typeof documentNode.__bsBound !== 'boolean') {
          documentNode.__bsBound = true
          documentNode.addEventListener('click', (event) => {
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
        const onScroll = () => {
          if (restoringRef.current || settingsRef.current.pageMode === 'paged') return
          anchorRef.current = ''
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
      }, [goTo, layoutPagedFrame, saveEpubProgress])

      useEffect(() => {
        const previousMode = previousModeRef.current
        previousModeRef.current = settings.pageMode
        const frame = frameRef.current
        const documentNode = frame && frame.contentDocument
        if (!documentNode) return
        paintFrame(documentNode, settings)
        if (settings.pageMode === 'paged') {
          if (previousMode === 'paged') {
            layoutPagedFrame(frame, { restoreAnchor: true, save: true })
          } else {
            pageAnchorRef.current = null
            layoutPagedFrame(frame, { targetRatio: scrollRatioRef.current, save: true })
          }
          return
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
      }, [settings, themeTick, layoutPagedFrame, saveEpubProgress])

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
        setBookPageCounts(null)
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
          probe.onload = () => {
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
                const info = pagedMetrics(documentNode, windowNode)
                if (info !== null) pages = info.pages
              }
            } catch {
              pages = 1
            }
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
      controls.push(h('span', { key: 'div1', className: 'bs-divider' }))
      controls.push(
        h(
          'button',
          {
            key: 'settings',
            type: 'button',
            className: 'bs-text-button',
            onClick: () => setSettingsOpen((value) => !value),
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

      return h(
        ReaderShell,
        {
          t,
          book,
          onBack,
          controls,
          state: sub,
          progress: status === 'ready' && data !== null ? { percent, onSeek: onSeekProgress } : undefined,
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
                { className: 'bs-epub-body', style: { backgroundColor: palette.bg === 'transparent' ? 'var(--dsw-alias-bg-base)' : palette.bg } },
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
                          t('tocTab'),
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
                          bookmarks.length > 0 ? `${t('bookmarksTab')} (${bookmarks.length})` : t('bookmarksTab'),
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
                        : h(BookmarksList, {
                            t,
                            bookmarks,
                            onSelect: (bookmark) => goTo(bookmark.chapterIndex || 0, bookmark.anchor || '', Number(bookmark.scrollRatio) || 0),
                            onDelete: (bookmark) => readerState.save({ bookmarks: bookmarks.filter((item) => item.id !== bookmark.id) }, true),
                          }),
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
                ),
                directBusy ? h('div', { className: 'bs-discussion-backdrop' },
                  h('section', { className: 'bs-discussion-dialog', role: 'status', 'aria-live': 'polite', 'aria-label': t('discussionCreating') },
                    h('p', null, t('discussionCreating'))) ) : null,
                discussionState ? h(DiscussionDialog, { t, discussion, workspaces, preferredWorkspaceId: discussionWorkspace, ...discussionState, onClose: closeDiscussion }) : null,
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

    // ------------------------------------------------------------------ shelf

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

    function BookCard({ book, base = '', t, onOpen, onDelete, confirming, deleting, onAskDelete, onCancelDelete, onRename }) {
      const progress = book.progress && typeof book.progress === 'object' ? book.progress : null
      const percent = progress ? Math.min(1, Math.max(0, Number(progress.percent) || 0)) : 0
      const finished = percent >= 0.995
      const subParts = percent > 0
        ? [
            finished ? t('finishedReading') : `${t('continueReading')} ${Math.round(percent * 100)}%`,
            book.author || t('unknownAuthor'),
          ]
        : [book.author || t('unknownAuthor'), formatBytes(book.bytes), formatDate(book.addedAt)]
      const coverSrc =
        book.cover && book.cover.updatedAt && book.id
          ? resourceUrl(base, `${API_ROOT}/books/${book.id}/cover?v=${book.cover.updatedAt}`)
          : ''
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
          percent > 0
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
      const [defaultsOpen, setDefaultsOpen] = useState(false)
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
      const closeReader = useCallback(() => {
        setOpen(null)
        setReload((value) => value + 1)
      }, [setOpen])

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

      useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError('')
        requestJson(base, '/books')
          .then((payload) => {
            if (cancelled) return
            setBooks(Array.isArray(payload && payload.books) ? payload.books : [])
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

      useEffect(() => {
        if (!defaultsOpen) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
          event.preventDefault()
          setDefaultsOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [defaultsOpen])

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
      const visibleBooks = (() => {
        const source = Array.isArray(books) ? books : []
        const filtered =
          normalizedQuery === ''
            ? source.slice()
            : source.filter((book) =>
                `${book.title || ''} ${book.author || ''} ${book.name || ''}`.toLocaleLowerCase().includes(normalizedQuery),
              )
        return sortBookList(filtered, sortMode)
      })()
      const showLoading = loading && books === null
      const showEmpty = !loading && error === '' && books !== null && books.length === 0
      const showNoResults = !loading && error === '' && books !== null && books.length > 0 && visibleBooks.length === 0

      return h(
        'div',
        {
          className: 'bs-shelf bs-root',
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
                onClick: () => setDefaultsOpen((value) => !value),
                'aria-expanded': defaultsOpen,
                'aria-pressed': defaultsOpen,
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
                  : h(
                      'div',
                      { className: 'bs-grid' },
                      visibleBooks.map((book) =>
                        h(BookCard, {
                          key: book.id,
                          book,
                          base,
                          t,
                          onOpen: (value) => setOpen(value),
                          onDelete: removeBook,
                          onAskDelete: (value) => setDeleteTarget(value),
                          onCancelDelete: () => setDeleteTarget(null),
                          onRename: openRename,
                          confirming: deleteTarget !== null && deleteTarget.id === book.id,
                          deleting: deleting && deleteTarget !== null && deleteTarget.id === book.id,
                        }),
                      ),
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
        defaultsOpen
          ? h(ReaderSettingsPopover, {
              t,
              settings: effectiveDefaults,
              onChange: updateDefaultSettings,
              onClose: () => setDefaultsOpen(false),
              title: t('shelfSettings'),
              hint: t('shelfSettingsHint'),
              workspaces: props.workspaces,
              discussionWorkspace: presetWorkspace ? presetWorkspace.workspaceId : '',
              onDiscussionWorkspaceChange: updateDiscussionWorkspace,
              appleBooksAvailable,
              appleBooksEnabled,
              onAppleBooksEnabledChange: updateAppleBooksEnabled,
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

    const en = {
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
      appleBooks: 'Apple Books',
      more: 'More',
      addLocalBooks: 'Add local books',
      linkImportHint: 'Choose a folder with EPUB or PDF books. Each book is soft-linked when the system allows it; otherwise the shelf stores a copy. The original is never deleted.',
      linkChooseTitle: 'Link books from a folder',
      linkPickHint: 'Pick the folder that contains your books. The shelf links each book when possible and falls back to a copy on Windows; removing an entry never deletes the original.',
      linkPickFolder: 'Choose folder…',
      linkPicking: 'Waiting for the folder picker…',
      linkPickCancelled: 'No folder selected',
      linkPickFailed: 'Could not open the folder picker: {message}',
      linkNoFiles: 'No EPUB or PDF here',
      linkNoFilesHint: 'Choose another folder, or download the book into this folder first.',
      linkFilterPlaceholder: 'Filter files in this folder',
      linkAdd: 'Add',
      linkAdding: 'Adding…',
      linkAdded: 'Added “{title}”',
      linkAlready: 'On shelf',
      linkChooseAnother: 'Choose another folder',
      linkDone: 'Done',
      linkFailed: 'Could not add: {message}',
      linkFileCount: '{count} files',
      linkSoftNote: 'Soft links when supported; otherwise shelf copies. Removing an entry never deletes the original.',
      linkSoftShort: 'soft link',
      linkCopyShort: 'copy',
      linkAddedCopy: 'Copied “{title}” into the shelf; a symbolic link was not available.',
      rename: 'Rename',
      bookTitleLabel: 'Title',
      bookAuthorLabel: 'Author',
      save: 'Save',
      saving: 'Saving…',
      renameFailed: 'Could not save: {message}',
      renamed: 'Book details updated',
      importAppleBooks: 'Import from Apple Books',
      applePickerHint: 'Choose an EPUB or PDF from your Apple Books library to link into this shelf.',
      appleSearchPlaceholder: 'Search Apple Books title or author',
      appleLoading: 'Reading Apple Books library…',
      appleLoadMore: 'Load more',
      appleImport: 'Import',
      appleImporting: 'Importing…',
      appleImported: 'Imported “{title}”',
      appleAlreadyImported: 'This book is already on the shelf',
      appleOnShelf: 'On shelf',
      appleUnsupportedShort: 'Unsupported',
      appleSourceUnavailableShort: 'Unavailable',
      appleUnsupported: 'Audiobooks are not supported',
      appleSourceUnavailable: 'Source unavailable',
      appleNoBooks: 'No books found',
      appleNoBooksHint: 'Download an EPUB or PDF in Apple Books first.',
      appleUnavailableTitle: 'Cannot read the Apple Books library',
      applePermissionHint: 'If the library is not visible, allow DSH Full Disk Access in System Settings.',
      appleImportFailed: 'Import failed: {message}',
      appleTotal: '{count} books',
      appleProgress: '{percent}% read',
      appleLastOpened: 'Opened {date}',
      noResults: 'No matching books',
      noResultsHint: 'Try a different title, author, or file name.',
      clearFilters: 'Clear search and sorting',
      import: 'Import books',
      importFilesMenu: 'Import book files…',
      importFilesHint: 'Choose one or more EPUB or PDF files to copy into the shelf',
      importFolderMenu: 'Link a folder…',
      importFolderHint: 'Soft-link every book in a folder; copies when links are unavailable',
      importing: 'Importing…',
      importingFile: 'Importing {name}…',
      importedCount: 'Imported {count} books.',
      importFailed: 'Import failed: {message}',
      unsupportedFile: '{name} is not a PDF or EPUB file.',
      tooLarge: '{name} is larger than 256 MB.',
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
      readerLabel: 'Reading {title}',
      rendering: 'Opening the PDF…',
      parsing: 'Opening the EPUB…',
      openFailed: 'Could not open this book: {message}',
      pageFailed: 'Page failed',
      chapterTooLarge: 'This chapter is too large to display comfortably.',
      readingProgress: 'Reading progress',
      continueReading: 'Continue reading',
      finishedReading: 'Finished',
      tocTab: 'Contents',
      bookmarksTab: 'Bookmarks',
      asideLabel: 'Reading navigation',
      bookmark: 'Bookmark',
      addBookmark: 'Add bookmark',
      removeBookmark: 'Remove bookmark',
      deleteBookmark: 'Delete bookmark',
      noBookmarks: 'No bookmarks yet. Scroll to a spot you want to keep and press the bookmark button.',
      pageLabel: 'Page {number}',
      pageOf: '{current} / {total}',
      pdfPages: '{total} pages',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fitWidth: 'Fit width',
      fitPage: 'Fit page',
      pdfSingle: 'Single page',
      pdfContinuous: 'Continuous',
      pdfViewMode: 'Page layout',
      toc: 'Contents',
      chapterNumber: 'Chapter {number}',
      chapterOf: '{current} / {total}',
      previousChapter: 'Previous chapter',
      nextChapter: 'Next chapter',
      fontSmaller: 'Smaller text',
      readingSettings: 'Reading settings',
      shelfSettings: 'Bookshelf settings',
      shelfSettingsHint: 'Reading defaults and the workspace used by Discuss this page.',
      discussionWorkspaceSetting: 'Discuss this page workspace',
      discussionWorkspaceSettingHint: 'When set, Discuss this page creates the conversation directly in this workspace. Ask every time keeps the workspace picker.',
      discussionWorkspaceAsk: 'Ask every time',
      defaultReadingSettings: 'Default reading settings',
      defaultReadingSettingsHint: 'Used for books that have no individual reading settings.',
      defaultsSaveFailed: 'Could not save default settings: {message}',
      fontFamily: 'Typeface',
      fontSerif: 'Serif',
      fontSans: 'Sans',
      fontMono: 'Mono',
      fontSize: 'Text size',
      lineHeight: 'Line height',
      lineCompact: 'Tight',
      lineNormal: 'Normal',
      lineLoose: 'Loose',
      pageMargins: 'Page margins',
      marginStandard: 'Standard',
      marginCompact: 'Compact',
      marginFill: 'Fill',
      readingTheme: 'Page theme',
      readingMode: 'Reading mode',
      modeScroll: 'Scroll',
      modePaged: 'Paged',
      pageOfChapter: 'Page {current} / {total}',
      pageRangeOf: '{current}–{end} / {total}',
      pageRangeOfChapter: 'Pages {current}–{end} / {total}',
      pageSpread: 'Page layout (experimental)',
      spreadAuto: 'Auto two-page',
      spreadSingle: 'Always single',
      previousPage: 'Previous page',
      nextPage: 'Next page',
      themeAuto: 'Auto',
      themeLight: 'Light',
      themeDark: 'Dark',
      immersive: 'Immersive reading',
      exitImmersive: 'Exit immersive mode',
      fullscreen: 'Fullscreen',
      exitFullscreen: 'Exit fullscreen',
      fontLarger: 'Larger text',
      discussPage: 'Discuss this page',
      discussionResume: 'Resume page discussion',
      discussionHint: 'Create a new conversation and place this page\'s text in its composer as a file reference. Nothing is sent; write your own question and submit it. Continue reading independently; the file copy stays unchanged.',
      discussionWorkspace: 'Conversation workspace',
      discussionChooseWorkspace: 'Choose a workspace…',
      discussionNoWorkspaces: 'Add a workspace in DSH, then return here to choose it.',
      discussionCreate: 'Prepare conversation',
      discussionCreating: 'Preparing conversation…',
      discussionPromptPrefix: 'Read this page, then answer:\n\n',
      discussionRetry: 'Retry preparing conversation',
      discussionDiscard: 'Discard pending handoff',
      discussionPending: 'Retry keeps the original page and the same conversation target. Workspace:',
      discussionCoverage: 'Visible text only. Images and other non-text content are not included; this is not a complete physical-page copy.',
      discussionPartial: 'Only part of the visible content was captured. The conversation will retain this limitation; images and other non-text content are not included.',
      discussionNoText: 'No visible text could be captured. A conversation cannot be created from this page. Choose a page with readable text.',
      discussionPreview: 'Captured page text',
      discussionTooLarge: 'This page snapshot exceeds the conversation size limit. Choose a smaller visible text range and try again.',
      discussionSourceUnavailable: 'The book service did not provide a source revision. Reload the DSH Host after enabling Books support, then reopen this book.',
      discussionCaptureUnavailable: 'Page capture is unavailable. Reload DSH and reopen the book: {message}',
      discussionUnavailable: 'Conversation support is unavailable. Reload DSH after enabling Books support.',
      discussionStale: 'The bookshelf conversation support is out of date. Fully reload the DSH page and try again.',
      discussionPageNotReady: 'The page is still loading or restoring its position. Wait for the page to settle, then try again.',
      discussionSaved: 'The conversation is ready but was not opened because navigation changed. Open it from the list and write your question; the page file is already in its composer.',
      crashTitle: 'The bookshelf hit an error',
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
      appleBooksImportToggle: 'Apple Books import',
      appleBooksImportToggleHint: 'macOS only. Turn this off to hide the Apple Books button; the shelf and page discussion keep working.',
    }

    const zh = {
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
      appleBooks: 'Apple Books',
      more: '更多',
      addLocalBooks: '添加本地书籍',
      linkImportHint: '选择包含 EPUB 或 PDF 的文件夹；系统允许时创建软链接，否则保存一份副本。原文件不会被删除。',
      linkChooseTitle: '从文件夹软链接导入',
      linkPickHint: '选择书籍所在的文件夹。书架会尽可能创建软链接，在 Windows 无法创建时自动保存副本；删除书架条目不会删除原文件。',
      linkPickFolder: '选择文件夹…',
      linkPicking: '请在系统窗口中选择文件夹…',
      linkPickCancelled: '未选择文件夹',
      linkPickFailed: '无法打开文件夹选择器：{message}',
      linkNoFiles: '这个文件夹里没有 EPUB 或 PDF',
      linkNoFilesHint: '换一个文件夹，或先把书下载到该文件夹。',
      linkFilterPlaceholder: '筛选这个文件夹里的文件',
      linkAdd: '添加',
      linkAdding: '添加中…',
      linkAdded: '已添加《{title}》',
      linkAlready: '已在书架',
      linkChooseAnother: '换一个文件夹',
      linkDone: '完成',
      linkFailed: '添加失败：{message}',
      linkFileCount: '{count} 个文件',
      linkSoftNote: '支持软链接时只创建软链接，否则保存副本；删除书架条目不会删除原文件。',
      linkSoftShort: '软链接',
      linkCopyShort: '副本',
      linkAddedCopy: '已将《{title}》保存为书架副本；系统不允许创建软链接。',
      rename: '重命名',
      bookTitleLabel: '书名',
      bookAuthorLabel: '作者',
      save: '保存',
      saving: '保存中…',
      renameFailed: '保存失败：{message}',
      renamed: '已更新书籍信息',
      importAppleBooks: '从 Apple Books 导入',
      applePickerHint: '从 Apple Books 书库选择 EPUB 或 PDF，以软链接加入本地书架。',
      appleSearchPlaceholder: '搜索 Apple Books 书名或作者',
      appleLoading: '正在读取 Apple Books 书库…',
      appleLoadMore: '加载更多',
      appleImport: '导入',
      appleImporting: '导入中…',
      appleImported: '已导入《{title}》',
      appleAlreadyImported: '这本书已在书架中',
      appleOnShelf: '已在书架',
      appleUnsupportedShort: '不支持',
      appleSourceUnavailableShort: '不可用',
      appleUnsupported: '有声书暂不支持',
      appleSourceUnavailable: '书源不可用',
      appleNoBooks: '没有找到书',
      appleNoBooksHint: '请先在 Apple Books 中下载 EPUB 或 PDF。',
      appleUnavailableTitle: '无法读取 Apple Books 书库',
      applePermissionHint: '如果书库不可见，请在系统设置中为 DSH 开启“完全磁盘访问”。',
      appleImportFailed: '导入失败：{message}',
      appleTotal: '共 {count} 本',
      appleProgress: '阅读 {percent}%',
      appleLastOpened: '最近打开 {date}',
      noResults: '没有找到匹配的书',
      noResultsHint: '换一个书名、作者或文件名试试。',
      clearFilters: '清除搜索和排序',
      import: '导入书籍',
      importFilesMenu: '导入书籍文件…',
      importFilesHint: '选择一个或多个 EPUB / PDF 文件并复制到书架',
      importFolderMenu: '软链接文件夹…',
      importFolderHint: '为文件夹中的书建立软链接；系统不允许时保存副本',
      importing: '正在导入…',
      importingFile: '正在导入 {name}…',
      importedCount: '已导入 {count} 本书。',
      importFailed: '导入失败：{message}',
      unsupportedFile: '{name} 不是 PDF 或 EPUB 文件。',
      tooLarge: '{name} 超过 256 MB。',
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
      readerLabel: '正在阅读《{title}》',
      rendering: '正在打开 PDF…',
      parsing: '正在打开 EPUB…',
      openFailed: '无法打开这本书：{message}',
      pageFailed: '页面渲染失败',
      chapterTooLarge: '这一章内容过大，无法舒适地显示。',
      readingProgress: '阅读进度',
      continueReading: '继续阅读',
      finishedReading: '已读完',
      tocTab: '目录',
      bookmarksTab: '书签',
      asideLabel: '阅读导航',
      bookmark: '书签',
      addBookmark: '添加书签',
      removeBookmark: '移除书签',
      deleteBookmark: '删除书签',
      noBookmarks: '还没有书签。滚动到想记住的位置，点书签按钮即可添加。',
      pageLabel: '第 {number} 页',
      pageOf: '{current} / {total}',
      pdfPages: '共 {total} 页',
      zoomIn: '放大',
      zoomOut: '缩小',
      fitWidth: '适应宽度',
      fitPage: '适应页面',
      pdfSingle: '单页',
      pdfContinuous: '连续',
      pdfViewMode: '翻页方式',
      toc: '目录',
      chapterNumber: '第 {number} 章',
      chapterOf: '{current} / {total}',
      previousChapter: '上一章',
      nextChapter: '下一章',
      fontSmaller: '减小字号',
      readingSettings: '阅读设置',
      shelfSettings: '书架设置',
      shelfSettingsHint: '阅读默认设置，以及“讨论此页”使用的工作区。',
      discussionWorkspaceSetting: '“讨论此页”工作区',
      discussionWorkspaceSettingHint: '设置后，“讨论此页”会直接在该工作区创建对话；选择“每次询问”则保留工作区选择弹窗。',
      discussionWorkspaceAsk: '每次询问',
      defaultReadingSettings: '默认阅读设置',
      defaultReadingSettingsHint: '应用于尚未单独设置阅读样式的书。',
      defaultsSaveFailed: '保存默认设置失败：{message}',
      fontFamily: '字体',
      fontSerif: '衬线',
      fontSans: '无衬线',
      fontMono: '等宽',
      fontSize: '字号',
      lineHeight: '行距',
      lineCompact: '紧凑',
      lineNormal: '标准',
      lineLoose: '宽松',
      pageMargins: '左右页边距',
      marginStandard: '标准',
      marginCompact: '紧凑',
      marginFill: '铺满',
      readingTheme: '页面主题',
      readingMode: '阅读方式',
      modeScroll: '滚动',
      modePaged: '分页',
      pageOfChapter: '第 {current} / {total} 页',
      pageRangeOf: '{current}–{end} / {total}',
      pageRangeOfChapter: '第 {current}–{end} / {total} 页',
      pageSpread: '分页布局（实验）',
      spreadAuto: '自动双页',
      spreadSingle: '始终单页',
      previousPage: '上一页',
      nextPage: '下一页',
      themeAuto: '跟随',
      themeLight: '浅色',
      themeDark: '深色',
      immersive: '沉浸阅读',
      exitImmersive: '退出沉浸模式',
      fullscreen: '全屏',
      exitFullscreen: '退出全屏',
      fontLarger: '增大字号',
      discussPage: '讨论此页',
      discussionResume: '继续创建页面讨论',
      discussionHint: '将点击时屏幕上可见的文字保存为工作区文件并放入新对话的输入框，不会自动发送；请自行输入问题后发送。之后继续翻书不会改变这份文件。',
      discussionWorkspace: '对话工作区',
      discussionChooseWorkspace: '选择工作区…',
      discussionNoWorkspaces: '请先在 DSH 中添加工作区，再回到这里选择。',
      discussionCreate: '准备对话',
      discussionCreating: '正在准备对话…',
      discussionPromptPrefix: '请阅读这页书的内容，然后回答：\n\n',
      discussionRetry: '重试准备对话',
      discussionDiscard: '放弃待完成的创建',
      discussionPending: '重试会保留原始页面快照和同一个目标对话。工作区：',
      discussionCoverage: '仅包含可见文字，不包含图片等非文字内容，也不代表完整实体页面。',
      discussionPartial: '只捕获了部分可见内容，对话中会保留此覆盖限制；不包含图片等非文字内容。',
      discussionNoText: '未能捕获可见文字，无法从此页创建对话。请翻到含有可读文字的页面。',
      discussionPreview: '已捕获的页面文字',
      discussionTooLarge: '页面快照超出了对话大小限制。请缩小可见文字范围后重试。',
      discussionSourceUnavailable: '书籍服务未提供来源版本。请在启用 Books 支持后重新加载 DSH Host，再重新打开这本书。',
      discussionCaptureUnavailable: '页面捕获暂不可用，请重新加载 DSH 并打开书籍：{message}',
      discussionUnavailable: '对话功能暂不可用，请在启用 Books 支持后重新加载 DSH。',
      discussionStale: '书架对话支持仍是旧版本。请完整重新加载 DSH 页面后再试。',
      discussionPageNotReady: '页面仍在载入或恢复阅读位置。请等待页面稳定后重试。',
      discussionSaved: '对话已准备好，但准备期间页面导航发生了变化，未自动打开。请从对话列表打开并输入问题；页面文件已在输入框中。',
      crashTitle: '书架出现了一个错误',
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
      appleBooksImportToggle: 'Apple Books 导入',
      appleBooksImportToggleHint: '仅 macOS 可用。关闭后隐藏 Apple Books 按钮，书架和页面讨论仍可使用。',
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands', 'remote.session', 'uiWorkspace', 'layout', 'sidebarRight', 'sidebarRightTabs', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'bookshelf: dictionaries')
        const t = ctx.locale.bind(NS)
        const viewState = { openBookId: null, query: '', sortMode: 'added', scrollTop: 0 }
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
