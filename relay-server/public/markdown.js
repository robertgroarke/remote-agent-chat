import { getLang as _getLang } from './file-utils.js';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(String(s)).replace(/"/g, '&quot;');
}

function looksLikePath(line) {
  return /^[A-Za-z]:\\/.test(line)
    || line.includes('\\')
    || line.includes('/')
    || /^[.~]\//.test(line);
}

function countDiffStats(text) {
  let adds = 0;
  let dels = 0;
  text.split('\n').forEach(line => {
    if (/^\+\+\+|^---|^@@/.test(line)) return;
    if (line.startsWith('+')) adds++;
    if (line.startsWith('-')) dels++;
  });
  return { adds, dels };
}

function hasEditLikeToolName(name) {
  return /\b(edit|edited|patch|diff|apply_patch|write)\b/i.test(String(name || ''));
}

// ─── Tool icon set (A11-10) ───────────────────────────────────────────────────
// 16×16 inline SVGs, currentColor, codicons-aesthetic. user-select:none via CSS.
const TOOL_ICONS = {
  read:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h12M2 6h8M2 9h10M2 12h6"/></svg>`,
  write:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5l4 4-7 7H2.5v-4l7-7z"/><path d="M11 4l1 1"/></svg>`,
  bash:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4 7,8 3,12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>`,
  search:  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6.5" r="4"/><line x1="10" y1="10" x2="13.5" y2="13.5"/></svg>`,
  browser: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="2" width="14" height="12" rx="1.5"/><line x1="1" y1="5.5" x2="15" y2="5.5"/><circle cx="3.5" cy="3.75" r="0.75" fill="currentColor" stroke="none"/><circle cx="6" cy="3.75" r="0.75" fill="currentColor" stroke="none"/></svg>`,
  glob:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l5 3-5 3"/><line x1="9" y1="11" x2="14" y2="11"/></svg>`,
  config:  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4"/></svg>`,
  unknown: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M6 6.5a2 2 0 0 1 4 0c0 1.5-2 2-2 3.5"/><circle cx="8" cy="12" r="0.6" fill="currentColor" stroke="none"/></svg>`,
};

function toolIcon(name) {
  const lower = (name || '').toLowerCase();
  let key = 'unknown';
  if (lower.includes('read'))                                                key = 'read';
  else if (lower.includes('edit') || lower.includes('write') || lower.includes('patch')) key = 'write';
  else if (lower.includes('bash') || lower.includes('run') || lower.includes('command') || lower.includes('execute')) key = 'bash';
  else if (lower.includes('search') || lower.includes('grep') || lower.includes('find') || lower.includes('glob'))   key = 'search';
  else if (lower.includes('browser') || lower.includes('web') || lower.includes('fetch')) key = 'browser';
  else if (lower.includes('config') || lower.includes('setting'))           key = 'config';
  return `<span class="tool-icon-svg" aria-hidden="true">${TOOL_ICONS[key]}</span>`;
}

// Returns the CSS modifier class for the coloured ● dot indicator
function toolDotClass(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('bash') || lower.includes('run') || lower.includes('command') || lower.includes('execute')) return 'dot-bash';
  if (lower.includes('read'))                                                return 'dot-read';
  if (lower.includes('edit') || lower.includes('write') || lower.includes('patch')) return 'dot-write';
  if (lower.includes('search') || lower.includes('grep') || lower.includes('find') || lower.includes('glob'))    return 'dot-search';
  if (lower.includes('browser') || lower.includes('web') || lower.includes('fetch')) return 'dot-browser';
  return 'dot-default';
}

function parseToolSections(content) {
  const lines = String(content || '').split('\n');
  const chunks = [];
  let markdownBuffer = [];
  let currentTool = null;

  function flushMarkdown() {
    const text = markdownBuffer.join('\n').trim();
    if (text) chunks.push({ type: 'markdown', content: text });
    markdownBuffer = [];
  }

  function flushTool() {
    if (!currentTool) return;
    const body = currentTool.lines.join('\n').trimEnd();
    chunks.push({ type: 'tool', name: currentTool.name, content: body });
    currentTool = null;
  }

  lines.forEach(line => {
    const match = line.match(/^\[([^\]\n]+)\]\s*$/);
    const codexOp =
      line.match(/^(Ran .+|Read .+|Edited file|Edit .+|Analyzed .+|Search(?:ed)? .+|Bash .+)\s*$/);
    // Bare "N lines [of output]" text (no brackets) — Claude Code renders tool output
    // summaries as non-<details> DOM nodes in some versions, so nodeToText emits
    // the summary text as plain text.  Treat it the same as [N lines of output].
    // Matches both "74 lines" and "81 lines of output".
    const bareOutputBlock = !currentTool && line.match(/^(\d+\s+lines?(?:\s+of\s+output)?)$/i);
    if (match) {
      // [end] closes the current tool section and returns to markdown
      if (match[1].trim() === 'end') {
        flushTool();
        return;
      }
      flushMarkdown();
      flushTool();
      currentTool = { name: match[1].trim(), lines: [] };
      return;
    }
    if (bareOutputBlock) {
      flushMarkdown();
      flushTool();
      // Start a tool section — any content that follows (e.g. a code fence) becomes the body
      currentTool = { name: bareOutputBlock[1].trim(), lines: [] };
      return;
    }
    if (codexOp) {
      flushMarkdown();
      flushTool();
      currentTool = { name: codexOp[1].trim(), lines: [] };
      return;
    }
    if (currentTool) currentTool.lines.push(line);
    else markdownBuffer.push(line);
  });

  flushMarkdown();
  flushTool();

  return chunks.length > 0 ? chunks : [{ type: 'markdown', content: String(content || '') }];
}

// Returns true when text looks like a unified diff, regardless of fenced language tag.
function isDiffContent(text) {
  if (!text) return false;
  if (/^@@/m.test(text) || (/^---/m.test(text) && /^\+\+\+/m.test(text))) return true;
  const lines = String(text).split('\n').map(line => line.trimEnd());
  const nonEmpty = lines.filter(Boolean);
  if (nonEmpty.length < 3) return false;
  const changed = nonEmpty.filter(line => /^[+-](?![-+]{2})/.test(line)).length;
  const bullets = nonEmpty.filter(line => /^[-+]\s+[A-Za-z0-9]/.test(line)).length;
  return changed >= 2 && changed >= Math.max(2, Math.floor(nonEmpty.length * 0.25)) && bullets < changed;
}

// Extract target filename from a unified diff's +++ header.
// Handles "+++ b/path/to/file.js" and "+++ path/to/file.js".
// Falls back to --- header when +++ points to /dev/null.
function extractDiffFilename(text) {
  const plus = text.match(/^\+\+\+[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);
  if (plus) {
    const p = plus[1].trim();
    if (p && p !== '/dev/null') return p;
  }
  const minus = text.match(/^---[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);
  if (minus) {
    const p = minus[1].trim();
    if (p && p !== '/dev/null') return p;
  }
  return null;
}

// ─── Word-level diff helpers ─────────────────────────────────────────────────

// O(n²) character-level LCS diff. Returns [{type:'eq'|'del'|'ins', ch}] or
// null when either string exceeds the length limit (too expensive to compute).
const MAX_WORD_DIFF_LEN = 300;
function charLCS(a, b) {
  if (a.length > MAX_WORD_DIFF_LEN || b.length > MAX_WORD_DIFF_LEN) return null;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: 'eq' }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'ins' }); j--;
    } else {
      ops.unshift({ type: 'del' }); i--;
    }
  }
  return ops;
}

// Character ranges in `a` that are deletions (not in `b`).
function lcsDeletedRanges(ops) {
  const ranges = [];
  let pos = 0, start = null;
  for (const op of ops) {
    if (op.type === 'del') {
      if (start === null) start = pos;
      pos++;
    } else if (op.type === 'eq') {
      if (start !== null) { ranges.push({ start, end: pos }); start = null; }
      pos++;
    }
  }
  if (start !== null) ranges.push({ start, end: pos });
  return ranges;
}

