import { mkdir, open, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { sourceRevision } from './source-revision.js';

/**
 * Bookshelf-owned right-sidebar page snapshot.
 *
 * The shelf captures the visible page, this Host half writes it as a workspace
 * file and persists a display-only snapshot for the Books tab. It never sends a
 * chat message, creates a turn, or injects hidden model context.
 */
export const SIDEBAR_SNAPSHOT_KEY = 'shelfPageSnapshot';
export const SIDEBAR_COMMAND = 'bookshelf-snapshot';
export const SIDEBAR_MARKER = 'bookshelf-page-snapshot-v1';
export const SIDEBAR_ERROR_MARKER = 'bookshelf-page-snapshot-error-v1';
export const SIDEBAR_FILE_DIR = '.dsh-bookshelf';
export const SIDEBAR_LIMITS = Object.freeze({
  maxCharacters: 16000,
  maxSegments: 256,
  maxJSONBytes: 262144,
  maxVisitedNodes: 30000,
  maxScannedCodeUnits: 2000000,
  maxGeometryQueries: 24000,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVISION = /^shelf-(?:file|directory)-v1:[a-f0-9]{64}$/;
const CAPTURED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const scalarLength = (value) => Array.from(value).length;
const scalarSlice = (value, start, end) => Array.from(value).slice(start, end).join('');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const string = (value, maximum, minimum = 0) =>
  typeof value === 'string' && value.length >= minimum && value.length <= maximum;

export class SidebarSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SidebarSnapshotError';
    this.code = code;
  }
}
const invalid = () => {
  throw new SidebarSnapshotError('INVALID_SNAPSHOT', 'The page snapshot is malformed or exceeds the capture limits.');
};

function parseSegments(value, documentID, maximum) {
  if (!Array.isArray(value) || value.length > SIDEBAR_LIMITS.maxSegments) invalid();
  let cursor = 0;
  let total = 0;
  return value.map((segment) => {
    if (!isObject(segment) || !string(segment.documentID, 4096, 1) || segment.documentID !== documentID ||
        !integer(segment.start) || !integer(segment.end) || !string(segment.text, 32000)) invalid();
    const length = scalarLength(segment.text);
    if (segment.end <= segment.start || segment.end - segment.start !== length ||
        segment.start < cursor || length > SIDEBAR_LIMITS.maxCharacters) invalid();
    cursor = segment.end;
    total += length;
    if (total > maximum) invalid();
    return { documentID: segment.documentID, start: segment.start, end: segment.end, text: segment.text };
  });
}

function parseSelection(value, documentID, maximum, visibleSegments) {
  if (value === undefined) return undefined;
  if (!isObject(value) || !string(value.text, 32000) || typeof value.truncated !== 'boolean') invalid();
  const segments = parseSegments(value.segments, documentID, maximum);
  if (segments.length === 0 || scalarLength(value.text) > maximum) invalid();
  for (const segment of segments) {
    const visible = visibleSegments.find((part) => part.start <= segment.start && part.end >= segment.end);
    if (!visible || scalarSlice(visible.text, segment.start - visible.start, segment.end - visible.start) !== segment.text) invalid();
  }
  return { text: value.text, segments, truncated: value.truncated };
}

/**
 * Validate and sanitize a capture. This is intentionally dependency-free so
 * the shelf plugin stays self-contained; the same rules mirror the renderer's
 * scalar-coordinate contract.
 */
export function parseSidebarSnapshot(value) {
  if (!isObject(value) || value.version !== 1 || !UUID.test(value.snapshotId) || !UUID.test(value.bookId) ||
      !string(value.title, 4096) || !string(value.author, 4096) || !string(value.sourceRevision, 512, 1) ||
      !REVISION.test(value.sourceRevision) || !string(value.documentID, 4096, 1) || !string(value.chapterTitle, 4096) ||
      !string(value.capturedAt, 64, 1) || !CAPTURED_AT.test(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt)) ||
      (value.pageMode !== 'paged' && value.pageMode !== 'scroll') || !string(value.pageLabel, 512) ||
      value.coordinateKind !== 'rendered-dom-text' || value.extractionVersion !== 'rendered-dom-text-v1' ||
      !string(value.text, 32000) || typeof value.truncated !== 'boolean') invalid();
  if (!isObject(value.coverage) || value.coverage.kind !== 'visible-text' || value.coverage.physicalPageComplete !== false ||
      !['captured', 'partial', 'empty'].includes(value.coverage.status) ||
      !Array.isArray(value.coverage.limitations) || value.coverage.limitations.length > 64 ||
      value.coverage.limitations.some((entry) => !string(entry, 2048)) || !isObject(value.coverage.limits)) invalid();
  const limits = value.coverage.limits;
  if (!integer(limits.maxCharacters) || limits.maxCharacters < 1 || limits.maxCharacters > 16000 ||
      limits.maxSegments !== SIDEBAR_LIMITS.maxSegments || limits.maxJSONBytes !== SIDEBAR_LIMITS.maxJSONBytes ||
      limits.maxVisitedNodes !== SIDEBAR_LIMITS.maxVisitedNodes || limits.maxScannedCodeUnits !== SIDEBAR_LIMITS.maxScannedCodeUnits ||
      limits.maxGeometryQueries !== SIDEBAR_LIMITS.maxGeometryQueries) invalid();
  const maximum = limits.maxCharacters;
  if (scalarLength(value.text) > maximum || scalarLength(value.text) > SIDEBAR_LIMITS.maxCharacters) invalid();
  const segments = parseSegments(value.segments, value.documentID, maximum);
  const selection = parseSelection(value.selection, value.documentID, maximum, segments);
  if ((!value.text && value.coverage.status !== 'empty') || (value.text && value.coverage.status === 'empty') ||
      (value.truncated && value.text && value.coverage.status !== 'partial')) invalid();
  const snapshot = {
    version: 1,
    snapshotId: value.snapshotId,
    bookId: value.bookId,
    title: value.title,
    author: value.author,
    sourceRevision: value.sourceRevision,
    documentID: value.documentID,
    chapterTitle: value.chapterTitle,
    capturedAt: value.capturedAt,
    pageMode: value.pageMode,
    pageLabel: value.pageLabel,
    coordinateKind: 'rendered-dom-text',
    extractionVersion: 'rendered-dom-text-v1',
    segments,
    text: value.text,
    ...(selection === undefined ? {} : { selection }),
    truncated: value.truncated,
    coverage: {
      kind: 'visible-text',
      physicalPageComplete: false,
      status: value.coverage.status,
      limitations: [...value.coverage.limitations],
      limits: {
        maxCharacters: limits.maxCharacters,
        maxSegments: SIDEBAR_LIMITS.maxSegments,
        maxJSONBytes: SIDEBAR_LIMITS.maxJSONBytes,
        maxVisitedNodes: SIDEBAR_LIMITS.maxVisitedNodes,
        maxScannedCodeUnits: SIDEBAR_LIMITS.maxScannedCodeUnits,
        maxGeometryQueries: SIDEBAR_LIMITS.maxGeometryQueries,
      },
    },
  };
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > SIDEBAR_LIMITS.maxJSONBytes) invalid();
  return snapshot;
}

