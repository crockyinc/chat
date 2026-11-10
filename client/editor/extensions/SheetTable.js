import { Table, updateColumns } from '@tiptap/extension-table';
import { CellSelection, TableMap, findTable } from '@tiptap/pm/tables';

/**
 * Spreadsheet feel for Tiptap tables.
 *
 * While a table is *editable* it gets a sticky column-letter header (A, B, C…)
 * that stays aligned with the grid and stays put when a wide table scrolls
 * horizontally. Clicking a letter selects the whole column, exactly like Excel.
 *
 * The header bar is decoration outside `contentDOM`, so it never ends up in the
 * stored document; read-only messages render a plain table.
 */

const LABELS = (() => {
  const out = [];
  for (let i = 0; i < 200; i += 1) {
    let n = i;
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    out.push(label);
  }
  return out;
})();

export const columnLabel = (index) => LABELS[index] || String(index + 1);

export class SheetTableView {
  constructor(node, cellMinWidth, view, HTMLAttributes = {}, getPos = () => 0) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.cellMinWidth = cellMinWidth;

    this.dom = document.createElement('div');
    this.dom.className = 'tableWrapper sheet-wrapper';

    // --- sticky column header ------------------------------------------------
    this.headWrap = document.createElement('div');
    this.headWrap.className = 'sheet-headwrap';
    this.headWrap.contentEditable = 'false';
    this.headTable = document.createElement('table');
    this.headTable.className = 'sheet-headtable';
    this.headColgroup = this.headTable.appendChild(document.createElement('colgroup'));
    const tbody = this.headTable.appendChild(document.createElement('tbody'));
    this.headRow = tbody.insertRow();
    this.headWrap.appendChild(this.headTable);
    this.dom.appendChild(this.headWrap);

    // --- the real table -----------------------------------------------------
    this.table = document.createElement('table');
    for (const [key, value] of Object.entries(HTMLAttributes || {})) {
      if (value === undefined || value === null) continue;
      if (key === 'style') this.table.style.cssText = String(value);
      else this.table.setAttribute(key, String(value));
    }
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    updateColumns(node, this.colgroup, this.table, cellMinWidth);
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
    this.dom.appendChild(this.table);

    this.onHeadMouseDown = this.onHeadMouseDown.bind(this);
    this.headWrap.addEventListener('mousedown', this.onHeadMouseDown);
    this.renderHeader();

    // Column dragging rewrites the <col> widths directly, so mirror those
    // changes into the header as they happen.
    if (typeof MutationObserver !== 'undefined') {
      this.widthObserver = new MutationObserver(() => this.scheduleSync());
      this.widthObserver.observe(this.colgroup, { attributes: true, subtree: true, attributeFilter: ['style'] });
    }
  }

  /* ------------------------------------------------------------- rendering */

  widths() {
    const { node } = this;
    const map = TableMap.get(node);
    const firstRow = node.firstChild;
    if (!firstRow) return [];
    const widths = [];
    for (let col = 0; col < map.width; col += 1) {
      const cellPos = map.map[col];
      const cell = node.nodeAt(cellPos);
      const width = cell?.attrs?.colwidth?.[0];
      widths.push(width || this.cellMinWidth);
    }
    return widths;
  }

  renderHeader() {
    const widths = this.widths();
    this.headColgroup.textContent = '';
    const gutter = document.createElement('col');
    gutter.style.width = '34px';
    this.headColgroup.appendChild(gutter);
    for (const width of widths) {
      const col = document.createElement('col');
      col.style.width = `${width}px`;
      this.headColgroup.appendChild(col);
    }

    this.headRow.textContent = '';
    const corner = document.createElement('th');
    corner.className = 'sheet-corner';
    corner.dataset.action = 'all';
    corner.title = 'Select whole table';
    this.headRow.appendChild(corner);

    widths.forEach((_, index) => {
      const th = document.createElement('th');
      th.className = 'sheet-head';
      th.dataset.action = 'col';
      th.dataset.col = String(index);
      th.textContent = columnLabel(index);
      th.title = `Select column ${columnLabel(index)}`;
      this.headRow.appendChild(th);
    });
  }

  scheduleSync() {
    if (this.syncQueued) return;
    this.syncQueued = true;
    requestAnimationFrame(() => {
      this.syncQueued = false;
      this.syncWidths();
    });
  }

  /** Keep the header in step with widths changed by dragging a column edge. */
  syncWidths() {
    const headCols = this.headColgroup.children;
    const cols = this.colgroup.children;
    for (let i = 0; i < cols.length; i += 1) {
      const target = headCols[i + 1];
      if (!target) continue;
      const width = cols[i].style.width;
      if (width) {
        target.style.width = width;
        target.style.minWidth = width;
      }
    }
  }

  /* ---------------------------------------------------------------- events */

  onHeadMouseDown(event) {
    const th = event.target.closest('th');
    if (!th || !this.view) return;
    event.preventDefault();
    event.stopPropagation();

    const tablePos = this.getPos();
    if (typeof tablePos !== 'number' || tablePos < 0) return;
    const { state } = this.view;
    const table = state.doc.nodeAt(tablePos);
    if (!table) return;
    const map = TableMap.get(table);
    const start = tablePos + 1;
    // `map.map` holds cell offsets relative to the table's content start, and
    // CellSelection wants the position *between* the row and its cell, which is
    // exactly `tableStart + offset`.
    const cellPos = (row, col) => start + map.map[row * map.width + col];

    try {
      if (th.dataset.action === 'all') {
        const selection = CellSelection.create(
          state.doc,
          cellPos(0, 0),
          cellPos(map.height - 1, map.width - 1),
        );
        this.view.dispatch(state.tr.setSelection(selection));
      } else {
        const col = Number(th.dataset.col);
        const $anchor = state.doc.resolve(cellPos(0, col));
        const $head = state.doc.resolve(cellPos(map.height - 1, col));
        this.view.dispatch(state.tr.setSelection(CellSelection.colSelection($anchor, $head)));
      }
      this.view.focus();
    } catch {
      /* malformed table (e.g. mid-edit) — ignore */
    }
  }

  /* -------------------------------------------------------------- nodeview */

  update(node) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    updateColumns(node, this.colgroup, this.table, this.cellMinWidth);
    this.renderHeader();
    return true;
  }

  ignoreMutation(mutation) {
    if (this.headWrap.contains(mutation.target)) return true;
    if (mutation.type === 'attributes' && (mutation.target === this.table || this.table.contains(mutation.target))) {
      return !this.contentDOM.contains(mutation.target);
    }
    return false;
  }

  stopEvent(event) {
    return this.headWrap.contains(event.target);
  }

  destroy() {
    this.headWrap.removeEventListener('mousedown', this.onHeadMouseDown);
    this.widthObserver?.disconnect();
  }
}

/** Table extension that installs the spreadsheet header while editing. */
export const SheetTable = Table.extend({
  addNodeView() {
    const cellMinWidth = this.options.cellMinWidth;
    return ({ node, view, HTMLAttributes, getPos }) => {
      if (!this.editor.isEditable) return null;
      return new SheetTableView(node, cellMinWidth, view, HTMLAttributes, getPos);
    };
  },
});

/** True when the cursor/selection is inside a table (or the table is selected). */
export function inTable(editor) {
  const { selection } = editor.state;
  if (selection.node?.type?.name === 'table') return true;
  return Boolean(findTable(selection.$from));
}
