import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';

import { containsTable, normalizeSpreadsheetHtml, parseDelimitedText } from '../clipboard.js';
import { cellStyleFromElement, hasCellStyle } from './TableCellStyles.js';

/**
 * Excel / Google Sheets interoperability.
 *
 * 1. `text/html` pastes are repaired: Excel separates cells with *tab
 *    characters* inside `<td>` elements, which browsers collapse when parsing.
 * 2. Plain tab-separated text becomes a real table.
 * 3. Pasting while a cell range is selected fills those cells (and grows the
 *    table when needed) instead of nesting a table inside a cell.
 * 4. Copying a cell range writes TSV *and* HTML, so it pastes back into Excel.
 */

const META_KEY = 'spreadsheetPaste';
const isCellSelection = (selection) => selection instanceof CellSelection;

export const SpreadsheetPaste = Extension.create({
  name: 'spreadsheetPaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey(META_KEY),

        props: {
          handlePaste: (view, event) => {
            const clipboard = event.clipboardData;
            if (!clipboard) return false;

            const html = clipboard.getData('text/html') || '';
            const text = clipboard.getData('text/plain') || '';

            // 1. Excel-style fill of an existing cell range.
            if (isCellSelection(view.state.selection)) {
              const matrix = html && containsTable(html) ? parseMatrixFromHtml(normalizeSpreadsheetHtml(html)) : parseDelimitedText(text);
              if (matrix && matrix.length) {
                event.preventDefault();
                fillCellSelection(view, matrix);
                return true;
              }
            }

            // 2. Plain text containing tabs → build a table.
            if (!containsTable(html)) {
              if (!html) {
                const matrix = parseDelimitedText(text);
                if (matrix) {
                  event.preventDefault();
                  insertTableFromRows(view, matrix);
                  return true;
                }
              }
              return false;
            }

            // 3. Real HTML table (Excel, Sheets, web pages, our own copy).
            const repaired = normalizeSpreadsheetHtml(html);
            const existing = tableAroundSelection(view.state);
            event.preventDefault();
            if (existing) {
              // Like Excel: a multi-cell paste from the caret fills the cells
              // that follow it and grows the table when needed. A single cell
              // paste replaces the whole table (e.g. re-pasting a table you
              // copied from this chat).
              const matrix = parseMatrixFromHtml(repaired);
              if (matrix && (matrix.length > 1 || matrix[0]?.length > 1)) {
                fillFromCaret(view, matrix);
              } else {
                replaceTable(view, existing, repaired);
              }
            } else {
              const nodes = tableNodeFromHtml(view.state.schema, repaired);
              if (nodes) insertNode(view, nodes);
              else {
                const matrix = parseMatrixFromHtml(repaired);
                if (matrix) insertTableFromRows(view, matrix);
              }
            }
            return true;
          },

          handleCopy: (view, event) => {
            const { selection } = view.state;
            if (!isCellSelection(selection) || !event.clipboardData) return false;
            const matrix = matrixFromCells(view, selection);
            if (!matrix) return false;
            event.preventDefault();
            event.clipboardData.setData('text/plain', toTsv(matrix));
            event.clipboardData.setData('text/html', toTableHtml(matrix));
            return true;
          },
        },
      }),
    ];
  },
});

/* ------------------------------------------------------------- html → nodes */

function tableNodeFromHtml(schema, html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  const tableEl = container.querySelector('table');
  return tableEl ? parseTableElement(schema, tableEl) : null;
}

function parseTableElement(schema, tableEl) {
  const rows = [];
  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells = [];
    for (const td of [...tr.children]) {
      if (!/^(TD|TH)$/i.test(td.tagName)) continue;
      const type = /^TH$/i.test(td.tagName) ? schema.nodes.tableHeader : schema.nodes.tableCell;
      const style = cellStyleFromElement(td);
      const colwidth = readColwidth(td);
      const colspan = Number(td.getAttribute('colspan'));
      const rowspan = Number(td.getAttribute('rowspan'));
      const attrs = {};
      if (colspan > 1) attrs.colspan = colspan;
      if (rowspan > 1) attrs.rowspan = rowspan;
      if (hasCellStyle(style)) attrs.cellStyle = style;
      if (colwidth) attrs.colwidth = colwidth;
      if (style.align) attrs.align = style.align;
      cells.push(type.create(attrs, cellContent(schema, td)));
    }
    if (cells.length) rows.push(schema.nodes.tableRow.create(null, cells));
  }
  if (!rows.length) return null;
  return schema.nodes.table.create(null, rows);
}