function parseFile(value) {
  if (!isObject(value) || !string(value.path, 4096, 1) || !string(value.mention, 4096, 1) || !string(value.label, 512, 1)) invalid();
  return { path: value.path, mention: value.mention, label: value.label };
}

const fileSchema = {
  parse(value) { return parseFile(value); },
  safeParse(value) {
    try { return { success: true, data: parseFile(value) }; }
    catch (error) { return { success: false, error }; }
  },
  '~standard': {
    version: 1,
    vendor: 'bookshelf',
    validate(value) {
      try { return { value: parseFile(value) }; }
      catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
    },
  },
};

export const sidebarSnapshotStateSchema = {
  parse(value) {
    if (!isObject(value) || !Array.isArray(value.pending) || value.pending.length > 64 ||
        value.pending.some((id) => typeof id !== 'string')) invalid();
    if (!(value.snapshot === null || isObject(value.snapshot))) invalid();
    if (!(value.file === null || value.file === undefined || isObject(value.file))) invalid();
    return {
      snapshot: value.snapshot === null ? null : parseSidebarSnapshot(value.snapshot),
      file: value.file === null || value.file === undefined ? null : parseFile(value.file),
      pending: [...value.pending],
    };
  },
  safeParse(value) {
    try { return { success: true, data: this.parse(value) }; }
    catch (error) { return { success: false, error }; }
  },
  '~standard': {
    version: 1,
    vendor: 'bookshelf',
    validate(value) {
      try { return { value: this.parse(value) }; }
      catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
    },
  },
};