// Character ranges in `b` that are insertions (not in `a`).
function lcsInsertedRanges(ops) {
  const ranges = [];
  let pos = 0, start = null;
  for (const op of ops) {
    if (op.type === 'ins') {
      if (start === null) start = pos;
      pos++;
    } else if (op.type === 'eq') {
      if (start !== null) { ranges.push({ start, end: pos }); start = null; }
      pos++;
    }
  }
  if (start !== null) ranges.push({ start, end: pos });
  return ranges;
}

// Inject <mark class="cls"> spans into an hljs-highlighted HTML string at the
// given plain-text character ranges. HTML tags are treated as zero-width;
// an open mark is closed before each tag and reopened after when still inside
// a range, so marks never straddle hljs span boundaries.
function injectMarksIntoHtml(html, ranges, cls) {
  if (!ranges || !ranges.length) return html;
  let result = '';
  let textPos = 0;
  let ri = 0;
  let inMark = false;
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      if (inMark) { result += '</mark>'; inMark = false; }
      const end = html.indexOf('>', i);
      if (end === -1) { result += html[i++]; continue; }
      result += html.slice(i, end + 1);
      i = end + 1;
      // Reopen mark after tag if still inside a range
      if (ri < ranges.length && textPos >= ranges[ri].start && textPos < ranges[ri].end) {
        result += `<mark class="${cls}">`;
        inMark = true;
      }
    } else {
      // Close exhausted range, then open next
      if (inMark && textPos >= ranges[ri].end) { result += '</mark>'; inMark = false; ri++; }
      if (!inMark && ri < ranges.length && textPos >= ranges[ri].start) {
        result += `<mark class="${cls}">`;
        inMark = true;
      }
      // Consume one logical text character (HTML entity = 1 char)
      if (html[i] === '&') {
        const semi = html.indexOf(';', i + 1);
        const end = (semi !== -1 && semi - i <= 8) ? semi + 1 : i + 1;
        result += html.slice(i, end);
        i = end;
      } else {
        result += html[i++];
      }
      textPos++;
    }
  }
  if (inMark) result += '</mark>';
  return result;
}

// ─── Plain code block line numbers (A11-02) ──────────────────────────────────

// Wrap each highlighted line in a .code-line span containing a .code-line-num
// and the line's content. Reuses splitHighlightedLines so hljs spans are never
// split across line boundaries.
function addLineNumbers(hlHtml) {
  const lines = splitHighlightedLines(hlHtml);
  // Drop a trailing empty line — hljs output often ends with \n
  if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map((line, i) =>
    `<span class="code-line"><span class="code-line-num">${i + 1}</span>${line}</span>`
  ).join('');
}

// ─── Diff gutter helpers ──────────────────────────────────────────────────────

// Render the two-column line-number gutter for the unified view.
// oldNum / newNum are integers or null (null → blank cell).
function diffGutter(oldNum, newNum) {
  return `<span class="diff-gutter">` +
    `<span class="diff-gutter-num diff-gutter-old">${oldNum != null ? oldNum : ''}</span>` +
    `<span class="diff-gutter-num diff-gutter-new">${newNum != null ? newNum : ''}</span>` +
    `</span>`;
}

// Render a single line-number cell for one pane of the split view.
function splitGutter(num) {
  return `<span class="diff-gutter"><span class="diff-gutter-num">${num != null ? num : ''}</span></span>`;
}

// Assign oldLine / newLine to every entry by tracking counters across hunk headers.
// Called on the entries array in-place before rendering.
function assignLineNumbers(entries) {
  let oldLine = 0, newLine = 0;
  for (const entry of entries) {
    if (entry.type === 'hunk') {
      const m = entry.raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10) - 1;
        newLine = parseInt(m[2], 10) - 1;
      }
      entry.oldLine = null;
      entry.newLine = null;
    } else if (entry.type === 'add') {
      entry.oldLine = null;
      entry.newLine = ++newLine;
    } else if (entry.type === 'del') {
      entry.oldLine = ++oldLine;
      entry.newLine = null;
    } else if (entry.type === 'ctx') {
      entry.oldLine = ++oldLine;
      entry.newLine = ++newLine;
    } else {
      entry.oldLine = null;
      entry.newLine = null;
    }
  }
}

// ─── Split-view helpers ───────────────────────────────────────────────────────

// Build an array of virtual rows for the side-by-side view.
// Each row describes what goes in the left (old) and right (new) column.
// Reuses the already-computed hlLines and wordDiffContent maps so content
// is consistent between unified and split views.
function buildSplitRows(entries, hlLines, wordDiffContent) {
  const rows = [];
  const getContent = (idx) =>
    wordDiffContent.has(idx) ? wordDiffContent.get(idx)
    : (hlLines && hlLines[idx] != null) ? hlLines[idx]
    : escapeHtml(
        (entries[idx].raw.startsWith('+') || entries[idx].raw.startsWith('-'))
          ? entries[idx].raw.slice(1)
          : entries[idx].raw.startsWith(' ') ? entries[idx].raw.slice(1) : entries[idx].raw
      );
  const hlCls = (idx) => (hlLines && hlLines[idx] != null) ? ' diff-hl' : '';

  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (e.type === 'meta') {
      const html = `<span class="diff-meta">${escapeHtml(e.raw)}</span>`;
      rows.push({ type: 'both', html }); i++; continue;
    }
    if (e.type === 'hunk') {
      const html = `<span class="diff-hunk">${escapeHtml(e.raw)}</span>`;
      rows.push({ type: 'both', html }); i++; continue;
    }
    if (e.type === 'ctx') {
      rows.push({ type: 'ctx', content: getContent(i), hlCls: hlCls(i), oldLine: e.oldLine, newLine: e.newLine }); i++; continue;
    }
    // Group del/add runs
    let di = i;
    while (di < entries.length && entries[di].type === 'del') di++;
    let ai = di;
    while (ai < entries.length && entries[ai].type === 'add') ai++;
    const delCount = di - i, addCount = ai - di;
    const pairs = Math.min(delCount, addCount);
    for (let k = 0; k < pairs; k++) {
      rows.push({
        type: 'pair',
        delContent: getContent(i + k), delHlCls: hlCls(i + k),
        addContent: getContent(di + k), addHlCls: hlCls(di + k),
        delOldLine: entries[i + k].oldLine,
        addNewLine: entries[di + k].newLine,
      });
    }
    for (let k = pairs; k < delCount; k++) {
      rows.push({ type: 'del', content: getContent(i + k), hlCls: hlCls(i + k), oldLine: entries[i + k].oldLine });
    }
    for (let k = pairs; k < addCount; k++) {
      rows.push({ type: 'add', content: getContent(di + k), hlCls: hlCls(di + k), newLine: entries[di + k].newLine });
    }
    i = ai > i ? ai : i + 1;
  }
  return rows;
}

function renderSplitHtml(rows) {
  const left = [], right = [];
  for (const row of rows) {
    if (row.type === 'both') {
      left.push(row.html); right.push(row.html);
    } else if (row.type === 'ctx') {
      left.push(`<span class="diff-ctx${row.hlCls}">${splitGutter(row.oldLine)}${row.content}</span>`);
      right.push(`<span class="diff-ctx${row.hlCls}">${splitGutter(row.newLine)}${row.content}</span>`);
    } else if (row.type === 'pair') {
      left.push(`<span class="diff-del${row.delHlCls}">${splitGutter(row.delOldLine)}${row.delContent}</span>`);
      right.push(`<span class="diff-add${row.addHlCls}">${splitGutter(row.addNewLine)}${row.addContent}</span>`);
    } else if (row.type === 'del') {
      left.push(`<span class="diff-del${row.hlCls}">${splitGutter(row.oldLine)}${row.content}</span>`);
      right.push(`<span class="diff-empty"></span>`);
    } else if (row.type === 'add') {
      left.push(`<span class="diff-empty"></span>`);
      right.push(`<span class="diff-add${row.hlCls}">${splitGutter(row.newLine)}${row.content}</span>`);
    }
  }
  return `<div class="diff-split">` +
    `<div class="diff-split-col diff-split-old"><code class="hljs diff-code">${left.join('')}</code></div>` +
    `<div class="diff-split-col diff-split-new"><code class="hljs diff-code">${right.join('')}</code></div>` +
    `</div>`;
}