function readColwidth(td) {
  const data = td.getAttribute('data-colwidth');
  if (data) {
    const widths = data.split(',').map(Number).filter(Boolean);
    if (widths.length) return widths;
  }
  const raw = td.getAttribute('width') || td.style?.width || '';
  const match = /^(\d+)(px)?$/.exec(String(raw));
  return match ? [Number(match[1])] : null;
}

/** Turns a DOM cell into paragraph blocks, keeping inline marks (bold, links…). */
function cellContent(schema, td) {
  const blocks = [];
  let inline = [];

  const flush = () => {
    if (!inline.length) return;
    blocks.push(schema.nodes.paragraph.create(null, Fragment.from(inline)));
    inline = [];
  };

  const walk = (element, marks) => {
    for (const child of [...element.childNodes]) {
      if (child.nodeType === 3) {
        const text = child.textContent.replace(/\u00a0/g, ' ');
        if (!text) continue;
        const resolved = marks.map((name) => schema.marks[name]).filter(Boolean).map((mark) => mark.create());
        inline.push(schema.text(text, resolved));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        inline.push(schema.nodes.hardBreak.create());
        continue;
      }
      if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        flush();
        const before = blocks.length;
        walk(child, marks);
        flush();
        if (blocks.length === before) blocks.push(schema.nodes.paragraph.create());
        continue;
      }
      const next = [...marks];
      if (tag === 'b' || tag === 'strong') next.push('bold');
      if (tag === 'i' || tag === 'em') next.push('italic');
      if (tag === 'u') next.push('underline');
      if (tag === 's' || tag === 'strike' || tag === 'del') next.push('strike');
      if (tag === 'a' && child.getAttribute('href')) {
        const href = child.getAttribute('href');
        const text = child.textContent;
        if (text) inline.push(schema.text(text, [...next.map((n) => schema.marks[n]).filter(Boolean).map((m) => m.create()), schema.marks.link.create({ href })]));
        continue;
      }
      walk(child, next);
    }
  };

  walk(td, []);
  flush();
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create());
  return Fragment.from(blocks);
}

/* ---------------------------------------------------------------- utilities */

function tableAroundSelection(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return { node, pos: $from.before(depth) };
  }
  return null;
}

/** Replaces an existing table node in place. */
function replaceTable(view, { node, pos }, html) {
  const newTable = tableNodeFromHtml(view.state.schema, html);
  if (!newTable) return;
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, newTable).scrollIntoView());
}

/**
 * Inserts a block node and keeps a paragraph after it (so typing continues).
 * An empty paragraph is replaced outright; otherwise the table is inserted at
 * the selection so surrounding text is not destroyed.
 */
function insertNode(view, node) {
  const { state } = view;
  const { from, to, empty } = state.selection;
  const insertAt = findBlockBoundary(state, from, to);
  let tr = state.tr.replaceWith(insertAt.from, insertAt.to, node);
  const after = insertAt.from + node.nodeSize;
  const $after = tr.doc.resolve(after);
  if (!$after.nodeAfter) {
    tr = tr.insert(after, state.schema.nodes.paragraph.create());
  }
  const $cursor = tr.doc.resolve(Math.min(after + 1, tr.doc.content.size));
  tr.setSelection(TextSelection.near($cursor, empty ? 1 : -1)).scrollIntoView();
  view.dispatch(tr);
}

/** Replaces an empty paragraph at the cursor; otherwise inserts at the cursor. */
function findBlockBoundary(state, from, to) {
  const { $from, empty } = state.selection;
  const isEmptyParagraph = $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
  if (empty && isEmptyParagraph) {
    return { from: $from.before($from.depth), to: $from.after($from.depth) };
  }
  return { from, to };
}

/** Position and cell offset of the caret inside a table (null when outside). */
export function caretInTable(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec?.tableRole;
    if (role === 'cell' || role === 'header_cell') {
      const table = $from.node(depth - 2);
      const tablePos = $from.before(depth - 2);
      // TableMap offsets are relative to the table's *content* start.
      const tableStart = tablePos + 1;
      const map = TableMap.get(table);
      const rect = map.findCell($from.before(depth) - tableStart);
      return { table, tablePos, tableStart, row: rect.top, col: rect.left, map };
    }
  }
  return null;
}