const sidebarSnapshotViewSchema = {
  parse(value) { return value === null ? null : parseSidebarSnapshot(value); },
  safeParse(value) {
    try { return { success: true, data: this.parse(value) }; }
    catch (error) { return { success: false, error }; }
  },
  '~standard': {
    version: 1,
    vendor: 'bookshelf',
    validate(value) {
      try { return { value: this.parse(value) }; }
      catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
    },
  },
};

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Display-only projection. `command/done` carries the complete snapshot and
 * file; no inbox splice or user message is involved, so this never becomes
 * model context.
 */
export const sidebarSnapshotProjection = {
  key: SIDEBAR_SNAPSHOT_KEY,
  stateVersion: 1,
  stateSchema: sidebarSnapshotStateSchema,
  init: () => ({ snapshot: null, file: null, pending: [] }),
  apply(state, event) {
    if (event.type === 'command/run' && event.data?.name === SIDEBAR_COMMAND && typeof event.data.commandId === 'string') {
      return { ...state, pending: [...state.pending, event.data.commandId].slice(-64) };
    }
    if (event.type !== 'command/done' || typeof event.data?.commandId !== 'string' || !state.pending.includes(event.data.commandId)) return state;
    const pending = state.pending.filter((id) => id !== event.data.commandId);
    if (event.data.kind !== 'success' || typeof event.data.text !== 'string' ||
        Buffer.byteLength(event.data.text, 'utf8') > SIDEBAR_LIMITS.maxJSONBytes + 1024) return { ...state, pending };
    try {
      const result = JSON.parse(event.data.text);
      if (!isObject(result) || result.marker !== SIDEBAR_MARKER) return { ...state, pending };
      const snapshot = parseSidebarSnapshot(result.snapshot);
      const file = parseFile(result.file);
      if (state.snapshot && !sameSnapshot(state.snapshot, snapshot)) return { ...state, pending };
      return { snapshot: state.snapshot ?? snapshot, file, pending };
    } catch {
      return { ...state, pending };
    }
  },
  wire: {
    viewSchema: sidebarSnapshotViewSchema,
    view: (state) => state.snapshot,
  },
};