// ─── Diff renderer ────────────────────────────────────────────────────────────

// Split an hljs-highlighted HTML string at newline boundaries, ensuring open
// <span> tags are closed at the end of each line and reopened at the start of
// the next. This keeps every line self-contained so it can be wrapped in a
// display:block row span without leaving unclosed tags.
function splitHighlightedLines(html) {
  const lines = [];
  let current = '';
  const openTags = []; // stack of class strings for currently-open spans
  let i = 0;
  while (i < html.length) {
    if (html[i] === '\n') {
      lines.push(current + '</span>'.repeat(openTags.length));
      current = openTags.map(cls => `<span class="${cls}">`).join('');
      i++;
    } else if (html[i] === '<') {
      if (html.startsWith('</span>', i)) {
        openTags.pop();
        current += '</span>';
        i += 7;
      } else if (html.startsWith('<span', i)) {
        const end = html.indexOf('>', i);
        if (end === -1) { current += html[i++]; continue; }
        const tag = html.slice(i, end + 1);
        const m = tag.match(/class="([^"]*)"/);
        openTags.push(m ? m[1] : '');
        current += tag;
        i = end + 1;
      } else {
        current += html[i++];
      }
    } else {
      current += html[i++];
    }
  }
  if (current || openTags.length) {
    lines.push(current + '</span>'.repeat(openTags.length));
  }
  return lines;
}

// lang — hljs language id derived from the diff's file path (may be null).
// When recognized, code content inside each diff row is syntax-highlighted
// while the +/- background tint and gutter are preserved.
function renderDiff(text, lang) {
  // Resolve to a language hljs actually knows
  const hljsLang = (() => {
    if (!lang || typeof hljs === 'undefined') return null;
    if (hljs.getLanguage(lang)) return lang;
    const ext = lang.split('.').pop().toLowerCase();
    return hljs.getLanguage(ext) ? ext : null;
  })();

  // Parse every line into a typed entry
  const rawLines = text.split('\n');
  const entries = rawLines.map(line => {
    if (/^\+\+\+|^---/.test(line)) return { type: 'meta', raw: line };
    if (/^@@/.test(line))           return { type: 'hunk', raw: line };
    if (line.startsWith('+'))       return { type: 'add',  raw: line };
    if (line.startsWith('-'))       return { type: 'del',  raw: line };
    return { type: 'ctx', raw: line };
  });

  // Assign oldLine / newLine to each entry by scanning hunk headers (A11-01)
  assignLineNumbers(entries);

  // Build a syntax-highlighted array aligned 1:1 with entries.
  // meta/hunk entries contribute an empty string so indices stay in sync.
  let hlLines = null;
  if (hljsLang) {
    try {
      const stripped = entries.map(e => {
        if (e.type === 'meta' || e.type === 'hunk') return '';
        return (e.raw.startsWith('+') || e.raw.startsWith('-'))
          ? e.raw.slice(1)
          : e.raw.startsWith(' ') ? e.raw.slice(1) : e.raw;
      });
      const result = hljs.highlight(stripped.join('\n'), { language: hljsLang });
      hlLines = splitHighlightedLines(result.value);
    } catch (_) {
      hlLines = null;
    }
  }

  // ── Word-level inline diff ───────────────────────────────────────────────────
  // For runs of exactly N consecutive del lines followed by N add lines,
  // inject <mark> highlights for the specific characters that changed.
  const wordDiffContent = new Map(); // entry index → html with <mark> injected
  for (let si = 0; si < entries.length; ) {
    if (entries[si].type !== 'del') { si++; continue; }
    let di = si;
    while (di < entries.length && entries[di].type === 'del') di++;
    let ai = di;
    while (ai < entries.length && entries[ai].type === 'add') ai++;
    const delCount = di - si;
    const addCount = ai - di;
    if (delCount === addCount && delCount > 0) {
      for (let k = 0; k < delCount; k++) {
        const delIdx = si + k;
        const addIdx = di + k;
        const delPlain = entries[delIdx].raw.slice(1);
        const addPlain = entries[addIdx].raw.slice(1);
        const ops = charLCS(delPlain, addPlain);
        if (!ops) continue;
        // Skip when lines are too dissimilar — full-row highlight is clearer
        const lcsLen = ops.filter(o => o.type === 'eq').length;
        const maxLen = Math.max(delPlain.length, addPlain.length);
        if (maxLen > 0 && lcsLen / maxLen < 0.15) continue;
        const delBase = (hlLines && hlLines[delIdx] != null) ? hlLines[delIdx] : escapeHtml(delPlain);
        const addBase = (hlLines && hlLines[addIdx] != null) ? hlLines[addIdx] : escapeHtml(addPlain);
        wordDiffContent.set(delIdx, injectMarksIntoHtml(delBase, lcsDeletedRanges(ops), 'diff-word-del'));
        wordDiffContent.set(addIdx, injectMarksIntoHtml(addBase, lcsInsertedRanges(ops), 'diff-word-add'));
      }
    }
    si = ai > si ? ai : si + 1;
  }

  let adds = 0, dels = 0;
  let hunkId = 0;
  let hasHunks = false;
  const outputLines = entries.map((entry, i) => {
    if (entry.type === 'meta') {
      return `<span class="diff-meta">${escapeHtml(entry.raw)}</span>`;
    }
    if (entry.type === 'hunk') {
      hasHunks = true;
      hunkId++;
      return `<span class="diff-hunk diff-hunk-btn" data-hunk-id="${hunkId}" role="button" tabindex="0" title="Toggle context lines">${escapeHtml(entry.raw)}</span>`;
    }

    const plain = (entry.raw.startsWith('+') || entry.raw.startsWith('-'))
      ? entry.raw.slice(1)
      : entry.raw.startsWith(' ') ? entry.raw.slice(1) : entry.raw;
    const content  = wordDiffContent.has(i) ? wordDiffContent.get(i)
                   : (hlLines && hlLines[i] != null) ? hlLines[i] : escapeHtml(plain);
    const hlClass  = (hlLines && hlLines[i] != null) ? ' diff-hl' : '';
    const hunkAttr = hunkId > 0 ? ` data-hunk-ctx="${hunkId}"` : '';

    if (entry.type === 'add') {
      adds++;
      return `<span class="diff-add${hlClass}"${hunkAttr}>${diffGutter(null, entry.newLine)}${content}</span>`;
    }
    if (entry.type === 'del') {
      dels++;
      return `<span class="diff-del${hlClass}"${hunkAttr}>${diffGutter(entry.oldLine, null)}${content}</span>`;
    }
    // ctx
    return `<span class="diff-ctx${hlClass}"${hunkAttr}>${diffGutter(entry.oldLine, entry.newLine)}${content}</span>`;
  });

  const stats = (adds || dels)
    ? `<span class="diff-stat-add">+${adds}</span><span class="diff-stat-del">-${dels}</span>`
    : '';
  const splitRows = buildSplitRows(entries, hlLines, wordDiffContent);
  const splitHtml = renderSplitHtml(splitRows);
  return { body: outputLines.join(''), stats, splitHtml, hasHunks };
}