/** Fills cells starting at the caret; grows the table (to the right/down) if needed. */
export function fillFromCaret(view, matrix) {
  const anchor = caretInTable(view.state);
  if (!anchor) return false;
  const { tableStart, row, col } = anchor;

  // Grow to the right / bottom before selecting, so the matrix always fits.
  growTableAt(view, anchor, matrix);
  const fresh = caretInTable(view.state);
  if (!fresh) return false;
  const startPos = fresh.tableStart + fresh.map.map[fresh.row * fresh.map.width + fresh.col];
  const endRow = Math.min(fresh.row + matrix.length - 1, fresh.map.height - 1);
  const endCol = Math.min(fresh.col + Math.max(...matrix.map((r) => r.length)) - 1, fresh.map.width - 1);
  const endPos = fresh.tableStart + fresh.map.map[endRow * fresh.map.width + endCol];
  const selection = CellSelection.create(view.state.doc, startPos, endPos);
  view.dispatch(view.state.tr.setSelection(selection));
  fillCellSelection(view, matrix);
  return true;
}

/** Adds rows/columns below/right of the given cell until `matrix` fits. */
function growTableAt(view, anchor, matrix) {
  const needRows = matrix.length;
  const needCols = Math.max(...matrix.map((r) => r.length));
  for (let guard = 0; guard < 80; guard += 1) {
    const current = caretInTable(view.state);
    if (!current) return;
    const missingRows = current.row + needRows - current.map.height;
    const missingCols = current.col + needCols - current.map.width;
    if (missingRows <= 0 && missingCols <= 0) return;
    const { state } = view;
    if (missingRows > 0) {
      const cells = [];
      for (let i = 0; i < current.map.width; i += 1) cells.push(state.schema.nodes.tableCell.createAndFill());
      view.dispatch(state.tr.insert(current.tableStart + current.table.nodeSize - 2, state.schema.nodes.tableRow.create(null, cells)));
    } else {
      const targets = [];
      for (let row = 0; row < current.map.height; row += 1) {
        const pos = current.tableStart + current.map.map[row * current.map.width + current.map.width - 1];
        const cell = state.doc.nodeAt(pos);
        if (cell) targets.push(pos + cell.nodeSize);
      }
      let tr = state.tr;
      for (const insertAt of targets.sort((a, b) => b - a)) {
        tr = tr.insert(insertAt, state.schema.nodes.tableCell.createAndFill());
      }
      view.dispatch(tr);
    }
  }
}

/** Extracts a 2D matrix of cell text from HTML containing a table. */
export function parseMatrixFromHtml(html) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = [...tr.children].filter((el) => /^(TD|TH)$/i.test(el.tagName));
    if (!cells.length) continue;
    rows.push(cells.map((cell) => cell.innerText ?? cell.textContent ?? ''));
  }
  return rows.length ? rows : null;
}

/** Builds a table node from a plain matrix of strings. */
export function tableFromMatrix(schema, rows) {
  const width = Math.max(...rows.map((r) => r.length));
  if (!width) return null;
  const tableRows = rows.map((row) => {
    const cells = [];
    for (let i = 0; i < width; i += 1) {
      const value = String(row[i] ?? '').replace(/\u00a0/g, ' ');
      const paragraphs = value
        .split(/\n/)
        .map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined));
      cells.push(schema.nodes.tableCell.create(null, paragraphs.length ? paragraphs : undefined));
    }
    return schema.nodes.tableRow.create(null, cells);
  });
  return schema.nodes.table.create(null, tableRows);
}

function insertTableFromRows(view, rows) {
  const tableNode = tableFromMatrix(view.state.schema, rows);
  if (tableNode) insertNode(view, tableNode);
}

/* -------------------------------------------------------- cell range filling */

/** Fills a cell selection with a matrix, growing the table when needed. */
export function fillCellSelection(view, matrix) {
  growTableForMatrix(view, matrix);
  const { state } = view;
  const rect = selectedRect(state);
  const { map, tableStart } = rect;

  // Collect first, then apply back-to-front: replacing a cell's content changes
  // the size of everything after it, which would invalidate later positions.
  const updates = [];
  for (let r = 0; r < matrix.length; r += 1) {
    const row = rect.top + r;
    if (row >= map.height) break;
    for (let c = 0; c < matrix[r].length; c += 1) {
      const col = rect.left + c;
      if (col >= map.width) break;
      const pos = tableStart + map.map[row * map.width + col];
      const cell = state.doc.nodeAt(pos);
      if (!cell || !/table(Header|Cell)$/.test(cell.type.name)) continue;
      const value = String(matrix[r][c] ?? '').replace(/\u00a0/g, ' ');
      const paragraphs = value
        .split(/\n/)
        .map((line) => state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : undefined));
      updates.push({ pos, cell, content: Fragment.from(paragraphs) });
    }
  }

  let tr = state.tr;
  for (const update of updates.sort((a, b) => b.pos - a.pos)) {
    tr = tr.replaceWith(update.pos, update.pos + update.cell.nodeSize, update.cell.type.create(update.cell.attrs, update.content));
  }
  view.dispatch(tr);
}

