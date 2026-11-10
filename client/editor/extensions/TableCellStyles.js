import { Extension } from '@tiptap/core';
import { TableCell, TableHeader } from '@tiptap/extension-table';
import { CellSelection } from '@tiptap/pm/tables';

/**
 * Per-cell spreadsheet formatting for Tiptap tables.
 *
 * The style is stored in a `cellStyle` node attribute and rendered both as
 * inline CSS (so plain HTML clients can display it) and as
 * `data-cell-style="<json>"` (a lossless round-trip through our sanitiser,
 * which whitelists that attribute).
 */

const COLOR_RE = /^rgba?\([\d.,\s%]+\)$|^#([0-9a-f]{3,8})$/i;
const SIZE_RE = /^\d+(\.\d+)?(px|pt|em|rem|%)$/;
const FAMILY_RE = /^[\w\s,'"\-]+$/;
const BORDER_RE = /^[\d.]+\s*(px|pt)\s+(solid|dashed|dotted)\s+(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]+)$/i;

const color = (value) => (COLOR_RE.test(String(value || '').trim()) ? String(value).trim() : '');
const border = (value) => (BORDER_RE.test(String(value || '').trim()) ? String(value).trim() : '');

/** Whitelist-clones a cell style object; unknown keys are dropped. */
export function normalizeCellStyle(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  if (src.bold === true) out.bold = true;
  if (src.italic === true) out.italic = true;
  if (src.underline === true) out.underline = true;
  if (color(src.color)) out.color = color(src.color);
  if (color(src.background)) out.background = color(src.background);
  if (['left', 'center', 'right', 'justify'].includes(src.align)) out.align = src.align;
  if (['top', 'middle', 'bottom'].includes(src.valign)) out.valign = src.valign;
  if (SIZE_RE.test(String(src.fontSize || ''))) out.fontSize = String(src.fontSize);
  if (FAMILY_RE.test(String(src.fontFamily || ''))) out.fontFamily = String(src.fontFamily);
  if (border(src.border)) out.border = border(src.border);
  return out;
}

export const hasCellStyle = (style) => Object.keys(normalizeCellStyle(style)).length > 0;

/** cellStyle -> CSS declarations string. */
export function cellStyleToCss(style = {}) {
  const css = [];
  if (style.bold) css.push('font-weight: 700');
  if (style.italic) css.push('font-style: italic');
  if (style.underline) css.push('text-decoration: underline');
  if (style.color) css.push(`color: ${style.color}`);
  if (style.background) css.push(`background-color: ${style.background}`);
  if (style.align) css.push(`text-align: ${style.align}`);
  if (style.valign) css.push(`vertical-align: ${style.valign}`);
  if (style.fontSize) css.push(`font-size: ${style.fontSize}`);
  if (style.fontFamily) css.push(`font-family: ${style.fontFamily}`);
  if (style.border) css.push(`border: ${style.border}`);
  return css.join('; ');
}

/** Reads a DOM cell element (ours, or one copied out of Excel/Sheets). */
export function cellStyleFromElement(el) {
  const data = el.getAttribute?.('data-cell-style');
  if (data) {
    try {
      return normalizeCellStyle(JSON.parse(data));
    } catch {
      /* fall through to inline styles */
    }
  }
  const css = el.style || {};
  const out = {};
  const weight = String(css.fontWeight || '').toLowerCase();
  if (weight === 'bold' || Number(weight) >= 600) out.bold = true;
  const decoration = String(css.textDecoration || css.textDecorationLine || '');
  if (decoration.includes('underline') || /underline/.test(el.innerHTML || '')) out.underline = true;
  if (String(css.fontStyle).toLowerCase() === 'italic') out.italic = true;
  if (css.color) out.color = css.color;
  const bg = css.backgroundColor;
  if (bg && bg !== 'transparent' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)) out.background = bg;
  const align = String(css.textAlign || el.getAttribute?.('align') || '').toLowerCase();
  if (['left', 'center', 'right', 'justify'].includes(align)) out.align = align;
  const b = css.border || css.borderTop || css.borderBottom;
  if (b && b !== 'none') out.border = b;
  return normalizeCellStyle(out);
}

/* ------------------------------------------------------- tiptap extensions */

const cellStyleAttribute = {
  cellStyle: {
    default: null,
    parseHTML: (element) => {
      const style = cellStyleFromElement(element);
      return hasCellStyle(style) ? style : null;
    },
    renderHTML: (attributes) => {
      const style = normalizeCellStyle(attributes.cellStyle || {});
      if (!hasCellStyle(style)) return {};
      const css = cellStyleToCss(style);
      return { 'data-cell-style': JSON.stringify(style), ...(css ? { style: css } : {}) };
    },
  },
};

export const StyledTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttribute };
  },
});

export const StyledTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttribute };
  },
});

/** Read a cell node's style (normalised). */
export function getCellStyle(node) {
  return normalizeCellStyle(node?.attrs?.cellStyle || {});
}

/** Locate the cell containing the cursor. */
export function findSelectedCell(editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'tableCell' || name === 'tableHeader') {
      return { node: $from.node(depth), pos: $from.before(depth) };
    }
  }
  return null;
}

/**
 * Merge a style patch into every selected cell (or the cursor's cell).
 * Passing `null`/`''` for a key removes that property.
 */
export function applyCellStyle(editor, patch) {
  const { state, view } = editor;
  const tr = state.tr;
  let applied = 0;

  const update = (node, pos) => {
    const current = getCellStyle(node);
    const next = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === '') delete next[key];
      else next[key] = value;
    }
    const normalized = normalizeCellStyle(next);
    if (JSON.stringify(normalized) === JSON.stringify(current)) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, cellStyle: hasCellStyle(normalized) ? normalized : null });
    applied += 1;
  };

  const selection = state.selection;
  if (selection instanceof CellSelection) {
    // Every cell touched by the dragged range, including the anchor cell.
    selection.forEachCell((node, pos) => update(node, pos));
  } else {
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      const name = node.type.name;
      if (name === 'tableCell' || name === 'tableHeader') update(node, pos);
    });
  }

  if (!applied) {
    const cell = findSelectedCell(editor);
    if (cell) update(cell.node, cell.pos);
  }
  if (applied) view.dispatch(tr);
  return applied > 0;
}

/** Keep the last used cell colours so the toolbar can reuse them. */
export const CellStyleState = Extension.create({
  name: 'cellStyleState',
  addStorage() {
    return { lastFill: '#fff3c4', lastText: '#111827', lastBorder: '1px solid #9aa4b2' };
  },
  addCommands() {
    return {
      setCellStyle:
        (patch) =>
        ({ editor }) =>
          applyCellStyle(editor, patch),
      rememberCellColor:
        (kind, value) =>
        ({ editor }) => {
          if (kind === 'fill') editor.storage.cellStyleState.lastFill = value;
          if (kind === 'text') editor.storage.cellStyleState.lastText = value;
          if (kind === 'border') editor.storage.cellStyleState.lastBorder = value;
          return true;
        },
    };
  },
});