const SPLIT_SVG  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`;
const SEARCH_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
const COPY_SVG = `<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const CHECK_SVG = `<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// Line threshold above which a code block gets the expand/collapse toggle.
// Roughly 360px / 1.6em line-height / 13px font ≈ 17 lines visible.
const BLOCK_COLLAPSE_LINES = 30;

const codeRenderer = new marked.Renderer();
codeRenderer.code = function(code, infostring) {
  let text = typeof code === 'object' ? (code.text || code.raw || '') : (code || '');
  let info = typeof code === 'object' ? (code.lang || '') : (infostring || '');
  const lang = info.split(/\s/)[0].toLowerCase() || 'text';
  // Auto-detect diff format even when the language tag is absent or wrong
  const isDiff = lang === 'diff' || lang === 'patch' || isDiffContent(text);

  let body;
  let statsHtml = '';
  let filepath = '';
  let splitHtml = '';
  let diffResult = null;
  if (isDiff) {
    filepath = extractDiffFilename(text) || '';
    const diffLang = filepath ? (_getLang(filepath)) : null;
    diffResult = renderDiff(text, diffLang);
    body = diffResult.body;
    statsHtml = diffResult.stats;
    splitHtml = diffResult.splitHtml || '';
  } else {
    try {
      body = hljs.getLanguage(lang)
        ? hljs.highlight(text, { language: lang }).value
        : hljs.highlightAuto(text).value;
    } catch (e) {
      body = escapeHtml(text);
    }
  }

  // Add line numbers to plain (non-diff) code blocks (A11-02)
  const rawText = text; // original source, used for copy
  if (!isDiff) body = addLineNumbers(body);

  // For diff blocks: hide the lang label (it's redundant), show filepath chip instead
  const displayLang = (isDiff || lang === 'text') ? '' : lang;
  const filepathHtml = filepath
    ? `<button class="diff-filepath" title="Click to copy path" data-copy-path="${escapeAttr(filepath)}">${escapeHtml(filepath)}</button>`
    : '';

  const splitToggle = splitHtml
    ? `<button class="diff-split-toggle" title="Toggle side-by-side view">${SPLIT_SVG}</button>`
    : '';
  const ctxCollapseToggle = (isDiff && diffResult && diffResult.hasHunks)
    ? `<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</button>`
    : '';
  const lineCount = body.split('\n').length;
  const collapsible = lineCount > BLOCK_COLLAPSE_LINES;
  const expandToggle = collapsible
    ? `<button class="code-expand-toggle" title="Expand block">Expand</button>`
    : '';
  // Wrap toggle — applies saved global preference on first render (A11-04)
  const wrapOn = typeof localStorage !== 'undefined' && localStorage.getItem('codeblock_wrap_pref') === '1';
  const wrapToggle = `<button class="code-wrap-toggle${wrapOn ? ' active' : ''}" title="${wrapOn ? 'Disable word wrap' : 'Enable word wrap'}">${wrapOn ? 'No Wrap' : 'Wrap'}</button>`;
  // For plain blocks, store raw source on <code> so the copy handler can skip line-number spans
  const rawAttr = !isDiff ? ` data-raw="${escapeAttr(rawText)}"` : '';
  return `<div class="code-block${isDiff ? ' diff-block' : ''}${collapsible ? ' code-collapsible' : ''}${wrapOn ? ' code-wrap' : ''}" data-diff-mode="unified">
    <div class="code-header">
      <span class="code-lang">${displayLang}</span>
      ${filepathHtml}
      <span class="diff-stats">${statsHtml}</span>
      ${ctxCollapseToggle}
      ${splitToggle}
      ${expandToggle}
      ${wrapToggle}
      <button class="code-search-btn" title="Search in block">${SEARCH_SVG}</button>
      <button class="code-copy" title="Copy code">${COPY_SVG}${CHECK_SVG}<span class="copy-label">Copy</span></button>
    </div>
    <div class="code-search-bar" hidden>
      <input class="code-search-input" type="text" placeholder="Search…" aria-label="Search in code block">
      <span class="code-search-count"></span>
      <button class="code-search-prev" title="Previous match">&#8593;</button>
      <button class="code-search-next" title="Next match">&#8595;</button>
      <button class="code-search-close" title="Close search">&#10005;</button>
    </div>
    <pre><code class="hljs${isDiff ? ' diff-code' : ''}"${rawAttr}>${body}</code></pre>
    ${splitHtml}
  </div>`;
};

marked.use({ renderer: codeRenderer, breaks: true, gfm: true });

function extractToolPreview(name, lines) {
  const lname = (name || '').toLowerCase();
  // For Bash-like tools: return the first non-empty line (the command)
  if (lname === 'bash' || lname === 'run' || lname === 'execute' || lname === 'shell') {
    const cmd = lines.find(l => l.trim());
    return cmd ? cmd.trim().substring(0, 80) : '';
  }
  // For Read/Write/Edit-like tools: first non-empty line if it looks like a path
  const first = lines.find(l => l.trim());
  if (first && looksLikePath(first.trim())) return first.trim();
  // Fallback: first 60 chars of first non-empty line
  if (first) return first.trim().substring(0, 60);
  return '';
}

function renderToolSection(name, text, index) {
  const lines = String(text || '').replace(/\n+$/, '').split('\n');
  const nonEmpty = lines.find(line => line.trim());
  const path = nonEmpty && looksLikePath(nonEmpty.trim()) ? nonEmpty.trim() : '';
  const lineCount = lines.filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === '')).length;
  // "N lines [of output]" sections always start collapsed — they're tool result dumps
  // that clutter the chat when expanded inline. When expanded, all lines are shown.
  const isOutputBlock = /^\d+\s+lines?(?:\s+of\s+output)?$/i.test(name.trim());
  // If the output block has no content (proxy failed to capture the lazy DOM body),
  // we still show it collapsed so the user can see something happened, but add a note.
  const hasContent = lines.some(l => l.trim());
  const isEmpty = (isOutputBlock && lineCount === 0) || !hasContent;
  // Collapse command blocks by default — Codex conversations have many Bash blocks
  // with verbose output that push narrative text off screen. Keep them collapsed
  // like the IDE side pane does. Edit/diff blocks stay expanded if short.
  const isBashBlock = /^Bash\b/i.test(name.trim());
  const isCommandOnlyBash = isBashBlock && lines.every(line => {
    const t = line.trim();
    return !t || /^\$\s+/.test(t);
  });
  const collapsed = lineCount > 50 || isOutputBlock || !hasContent || (isBashBlock && !isCommandOnlyBash && lineCount > 4) || (isCommandOnlyBash && lineCount > 12);
  // Output blocks show everything when expanded; other long sections still get the
  // "Show all N lines" affordance so they don't blow out the viewport.
  const showAll = !isOutputBlock && lineCount > 60;
  const shownLines = showAll && collapsed ? 24 : lineCount;
  const visibleText = showAll && collapsed ? lines.slice(0, shownLines).join('\n') : lines.join('\n');
  const stats = countDiffStats(text);
  const renderAsDiff = isDiffContent(text) || (hasEditLikeToolName(name) && (stats.adds || stats.dels));
  const filepath = renderAsDiff ? (extractDiffFilename(text) || path) : path;
  const diffLang = renderAsDiff && filepath ? (_getLang(filepath)) : null;
  // Strip fenced code block wrappers and summary text (e.g. "Modified\n\n```diff\n...\n```")
  // so renderDiff only sees the actual diff lines
  const diffText = (() => {
    if (!renderAsDiff) return visibleText;
    let t = visibleText;
    // Strip leading summary lines before the first +/- or @@
    const fenceMatch = t.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```\s*$/m);
    if (fenceMatch) t = fenceMatch[1];
    // Strip any remaining leading non-diff lines (e.g. "Modified", "Added 3 lines")
    const dlines = t.split('\n');
    let start = 0;
    while (start < dlines.length) {
      const l = dlines[start];
      if (l.startsWith('+') || l.startsWith('-') || l.startsWith('@@') || l.startsWith(' ')) break;
      start++;
    }
    return dlines.slice(start).join('\n');
  })();
  const diff = renderAsDiff ? renderDiff(diffText, diffLang) : null;
  const statHtml = (stats.adds || stats.dels)
    ? `<span class="tool-stat-add">+${stats.adds}</span><span class="tool-stat-del">-${stats.dels}</span>`
    : '';
  // Extract edit summary (e.g. "Modified", "Added 8 lines") from lines before the diff
  const editSummary = renderAsDiff ? (() => {
    for (const l of lines) {
      const t = l.trim();
      if (t && !t.startsWith('```') && !t.startsWith('+') && !t.startsWith('-') && !t.startsWith('@@') && !t.startsWith(' ')) return t;
    }
    return '';
  })() : '';
  // Preview: shown only when collapsed and no filepath already displayed
  const preview = collapsed && !filepath ? (editSummary || extractToolPreview(name, lines)) : (editSummary || '');
  return `<section class="tool-section${collapsed ? ' collapsed' : ''}" data-tool-index="${index}">
    <button class="tool-toggle" type="button" aria-expanded="${collapsed ? 'false' : 'true'}">
      <span class="tool-chevron">${isEmpty ? '' : collapsed ? '▸' : '▾'}</span>
      <span class="tool-dot ${toolDotClass(name)}">●</span>
      <span class="tool-toggle-main">
        ${(() => {
          // Split tool name into verb (bold) and description (smaller)
          const spaceIdx = name.indexOf(' ');
          if (spaceIdx > 0) {
            const verb = name.substring(0, spaceIdx);
            const desc = name.substring(spaceIdx + 1).trim();
            return `<span class="tool-name">${escapeHtml(verb)}</span><span class="tool-path">${escapeHtml(desc)}</span>`;
          }
          return `<span class="tool-name">${escapeHtml(name)}</span>`;
        })()}
        ${filepath ? `<span class="tool-path">${escapeHtml(filepath)}</span>` : ''}
        ${preview ? `<span class="tool-preview">${escapeHtml(preview)}</span>` : ''}
      </span>
      <span class="tool-toggle-side">
        ${statHtml}
        ${isOutputBlock && lineCount > 0 ? `<span class="tool-line-count">${lineCount} lines</span>` : ''}
      </span>
    </button>
    ${isEmpty ? '' : `<div class="tool-body"${collapsed ? ' hidden' : ''}>
      ${renderAsDiff
        ? `<div class="code-block diff-block tool-diff-block" data-diff-mode="unified">
            <div class="code-header">
              <span class="code-lang"></span>
              ${filepath ? `<button class="diff-filepath" title="Click to copy path" data-copy-path="${escapeAttr(filepath)}">${escapeHtml(filepath)}</button>` : ''}
              <span class="diff-stats">${diff?.stats || ''}</span>
              ${diff?.hasHunks ? `<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</button>` : ''}
              ${diff?.splitHtml ? `<button class="diff-split-toggle" title="Toggle side-by-side view">${SPLIT_SVG}</button>` : ''}
            </div>
            <pre><code class="hljs diff-code">${diff?.body || ''}</code></pre>
            ${diff?.splitHtml || ''}
          </div>`
        : (() => {
              const _io = parseIOBlock(visibleText);
              if (_io) return renderIOBlock(_io, index + '_b');
              const trimmed = visibleText.trim();
              if (trimmed.startsWith('```')) return `<div class="tool-body-md">${marked.parse(trimmed)}</div>`;
              return `<pre class="tool-body-pre"><code>${escapeHtml(visibleText)}</code></pre>`;
            })()}
      ${showAll && collapsed ? `<button class="tool-show-all tool-io-more-btn" type="button" data-lines="${lineCount}">▸ ${lineCount} lines</button>` : ''}
    </div>`}
  </section>`;
}