class ShelfSidebarSource {
  constructor(rootDir) {
    this.root = rootDir;
  }
  async library() {
    const handle = await open(join(this.root, 'library.json'), 'r');
    try {
      if ((await handle.stat()).size > 16 * 1024 * 1024) throw new Error('library too large');
      const raw = await handle.readFile({ encoding: 'utf8' });
      if (Buffer.byteLength(raw, 'utf8') > 16 * 1024 * 1024) throw new Error('library too large');
      const value = JSON.parse(raw);
      if (!isObject(value) || !Array.isArray(value.books)) throw new Error('invalid library');
      return value.books;
    } finally { await handle.close(); }
  }
  async registered(bookId) {
    if (!UUID.test(bookId)) return false;
    const books = await this.library();
    return books.some((book) => book?.id === bookId && book.format === 'epub');
  }
  async verify(snapshot) {
    if (!UUID.test(snapshot.bookId)) throw new SidebarSnapshotError('INVALID_SNAPSHOT', 'Invalid shelf book identity.');
    try {
      if (!await this.registered(snapshot.bookId)) throw new SidebarSnapshotError('BOOK_NOT_REGISTERED', 'This EPUB is no longer registered in the bookshelf.');
      const current = await sourceRevision(join(this.root, 'books', `${snapshot.bookId}.epub`));
      if (current !== snapshot.sourceRevision) throw new SidebarSnapshotError('SOURCE_CHANGED', 'The EPUB source changed. Return to the bookshelf and capture the page again.');
      if (!await this.registered(snapshot.bookId)) throw new SidebarSnapshotError('BOOK_NOT_REGISTERED', 'This EPUB is no longer registered in the bookshelf.');
    } catch (error) {
      if (error instanceof SidebarSnapshotError) throw error;
      throw new SidebarSnapshotError('SOURCE_UNAVAILABLE', 'The registered EPUB could not be verified. Return to the bookshelf and check its source.');
    }
  }
  async sourceInfo(bookId) {
    if (!UUID.test(bookId)) return null;
    try {
      const books = await this.library();
      const book = books.find((entry) => entry?.id === bookId && entry.format === 'epub');
      if (!book) return null;
      return {
        originalPath: book.link && typeof book.link.path === 'string' ? book.link.path : '',
        shelfPath: join(this.root, 'books', `${bookId}.epub`),
      };
    } catch { return null; }
  }
}

function snapshotLabel(snapshot) {
  const label = [snapshot.title || 'Books', snapshot.chapterTitle, snapshot.pageLabel]
    .filter((value) => typeof value === 'string' && value.trim() !== '').join(' · ');
  return (label || 'Books page').replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 120);
}