/** Adds rows/columns so the current cell selection can hold the matrix. */
function growTableForMatrix(view, matrix) {
  const neededCols = Math.max(...matrix.map((r) => r.length));
  for (let guard = 0; guard < 80; guard += 1) {
    const rect = selectedRect(view.state);
    const missingRows = matrix.length - (rect.map.height - rect.top);
    const missingCols = neededCols - (rect.map.width - rect.left);
    if (missingRows <= 0 && missingCols <= 0) return;

    if (missingRows > 0) {
      const { state } = view;
      // `tableStart` is the table's *content* start; the closing token (where a
      // new trailing row must be inserted) is one position earlier.
      const at = rect.tableStart + rect.table.nodeSize - 2;
      const cells = [];
      for (let i = 0; i < rect.map.width; i += 1) cells.push(state.schema.nodes.tableCell.createAndFill());
      const rowNode = state.schema.nodes.tableRow.create(null, cells);
      view.dispatch(state.tr.insert(at, rowNode));
    } else {
      const { state } = view;
      const targets = [];
      for (let row = 0; row < rect.map.height; row += 1) {
        const lastIndex = row * rect.map.width + rect.map.width - 1;
        const pos = rect.tableStart + rect.map.map[lastIndex];
        const cell = state.doc.nodeAt(pos);
        if (cell) targets.push(pos + cell.nodeSize);
      }
      let tr = state.tr;
      for (const insertAt of targets.sort((a, b) => b - a)) {
        tr = tr.insert(insertAt, state.schema.nodes.tableCell.createAndFill());
      }
      view.dispatch(tr);
    }
  }
}

/* ------------------------------------------------------------ copy helpers */

/** Reads a cell selection into a matrix of plain text. */
export function matrixFromCells(view, selection) {
  try {
    const rect = selectedRect(view.state);
    const { map, tableStart } = rect;
    const rows = [];
    for (let row = rect.top; row < rect.bottom; row += 1) {
      const cells = [];
      for (let col = rect.left; col < rect.right; col += 1) {
        const cell = view.state.doc.nodeAt(tableStart + map.map[row * map.width + col]);
        cells.push(cell ? cell.textContent : '');
      }
      rows.push(cells);
    }
    return rows;
  } catch {
    return null;
  }
}

export function toTsv(matrix) {
  return matrix
    .map((row) => row.map((cell) => String(cell).replace(/\t/g, ' ').replace(/\n/g, ' / ')).join('\t'))
    .join('\n');
}

export function toTableHtml(matrix) {
  const body = matrix
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="white-space:pre-wrap;border:1px solid #d0d7de;padding:4px 8px">${String(cell)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>')}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

/** Inserts a matrix (used by the "Insert table" dialog and tests). */
export function insertMatrix(editor, rows) {
  const tableNode = tableFromMatrix(editor.schema, rows);
  if (!tableNode) return false;
  const { state } = editor.view;
  const { from, to } = state.selection;
  const boundary = findBlockBoundary(state, from, to);
  let tr = state.tr.replaceWith(boundary.from, boundary.to, tableNode);
  const after = boundary.from + tableNode.nodeSize;
  if (!tr.doc.resolve(after).nodeAfter) tr = tr.insert(after, state.schema.nodes.paragraph.create());
  editor.view.dispatch(tr);
  focusFirstCell(editor, boundary.from);
  return true;
}

/**
 * Puts the caret inside the first cell of the table starting at `tablePos`, so
 * the table/cell toolbars light up and typing edits a cell right away.
 */
export function focusFirstCell(editor, tablePos) {
  const doc = editor.state.doc;
  try {
    const $inside = doc.resolve(tablePos + 1);
    const row = $inside.nodeAfter;
    const cell = row?.firstChild;
    const cellStart = tablePos + 2;
    const target = cell ? cellStart + 2 : tablePos + 2;
    const selection = TextSelection.near(doc.resolve(Math.min(target, doc.content.size)), 1);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
  } catch {
    editor.chain().focus().run();
  }
}