// ─── Compact IN/OUT block (Bash tool call results) ───────────────────────────
//
// Claude Code renders Bash tool calls as:
//   IN\n\n```[lang]\ncommand\n```\nOUT\n\n```[lang]\noutput\n```
//
// Instead of the verbose code-block-with-header treatment that marked.parse()
// produces, we render this as a compact two-row IN/OUT block matching the
// Claude Code desktop app's style.

const IO_BLOCK_RE = /^IN\n\n?```([^\n]*)\n([\s\S]*?)\n```\n\n?OUT(?:\n\n?```([^\n]*)\n([\s\S]*?)\n```)?[\s]*$/;

// Plain text IN/OUT format (no code fences) — produced by structured tool use scraping
const IO_PLAIN_RE = /^IN\n([\s\S]*?)(?:\nOUT\n([\s\S]*))?$/;

function parseIOBlock(content) {
  if (!content) return null;
  const c = content.replace(/\r\n/g, '\n');
  if (!c.startsWith('IN\n')) return null;
  // Try fenced format first (original)
  const m = c.match(IO_BLOCK_RE);
  if (m) return { inLang: m[1] || '', inText: m[2] || '', outLang: m[3] || '', outText: m[4] || '' };
  // Try plain text format (structured tool use scraping)
  const mp = c.match(IO_PLAIN_RE);
  if (mp) return { inLang: '', inText: (mp[1] || '').trim(), outLang: '', outText: (mp[2] || '').trim() };
  return null;
}

const IO_PREVIEW_LINES = 10; // keep Claude IN/OUT blocks much closer to native fidelity

function renderIOBlock(io, index) {
  const inLines  = (io.inText || '').trimEnd().split('\n');
  const outLines = (io.outText || '').trimEnd().split('\n');

  const renderRow = (label, lines) => {
    const preview  = lines.slice(0, IO_PREVIEW_LINES);
    const overflow = lines.slice(IO_PREVIEW_LINES);
    const previewHtml = escapeHtml(preview.join('\n'));
    const emptyNote = lines.length === 0 || (lines.length === 1 && !lines[0].trim())
      ? '<span class="tool-io-empty">(no output)</span>' : '';
    const rowClass = overflow.length > 0 ? 'tool-io-row has-overflow' : 'tool-io-row';
    if (!emptyNote && overflow.length > 0) {
      // Wrap preview and full content in sibling divs — toggled on expand/collapse
      return `<div class="${rowClass}">
        <span class="tool-io-label">${label}</span>
        <div class="tool-io-content">
          <div class="tool-io-preview"><code class="tool-io-code">${previewHtml}</code><button class="tool-io-more-btn" type="button" data-full="${escapeAttr(lines.join('\n'))}">▸ ${overflow.length} more line${overflow.length === 1 ? '' : 's'}</button></div>
          <div class="tool-io-full" hidden><code class="tool-io-full-code">${escapeHtml(lines.join('\n'))}</code><button class="tool-io-collapse-btn" type="button">▴ collapse</button></div>
        </div>
      </div>`;
    }
    return `<div class="${rowClass}">
      <span class="tool-io-label">${label}</span>
      <div class="tool-io-content">${emptyNote || `<code class="tool-io-code">${previewHtml}</code>`}</div>
    </div>`;
  };

  const outEmpty = outLines.length === 0 || (outLines.length === 1 && !outLines[0].trim());
  return `<div class="tool-io-block" data-tool-index="${index}">${renderRow('IN', inLines)}${outEmpty ? '' : renderRow('OUT', outLines)}</div>`;
}