async function writePageFile(cwd, snapshot, sourceInfo = {}) {
  if (typeof cwd !== 'string' || cwd === '' || !isAbsolute(cwd)) {
    throw new SidebarSnapshotError('WORKSPACE_UNAVAILABLE', 'The conversation has no workspace directory for the page file.');
  }
  const directory = join(cwd, SIDEBAR_FILE_DIR);
  const name = `${snapshot.snapshotId}.md`;
  const absolute = join(directory, name);
  const relative = `${SIDEBAR_FILE_DIR}/${name}`;
  const originalPath = typeof sourceInfo.originalPath === 'string' ? sourceInfo.originalPath : '';
  const shelfPath = typeof sourceInfo.shelfPath === 'string' ? sourceInfo.shelfPath : '';
  const preamble = [
    '# Before answering / 回答前请先确认',
    '',
    originalPath === '' ? 'Original book file: (unavailable)' : `Original book file: ${originalPath}`,
    ...(shelfPath === '' ? [] : [`Shelf file: ${shelfPath}`]),
    '',
    'Ask the user these three questions before answering the page question:',
    '1. 是否允许使用联网工具？ / May I use web or network tools?',
    '2. 是否读取全书内容？ / Should I read the whole book from the original file, or answer only from this captured page?',
    '3. 是否以模型本身的世界知识回答？ / May I use my own world knowledge, or should I stay strictly within the book?',
    '',
    'Do not give the substantive answer before the user has chosen these three options. Then follow the choices. / 请不要在用户回答这三个问题前给出实质回答；得到选择后再按要求作答。',
    '',
    '---',
    '',
    `# ${snapshot.title || 'Captured page'}`,
    '',
    `Book: ${snapshot.title}`,
    `Author: ${snapshot.author}`,
    `Chapter: ${snapshot.chapterTitle}`,
    `Page: ${snapshot.pageLabel}`,
    `Captured: ${snapshot.capturedAt}`,
    `Source revision: ${snapshot.sourceRevision}`,
    `Coordinates: ${snapshot.coordinateKind} / ${snapshot.extractionVersion}`,
    `Truncated: ${snapshot.truncated}`,
    'Physical page complete: false',
    '',
    'Visible text captured from the bookshelf. This is a rendered-DOM reading capture, not canonical EPUB source text and not a complete physical page. Images, off-screen content and generated content are not included.',
    '',
  ].join('\n');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(absolute, `${preamble}${snapshot.text || '[No visible text was captured.]'}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    if (error instanceof SidebarSnapshotError) throw error;
    throw new SidebarSnapshotError('FILE_WRITE_FAILED', 'The page file could not be written in this workspace.');
  }
  return { path: relative, mention: `@${relative}`, label: snapshotLabel(snapshot) };
}

export class ShelfSidebarSnapshotController {
  constructor(projections, rootDir, source = new ShelfSidebarSource(rootDir)) {
    this.projections = projections;
    this.source = source;
    this.busy = new WeakSet();
  }
  state(session) {
    const state = this.projections.stateOf(session, SIDEBAR_SNAPSHOT_KEY);
    if (!state) throw new SidebarSnapshotError('CAPABILITY_UNAVAILABLE', 'The bookshelf page-snapshot projection is unavailable.');
    return state;
  }
  async prepare(exec, supplied) {
    const snapshot = parseSidebarSnapshot(supplied);
    const session = exec.agent?.session;
    const cwd = session?.header?.cwd;
    if (!session || typeof cwd !== 'string' || cwd === '') {
      throw new SidebarSnapshotError('SESSION_UNAVAILABLE', 'A receiving conversation and its workspace are required.');
    }
    if (this.busy.has(session)) throw new SidebarSnapshotError('SNAPSHOT_BUSY', 'A page file is being prepared. Retry this capture after it settles.');
    this.busy.add(session);
    try {
      exec.signal?.throwIfAborted();
      const state = this.state(session);
      if (state.snapshot && !sameSnapshot(state.snapshot, snapshot)) {
        throw new SidebarSnapshotError('SNAPSHOT_CONFLICT', 'This conversation already contains a different page snapshot. Create a new conversation for another capture.');
      }
      if (!state.snapshot) await this.source.verify(snapshot);
      exec.signal?.throwIfAborted();
      let sourceInfo = null;
      try {
        if (typeof this.source.sourceInfo === 'function') sourceInfo = await this.source.sourceInfo(snapshot.bookId);
      } catch { /* The page file remains useful without the original address. */ }
      const file = await writePageFile(cwd, snapshot, sourceInfo || {});
      return { marker: SIDEBAR_MARKER, snapshot: state.snapshot ?? snapshot, file };
    } finally {
      this.busy.delete(session);
    }
  }
}

export function createSidebarSnapshotCommand(controller) {
  return {
    name: SIDEBAR_COMMAND,
    definitionId: '@local/dsh-bookshelf/snapshot',
    description: 'Write this bookshelf page to a workspace file and register it for the Books tab; no message is sent and no model context is injected.',
    input: { hint: 'JSON: {"action":"prepare","snapshot":{...}}' },
    recordInput: false,
    async handler(exec) {
      try {
        if (typeof exec.rawInput !== 'string' || Buffer.byteLength(exec.rawInput, 'utf8') > SIDEBAR_LIMITS.maxJSONBytes + 1024) invalid();
        let action;
        try { action = JSON.parse(exec.rawInput); } catch { throw new SidebarSnapshotError('INVALID_SNAPSHOT', 'The page snapshot command is malformed.'); }
        if (!isObject(action) || action.action !== 'prepare') throw new SidebarSnapshotError('INVALID_SNAPSHOT', 'Unsupported bookshelf page snapshot action.');
        const result = await controller.prepare(exec, action.snapshot);
        return { kind: 'success', text: JSON.stringify(result) };
      } catch (error) {
        const failure = error instanceof SidebarSnapshotError
          ? error
          : new SidebarSnapshotError('PREPARE_FAILED', 'The page file could not be prepared. Retry the same capture.');
        return {
          kind: 'error',
          text: JSON.stringify({ marker: SIDEBAR_ERROR_MARKER, code: failure.code, message: failure.message }),
        };
      }
    },
  };
}