function renderStructuredContent(content) {
  const html = parseToolSections(content).map((chunk, index) => {
    try {
      if (chunk.type === 'tool') return renderToolSection(chunk.name, chunk.content, index);
      // Detect compact IN/OUT block before falling through to full markdown rendering
      const io = parseIOBlock(chunk.content);
      if (io) return renderIOBlock(io, index);
      // Skip empty/whitespace-only markdown chunks
      if (!(chunk.content || '').trim()) return '';
      return marked.parse(chunk.content || '');
    } catch (e) {
      return '<pre style="color:var(--red,#f26d78);font-size:11px">[render error: ' + escapeHtml(String(e)) + ']</pre>' +
             '<pre>' + escapeHtml(chunk.content || '') + '</pre>';
    }
  }).join('');

  // ── Multi-file diff summary bar ───────────────────────────────────────────
  // Parse into a temporary element so we can query real DOM nodes — no regex.
  // Sanitize before touching the DOM to prevent XSS from agent-controlled content.
  const tmp = document.createElement('div');
  if (typeof DOMPurify !== 'undefined') {
    tmp.innerHTML = DOMPurify.sanitize(html, { ADD_DATA_URI_TAGS: ['img'], ALLOW_DATA_ATTR: true });
  } else {
    tmp.textContent = html; // safe fallback — no HTML rendering if DOMPurify unavailable
  }

  const diffBlocks = Array.from(tmp.querySelectorAll('.diff-block'));
  const fileEntries = diffBlocks.map((block, i) => {
    const pathEl = block.querySelector('.diff-filepath');
    if (!pathEl) return null;
    const filepath = pathEl.textContent.trim();
    if (!filepath) return null;
    const addEl = block.querySelector('.diff-stat-add, .tool-stat-add');
    const delEl = block.querySelector('.diff-stat-del, .tool-stat-del');
    const adds = addEl ? (parseInt(addEl.textContent, 10) || 0) : 0;
    const dels = delEl ? (parseInt(delEl.textContent, 10) || 0) : 0;
    block.id = `diff-file-${i}`;
    return { filepath, adds, dels, id: `diff-file-${i}` };
  }).filter(Boolean);

  if (fileEntries.length >= 2) {
    const totalAdds = fileEntries.reduce((s, e) => s + e.adds, 0);
    const totalDels = fileEntries.reduce((s, e) => s + e.dels, 0);
    const chips = fileEntries.map(e => {
      const name = e.filepath.split(/[/\\]/).pop();
      return `<a class="diff-summary-chip" data-target="${escapeAttr(e.id)}" href="#${escapeAttr(e.id)}" title="${escapeAttr(e.filepath)}">` +
        `<span class="diff-summary-name">${escapeHtml(name)}</span>` +
        `<span class="diff-stat-add">+${e.adds}</span>` +
        `<span class="diff-stat-del">-${e.dels}</span>` +
        `</a>`;
    }).join('');
    const totals =
      `<span class="diff-summary-totals">` +
      `<span class="diff-summary-count">${fileEntries.length} files</span>` +
      `<span class="diff-stat-add">+${totalAdds}</span>` +
      `<span class="diff-stat-del">-${totalDels}</span>` +
      `</span>`;
    const bar = document.createElement('div');
    bar.className = 'diff-summary-bar';
    bar.innerHTML = chips + totals;
    tmp.insertBefore(bar, tmp.firstChild);
  }

  return tmp.innerHTML;
}

// ── In-block search helpers (A11-12) ─────────────────────────────────────────

// Collect all text-node leaf positions in the <code> element as a flat string
// plus an array of {node, start, end} ranges so we can map back to DOM nodes.
function _codeTextMap(codeEl) {
  const ranges = [];
  let offset = 0;
  const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    // Skip line-number gutter spans (they are not real code content)
    if (node.parentElement && node.parentElement.classList.contains('code-line-num')) continue;
    const len = node.nodeValue.length;
    ranges.push({ node, start: offset, end: offset + len });
    offset += len;
  }
  return { text: ranges.map(r => r.node.nodeValue).join(''), ranges };
}

// Remove all existing <mark class="code-search-mark"> injected by a previous search
function _codeSearchClear(block) {
  if (!block) return;
  const codeEl = block.querySelector('code');
  if (!codeEl) return;
  // Restore original text nodes by unwrapping marks
  codeEl.querySelectorAll('mark.code-search-mark').forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
  const count = block.querySelector('.code-search-count');
  if (count) count.textContent = '';
  delete block._searchState;
}

// Run a search query against the code block and highlight all matches
function _codeSearchRun(block) {
  if (!block) return;
  _codeSearchClear(block);
  const input = block.querySelector('.code-search-input');
  const query = input ? input.value : '';
  if (!query) return;

  const codeEl = block.querySelector('code');
  if (!codeEl) return;
  const { text, ranges } = _codeTextMap(codeEl);

  // Find all match positions in the flat text string (case-insensitive)
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchOffsets = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = lowerText.indexOf(lowerQuery, pos);
    if (idx === -1) break;
    matchOffsets.push(idx);
    pos = idx + query.length;
  }

  if (!matchOffsets.length) {
    const count = block.querySelector('.code-search-count');
    if (count) count.textContent = '0 / 0';
    return;
  }

  // Inject <mark> nodes. Each match may span multiple text nodes.
  // Process matches in reverse order so DOM mutations don't shift offsets.
  const allMarks = [];
  for (let mi = matchOffsets.length - 1; mi >= 0; mi--) {
    const matchStart = matchOffsets[mi];
    const matchEnd   = matchStart + query.length;
    // Find all ranges that overlap [matchStart, matchEnd)
    const overlapping = ranges.filter(r => r.end > matchStart && r.start < matchEnd);
    for (let ri = overlapping.length - 1; ri >= 0; ri--) {
      const r = overlapping[ri];
      const localStart = Math.max(0, matchStart - r.start);
      const localEnd   = Math.min(r.node.nodeValue.length, matchEnd - r.start);
      const node = r.node;
      const text = node.nodeValue;
      const mark = document.createElement('mark');
      mark.className = 'code-search-mark';
      mark.textContent = text.slice(localStart, localEnd);
      const parent = node.parentNode;
      if (localEnd < text.length) {
        parent.insertBefore(document.createTextNode(text.slice(localEnd)), node.nextSibling);
      }
      parent.insertBefore(mark, localEnd < text.length ? node.nextSibling.previousSibling : node.nextSibling);
      if (localStart > 0) {
        node.nodeValue = text.slice(0, localStart);
      } else {
        parent.removeChild(node);
      }
      allMarks.unshift(mark);
    }
  }

  block._searchState = { marks: allMarks, current: 0 };
  const count = block.querySelector('.code-search-count');
  if (count) count.textContent = allMarks.length ? `1 / ${allMarks.length}` : '0 / 0';
  if (allMarks.length) {
    allMarks[0].classList.add('current');
    allMarks[0].scrollIntoView({ block: 'nearest' });
  }
}

function _codeSearchNav(block, direction) {
  if (!block || !block._searchState) return;
  const { marks } = block._searchState;
  if (!marks.length) return;
  marks[block._searchState.current].classList.remove('current');
  block._searchState.current = (block._searchState.current + direction + marks.length) % marks.length;
  const cur = marks[block._searchState.current];
  cur.classList.add('current');
  cur.scrollIntoView({ block: 'nearest' });
  const count = block.querySelector('.code-search-count');
  if (count) count.textContent = `${block._searchState.current + 1} / ${marks.length}`;
}

// ─── Streaming code-block fast-path (A11-11) ─────────────────────────────────

// Finds the last unclosed fenced code block in `text`.
// Returns { lang, code } when streaming, null when the last fence is closed
// or there are no fences.
function _extractLastOpenBlock(text) {
  // Count every ``` boundary (at line start); if odd, the last one is unclosed.
  const matches = [];
  let i = 0;
  while (i < text.length) {
    if ((i === 0 || text[i - 1] === '\n') && text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') {
      matches.push(i);
      i += 3;
    } else {
      i++;
    }
  }
  if (matches.length % 2 === 0) return null; // last fence is closed
  const openIdx = matches[matches.length - 1];
  const blockText = text.slice(openIdx + 3); // skip the ```
  const firstNL = blockText.indexOf('\n');
  if (firstNL === -1) return { lang: 'text', code: '' };
  const info = blockText.slice(0, firstNL).trim();
  const lang = info.split(/\s/)[0].toLowerCase() || 'text';
  const code = blockText.slice(firstNL + 1);
  return { lang, code };
}

function MarkdownContent({ content, monospace = false }) {
  const ref          = React.useRef(null);
  const lastContent  = React.useRef(null);  // A11-11: skip re-render when content is identical

  React.useEffect(() => {
    if (!ref.current) return;
    if (content === lastContent.current) return; // no-op: content unchanged

    // ── A11-11: Streaming fast-path ───────────────────────────────────────────
    // When the new content is a pure append to the previous render AND the last
    // fence is still unclosed (agent is streaming a code block), only patch the
    // last <code> element instead of replacing the whole message DOM.
    const prev = lastContent.current;
    if (prev !== null && content.startsWith(prev)) {
      const openBlock = _extractLastOpenBlock(content);
      if (openBlock && !isDiffContent(openBlock.code)) {
        const codeBlocks = ref.current.querySelectorAll('.code-block:not(.diff-block)');
        const lastBlock = codeBlocks.length > 0 ? codeBlocks[codeBlocks.length - 1] : null;
        const pre = lastBlock?.querySelector(':scope > pre');
        const codeEl = pre?.querySelector('code');
        if (codeEl) {
          const scrollTop = pre.scrollTop;
          let highlighted;
          try {
            highlighted = typeof hljs !== 'undefined' && hljs.getLanguage(openBlock.lang)
              ? hljs.highlight(openBlock.code, { language: openBlock.lang }).value
              : escapeHtml(openBlock.code);
          } catch (_) {
            highlighted = escapeHtml(openBlock.code);
          }
          codeEl.innerHTML = addLineNumbers(highlighted);
          // Update raw data attr so the copy button gets fresh content
          codeEl.dataset.raw = openBlock.code;
          // Add collapsible class if the block just grew large enough
          const lineCount = openBlock.code.split('\n').length;
          if (lineCount > BLOCK_COLLAPSE_LINES && !lastBlock.classList.contains('code-collapsible')) {
            lastBlock.classList.add('code-collapsible');
            if (!lastBlock.querySelector('.code-expand-toggle')) {
              const btn = document.createElement('button');
              btn.className = 'code-expand-toggle';
              btn.title = 'Expand block';
              btn.textContent = 'Expand';
              btn.onclick = () => {
                const expanded = lastBlock.classList.toggle('code-expanded');
                btn.textContent = expanded ? 'Collapse' : 'Expand';
                btn.title = expanded ? 'Collapse block' : 'Expand block';
                if (!expanded) lastBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              };
              const header = lastBlock.querySelector('.code-header');
              const copyBtn = header?.querySelector('.code-copy');
              if (header && copyBtn) header.insertBefore(btn, copyBtn);
            }
          }
          pre.scrollTop = scrollTop;
          lastContent.current = content;
          return; // skip full re-render
        }
      }
    }

    // A11-11: Snapshot interactive state before full re-render so we can restore it.
    // This preserves tool-section collapsed/expanded state and code-block scroll
    // positions when the same message's content is updated (e.g. streaming append).
    const snap = { toolCollapsed: {}, codeScroll: [], ctxHidden: {}, ctxCollapseActive: {} };
    if (lastContent.current !== null) {
      ref.current.querySelectorAll('.tool-section[data-tool-index]').forEach(s => {
        snap.toolCollapsed[s.dataset.toolIndex] = s.classList.contains('collapsed');
      });
      ref.current.querySelectorAll('.code-block pre').forEach((pre, i) => {
        snap.codeScroll[i] = pre.scrollTop;
      });
      // Preserve per-hunk context collapsed state: key = "blockIndex:hunkId"
      ref.current.querySelectorAll('.diff-block, .tool-diff-block').forEach((block, bi) => {
        block.querySelectorAll('.diff-hunk-btn').forEach(h => {
          snap.ctxHidden[`${bi}:${h.dataset.hunkId}`] = h.classList.contains('diff-hunk-ctx-collapsed');
        });
        const colBtn = block.querySelector('.diff-ctx-collapse-all');
        if (colBtn) snap.ctxCollapseActive[bi] = colBtn.classList.contains('active');
      });
    }

    lastContent.current = content;
    // SEC-08: Re-sanitize at final DOM insertion point as defense-in-depth
    const rendered = renderStructuredContent(content || '');
    ref.current.innerHTML = typeof DOMPurify !== 'undefined'
      ? DOMPurify.sanitize(rendered, { ADD_DATA_URI_TAGS: ['img'], ALLOW_DATA_ATTR: true })
      : rendered;

    // Restore tool-section collapsed states
    ref.current.querySelectorAll('.tool-section[data-tool-index]').forEach(s => {
      const idx = s.dataset.toolIndex;
      if (!(idx in snap.toolCollapsed)) return;
      const want = snap.toolCollapsed[idx];
      const has  = s.classList.contains('collapsed');
      if (want !== has) {
        s.classList.toggle('collapsed', want);
        const body    = s.querySelector('.tool-body');
        const chevron = s.querySelector('.tool-chevron');
        const btn     = s.querySelector('.tool-toggle');
        if (body)    body.hidden = want;
        if (chevron) chevron.textContent = want ? '▸' : '▾';
        if (btn)     btn.setAttribute('aria-expanded', want ? 'false' : 'true');
      }
    });

    // Restore per-hunk context hidden states
    ref.current.querySelectorAll('.diff-block, .tool-diff-block').forEach((block, bi) => {
      const code = block.querySelector('code');
      if (!code) return;
      block.querySelectorAll('.diff-hunk-btn').forEach(h => {
        const key = `${bi}:${h.dataset.hunkId}`;
        if (!(key in snap.ctxHidden) || !snap.ctxHidden[key]) return;
        code.querySelectorAll(`[data-hunk-ctx="${h.dataset.hunkId}"].diff-ctx`)
            .forEach(s => s.classList.add('diff-ctx-hidden'));
        h.classList.add('diff-hunk-ctx-collapsed');
      });
      if (snap.ctxCollapseActive[bi]) {
        const colBtn = block.querySelector('.diff-ctx-collapse-all');
        if (colBtn) colBtn.classList.add('active');
      }
    });
    ref.current.querySelectorAll('.code-copy').forEach(btn => {
      btn.onclick = () => {
        const codeEl = btn.closest('.code-block').querySelector('code');
        // Use data-raw when present (plain code blocks with line numbers) so
        // the copy payload doesn't include the line-number gutter text.
        const code = codeEl.dataset.raw !== undefined ? codeEl.dataset.raw : codeEl.textContent;
        navigator.clipboard.writeText(code).then(() => {
          btn.querySelector('.copy-icon').style.display = 'none';
          btn.querySelector('.check-icon').style.display = '';
          btn.querySelector('.copy-label').textContent = 'Copied';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.querySelector('.copy-icon').style.display = '';
            btn.querySelector('.check-icon').style.display = 'none';
            btn.querySelector('.copy-label').textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        }).catch(() => {});
      };
    });
    ref.current.querySelectorAll('.tool-toggle').forEach(btn => {
      btn.onclick = () => {
        const section = btn.closest('.tool-section');
        const body = section?.querySelector('.tool-body');
        const chevron = btn.querySelector('.tool-chevron');
        const collapsed = section.classList.toggle('collapsed');
        if (body) body.hidden = collapsed;
        if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };
    });

    // Compact IO block — expand: hide .tool-io-preview, show .tool-io-full
    ref.current.querySelectorAll('.tool-io-more-btn').forEach(btn => {
      btn.onclick = () => {
        const previewDiv = btn.closest('.tool-io-preview');
        const fullDiv    = previewDiv?.nextElementSibling; // .tool-io-full
        if (!previewDiv || !fullDiv) return;
        previewDiv.hidden = true;
        fullDiv.hidden    = false;
      };
    });
    // Compact IO block — collapse: hide .tool-io-full, show .tool-io-preview
    ref.current.querySelectorAll('.tool-io-collapse-btn').forEach(btn => {
      btn.onclick = () => {
        const fullDiv    = btn.closest('.tool-io-full');
        const previewDiv = fullDiv?.previousElementSibling; // .tool-io-preview
        if (!fullDiv || !previewDiv) return;
        fullDiv.hidden    = true;
        previewDiv.hidden = false;
      };
    });
    ref.current.querySelectorAll('.diff-summary-chip').forEach(chip => {
      chip.onclick = (e) => {
        e.preventDefault();
        const targetId = chip.dataset.target;
        const target = targetId && ref.current.querySelector(`#${CSS.escape(targetId)}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          // Mark clicked chip active immediately
          ref.current.querySelectorAll('.diff-summary-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
        }
      };
    });

    // Always default to unified diff view — split is available via toggle button

    ref.current.querySelectorAll('.diff-split-toggle').forEach(btn => {
      btn.onclick = () => {
        const block = btn.closest('.diff-block');
        if (!block) return;
        const pre = block.querySelector(':scope > pre');
        const split = block.querySelector('.diff-split');
        const isSplit = block.dataset.diffMode === 'split';
        const nowSplit = !isSplit;
        block.dataset.diffMode = nowSplit ? 'split' : 'unified';
        btn.classList.toggle('active', nowSplit);
        btn.title = nowSplit ? 'Toggle unified view' : 'Toggle side-by-side view';
        // Toggle is per-block only, no persistence
      };
    });
    ref.current.querySelectorAll('.diff-filepath[data-copy-path]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const path = btn.dataset.copyPath;
        navigator.clipboard.writeText(path).then(() => {
          const original = btn.textContent;
          btn.textContent = 'Copied!';
          btn.classList.add('diff-filepath-copied');
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('diff-filepath-copied');
          }, 1500);
        }).catch(() => {});
      };
    });
    ref.current.querySelectorAll('.code-expand-toggle').forEach(btn => {
      btn.onclick = () => {
        const block = btn.closest('.code-block');
        if (!block) return;
        const expanded = block.classList.toggle('code-expanded');
        btn.textContent = expanded ? 'Collapse' : 'Expand';
        btn.title = expanded ? 'Collapse block' : 'Expand block';
        if (!expanded) {
          // Scroll the top of the block into view when collapsing
          block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      };
    });
    ref.current.querySelectorAll('.code-wrap-toggle').forEach(btn => {
      btn.onclick = () => {
        const wrapped = localStorage.getItem('codeblock_wrap_pref') !== '1';
        localStorage.setItem('codeblock_wrap_pref', wrapped ? '1' : '0');
        // Sync all code blocks and their wrap buttons in this message
        ref.current.querySelectorAll('.code-block').forEach(block => {
          block.classList.toggle('code-wrap', wrapped);
          const tb = block.querySelector('.code-wrap-toggle');
          if (tb) {
            tb.textContent = wrapped ? 'No Wrap' : 'Wrap';
            tb.title = wrapped ? 'Disable word wrap' : 'Enable word wrap';
            tb.classList.toggle('active', wrapped);
          }
        });
      };
    });
    // A11-12: In-block search
    ref.current.querySelectorAll('.code-search-btn').forEach(btn => {
      btn.onclick = () => {
        const block = btn.closest('.code-block');
        if (!block) return;
        const bar = block.querySelector('.code-search-bar');
        const input = block.querySelector('.code-search-input');
        if (!bar) return;
        const isOpen = !bar.hidden;
        if (isOpen) {
          _codeSearchClear(block);
          bar.hidden = true;
          btn.classList.remove('active');
        } else {
          bar.hidden = false;
          btn.classList.add('active');
          input && input.focus();
        }
      };
    });

    ref.current.querySelectorAll('.code-search-input').forEach(input => {
      input.oninput = () => _codeSearchRun(input.closest('.code-block'));
      input.onkeydown = (e) => {
        const block = input.closest('.code-block');
        if (e.key === 'Enter') { e.shiftKey ? _codeSearchNav(block, -1) : _codeSearchNav(block, 1); e.preventDefault(); }
        if (e.key === 'Escape') { _codeSearchClear(block); block.querySelector('.code-search-bar').hidden = true; block.querySelector('.code-search-btn').classList.remove('active'); }
      };
    });

    ref.current.querySelectorAll('.code-search-next').forEach(btn => {
      btn.onclick = () => _codeSearchNav(btn.closest('.code-block'), 1);
    });
    ref.current.querySelectorAll('.code-search-prev').forEach(btn => {
      btn.onclick = () => _codeSearchNav(btn.closest('.code-block'), -1);
    });
    ref.current.querySelectorAll('.code-search-close').forEach(btn => {
      btn.onclick = () => {
        const block = btn.closest('.code-block');
        _codeSearchClear(block);
        block.querySelector('.code-search-bar').hidden = true;
        block.querySelector('.code-search-btn').classList.remove('active');
      };
    });

    // A11-07: Collapsible diff context hunks
    // Click on a hunk header (@@) to toggle that hunk's context lines
    ref.current.querySelectorAll('.diff-hunk-btn').forEach(hunkSpan => {
      hunkSpan.onclick = (e) => {
        e.stopPropagation();
        const id = hunkSpan.dataset.hunkId;
        const code = hunkSpan.closest('code');
        if (!code) return;
        const ctxSpans = code.querySelectorAll(`[data-hunk-ctx="${id}"].diff-ctx`);
        // Determine current state from first ctx span
        const collapsed = ctxSpans.length > 0 && ctxSpans[0].classList.contains('diff-ctx-hidden');
        ctxSpans.forEach(s => s.classList.toggle('diff-ctx-hidden', !collapsed));
        hunkSpan.classList.toggle('diff-hunk-ctx-collapsed', !collapsed);
      };
      hunkSpan.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hunkSpan.click(); } };
    });
    // Click "Context" button to collapse/expand all context lines in a diff block
    ref.current.querySelectorAll('.diff-ctx-collapse-all').forEach(btn => {
      btn.onclick = () => {
        const block = btn.closest('.diff-block, .tool-diff-block');
        if (!block) return;
        const code = block.querySelector('code');
        if (!code) return;
        const ctxSpans = code.querySelectorAll('.diff-ctx');
        const anyVisible = Array.from(ctxSpans).some(s => !s.classList.contains('diff-ctx-hidden'));
        const nowCollapsed = anyVisible;
        ctxSpans.forEach(s => s.classList.toggle('diff-ctx-hidden', nowCollapsed));
        code.querySelectorAll('.diff-hunk-btn').forEach(s => s.classList.toggle('diff-hunk-ctx-collapsed', nowCollapsed));
        btn.classList.toggle('active', nowCollapsed);
        btn.title = nowCollapsed ? 'Expand all context lines' : 'Collapse all context lines';
      };
    });
    ref.current.querySelectorAll('.tool-show-all').forEach(btn => {
      btn.onclick = () => {
        const body = btn.closest('.tool-body');
        const code = body?.querySelector('code');
        const section = btn.closest('.tool-section');
        if (!code || !section) return;
        const index = Number(section.dataset.toolIndex || '-1');
        const toolChunk = parseToolSections(content || '')[index];
        if (!toolChunk || toolChunk.type !== 'tool') return;
        code.textContent = toolChunk.content || '';
        btn.remove();
      };
    });

    // Restore code-block scroll positions (A11-11)
    if (snap.codeScroll.length) {
      ref.current.querySelectorAll('.code-block pre').forEach((pre, i) => {
        if (i < snap.codeScroll.length && snap.codeScroll[i] > 0) {
          pre.scrollTop = snap.codeScroll[i];
        }
      });
    }

    // A11-09: Highlight summary bar chip for the diff block currently in the viewport
    let cleanupObserver = null;
    const summaryBar = ref.current.querySelector('.diff-summary-bar');
    if (summaryBar && typeof IntersectionObserver !== 'undefined') {
      const diffBlocks = Array.from(ref.current.querySelectorAll('.diff-block[id]'));
      if (diffBlocks.length >= 2) {
        let scrollRoot = null;
        let el = ref.current.parentElement;
        while (el && el !== document.body) {
          const style = window.getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
              style.overflow === 'auto' || style.overflow === 'scroll') {
            scrollRoot = el; break;
          }
          el = el.parentElement;
        }
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const id = entry.target.id;
            summaryBar.querySelectorAll('.diff-summary-chip').forEach(chip => {
              chip.classList.toggle('active', chip.dataset.target === id);
            });
          });
        }, { root: scrollRoot, threshold: 0.1 });
        diffBlocks.forEach(block => observer.observe(block));
        cleanupObserver = () => observer.disconnect();
      }
    }
    return () => { if (cleanupObserver) cleanupObserver(); };
  }, [content]);
  return <div className={`message-body${monospace ? ' monospace-body' : ''}`} ref={ref} />;
}

// ESM export (consumed by entry.jsx bundle)
export { MarkdownContent };
