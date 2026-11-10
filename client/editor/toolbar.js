import { icon } from '../ui/icons.js';
import { openLinkDialog } from './hyperlink.js';
import { applyCellStyle, findSelectedCell, CellStyleState } from './extensions/TableCellStyles.js';
import { inTable } from './extensions/SheetTable.js';
import { insertMatrix, matrixFromCells, toTsv } from './extensions/SpreadsheetPaste.js';
import { CellSelection } from '@tiptap/pm/tables';

/**
 * Declarative toolbar. One definition drives both the compact composer toolbar
 * and the full editor toolbar (which simply asks for more groups).
 */

export const FONT_SIZES = ['11px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '28px', '32px', '40px'];
export const TEXT_COLORS = [
  '#050505', '#65676b', '#8b8d91', '#ffffff', '#e41e3f', '#f7b928', '#31a24c', '#0a84ff', '#8b5cf6', '#ec4899',
  '#0064e0', '#00a8a8', '#7a4b1c', '#1e293b', '#7f1d1d', '#065f46',
];
export const HIGHLIGHT_COLORS = [
  '#fff3c4', '#ffe08a', '#ffd0d0', '#d7f5dd', '#d6e9ff', '#e9dcff', '#ffe3f1', '#e8ecf0', '#c8f4f0', '#ffedd5',
];
export const TABLE_FILLS = [
  'transparent', '#ffffff', '#f0f2f5', '#fff3c4', '#ffe08a', '#ffd0d0', '#d7f5dd', '#d6e9ff', '#e9dcff', '#ffe3f1',
  '#0a84ff', '#31a24c', '#f1f5f9', '#1e293b',
];

const btn = (action, title, body, extra = '') =>
  `<button type="button" class="toolbar-btn ${extra}" data-action="${action}" title="${title}" aria-label="${title}" tabindex="-1">${body}</button>`;

const separator = '<span class="divider-v"></span>';

const headingMenu = () => `
  <select class="toolbar-btn !px-1 text-xs" data-select="heading" title="Paragraph style" tabindex="-1">
    <option value="p">Normal</option>
    <option value="h1">Title</option>
    <option value="h2">Heading</option>
    <option value="h3">Subheading</option>
  </select>`;

const fontMenu = () => `
  <select class="toolbar-btn !px-1 text-xs" data-select="fontSize" title="Font size" tabindex="-1">
    <option value="">Size</option>
    ${FONT_SIZES.map((size) => `<option value="${size}">${size.replace('px', '')}</option>`).join('')}
  </select>`;

const colorMenu = (id, title, colors, action, iconName) => `
  <span class="relative inline-flex" data-menu-wrap="${id}">
    <button type="button" class="toolbar-btn gap-0.5" data-action="${action}" title="${title}" aria-label="${title}" tabindex="-1">
      ${icon(iconName, { size: 15 })}<span class="h-1 w-1 rounded-full" data-color-dot="${id}"></span>
    </button>
    <button type="button" class="toolbar-btn !px-0.5 !min-w-0" data-menu-toggle="${id}" title="${title} colours" tabindex="-1">
      ${icon('chevronDown', { size: 11 })}
    </button>
    <div class="card absolute left-0 top-9 z-50 hidden w-[196px] p-2" data-menu="${id}">
      <div class="grid grid-cols-8 gap-1">
        ${colors
          .map(
            (color) =>
              `<button type="button" class="h-5 w-5 rounded border border-black/10" style="background:${
                color === 'transparent' ? 'repeating-linear-gradient(45deg,#eee 0 3px,#fff 3px 6px)' : color
              }" data-pick="${id}" data-value="${color}" title="${color}" tabindex="-1"></button>`,
          )
          .join('')}
      </div>
      <label class="mt-2 flex items-center gap-2 border-t pt-2 text-[11px] font-semibold muted" style="border-color:var(--border)">
        Custom
        <input type="color" class="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" data-custom="${id}" value="${
          id === 'highlight' ? '#fff3c4' : '#0a84ff'
        }" />
      </label>
    </div>
  </span>`;

/**
 * @param {'compact'|'full'} variant
 * @param {object} opts
 * @param {'document'|'cell'} opts.scope  which toolbar we are building
 */
export function toolbarMarkup(variant = 'compact', scope = 'document') {
  const isFull = variant === 'full';
  const parts = [];

  parts.push(btn('undo', 'Undo (Ctrl+Z)', icon('undo', { size: 15 })));
  parts.push(btn('redo', 'Redo (Ctrl+Shift+Z)', icon('redo', { size: 15 })));
  parts.push(separator);
  parts.push(headingMenu());
  parts.push(fontMenu());

  if (scope === 'document') {
    parts.push(separator);
    parts.push(btn('format-painter', 'Copy formatting (paint it onto another selection)', icon('formatPainter', { size: 15 })));
    parts.push(btn('bold', 'Bold (Ctrl+B)', icon('bold', { size: 15 })));
    parts.push(btn('italic', 'Italic (Ctrl+I)', icon('italic', { size: 15 })));
    parts.push(btn('underline', 'Underline (Ctrl+U)', icon('underline', { size: 15 })));
    if (isFull) parts.push(btn('strike', 'Strikethrough', icon('strike', { size: 15 })));
    parts.push(colorMenu('color', 'Text colour', TEXT_COLORS, 'apply-color', 'palette'));
    parts.push(colorMenu('highlight', 'Highlight', HIGHLIGHT_COLORS, 'apply-highlight', 'highlighter'));
    parts.push(separator);
    parts.push(btn('align-left', 'Align left', icon('alignLeft', { size: 15 })));
    if (isFull) {
      parts.push(btn('align-center', 'Align center', icon('alignCenter', { size: 15 })));
      parts.push(btn('align-right', 'Align right', icon('alignRight', { size: 15 })));
      parts.push(btn('align-justify', 'Justify', icon('alignJustify', { size: 15 })));
    }
    parts.push(separator);
    parts.push(btn('bullet-list', 'Bulleted list', icon('list', { size: 15 })));
    parts.push(btn('ordered-list', 'Numbered list', icon('listOrdered', { size: 15 })));
    if (isFull) {
      parts.push(btn('blockquote', 'Quote', icon('quote', { size: 15 })));
      parts.push(btn('hr', 'Divider', icon('hr', { size: 15 })));
      parts.push(btn('link', 'Link (Ctrl+K)', icon('link', { size: 15 })));
      parts.push(btn('table', 'Insert table', icon('table', { size: 15 })));
      parts.push(btn('clear-format', 'Clear formatting', icon('clearFormat', { size: 15 })));
    } else {
      parts.push(btn('table', 'Insert table', icon('table', { size: 15 })));
    }
  } else {
    // Cell formatting scope: everything here applies to the selected cells.
    parts.push(separator);
    parts.push(btn('cell-bold', 'Bold cell', icon('bold', { size: 15 })));
    parts.push(btn('cell-italic', 'Italic cell', icon('italic', { size: 15 })));
    parts.push(btn('cell-underline', 'Underline cell', icon('underline', { size: 15 })));
    parts.push(colorMenu('cell-text', 'Cell text colour', TEXT_COLORS, 'apply-cell-text', 'palette'));
    parts.push(colorMenu('cell-fill', 'Cell fill', TABLE_FILLS, 'apply-cell-fill', 'paint'));
    parts.push(separator);
    parts.push(btn('cell-align-left', 'Align left', icon('alignLeft', { size: 15 })));
    parts.push(btn('cell-align-center', 'Align center', icon('alignCenter', { size: 15 })));
    parts.push(btn('cell-align-right', 'Align right', icon('alignRight', { size: 15 })));
    parts.push(btn('cell-border', 'Toggle borders', icon('border', { size: 15 })));
    parts.push(btn('cell-painter', 'Copy this cell\'s formatting', icon('formatPainter', { size: 15 })));
    parts.push(btn('cell-clear', 'Clear cell formatting', icon('eraser', { size: 15 })));
  }
  return parts.join('');
}

/** Markup for the contextual table toolbar (rows/columns/merge). */
export function tableToolbarMarkup() {
  return [
    `<span class="px-1 text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-300">Table</span>`,
    btn('row-add-before', 'Insert row above', `${icon('plus', { size: 13 })}<span class="ml-1 text-[11px]">Row ↑</span>`),
    btn('row-add-after', 'Insert row below', `${icon('plus', { size: 13 })}<span class="ml-1 text-[11px]">Row ↓</span>`),
    btn('row-delete', 'Delete row', `${icon('minus', { size: 13 })}<span class="ml-1 text-[11px]">Row</span>`),
    `<span class="divider-v"></span>`,
    btn('col-add-before', 'Insert column left', `${icon('plus', { size: 13 })}<span class="ml-1 text-[11px]">Col ←</span>`),
    btn('col-add-after', 'Insert column right', `${icon('plus', { size: 13 })}<span class="ml-1 text-[11px]">Col →</span>`),
    btn('col-delete', 'Delete column', `${icon('minus', { size: 13 })}<span class="ml-1 text-[11px]">Col</span>`),
    `<span class="divider-v"></span>`,
    btn('merge', 'Merge selected cells', icon('merge', { size: 15 })),
    btn('split', 'Split cell', icon('split', { size: 15 })),
    btn('header-row', 'Toggle header row', `${icon('rows', { size: 15 })}`),
    btn('header-col', 'Toggle header column', `${icon('columns', { size: 15 })}`),
    btn('table-delete', 'Delete table', icon('trash', { size: 15 })),
  ].join('');
}

/**
 * Wires a toolbar element to an editor instance.
 * @returns {{refresh: () => void, destroy: () => void}}
 */
export function createToolbar({ root, editor, variant = 'compact', scope = 'document', onChange }) {
  if (!root) return { refresh() {}, destroy() {} };
  root.innerHTML = toolbarMarkup(variant, scope);

  const state = {
    color: '#0a84ff',
    highlight: '#fff3c4',
    cellText: '#111827',
    cellFill: '#fff3c4',
    /** Formatting captured by the "copy formatting" button. */
    painter: null,
  };

  /** What "copy formatting" remembers: text style + the cell style, if any. */
  function captureFormatting(ed, { cellOnly = false } = {}) {
    const cell = findSelectedCell(ed);
    const textStyle = ed.getAttributes('textStyle') || {};
    const marks = ed.state.selection.$from.marks().map((mark) => mark.type.name);
    const painter = {
      cellOnly: cellOnly || Boolean(cell),
      marks,
      textStyle: { color: textStyle.color || null, fontSize: textStyle.fontSize || null, fontFamily: textStyle.fontFamily || null },
      highlight: ed.getAttributes('highlight')?.color || null,
      paragraph: {
        textAlign: ed.getAttributes('paragraph')?.textAlign || null,
        heading: [1, 2, 3].find((level) => ed.isActive('heading', { level })) || null,
      },
      cellStyle: cell?.node?.attrs?.cellStyle || null,
      tablePos: cell?.pos ?? null,
    };
    state.painter = painter;
    return painter;
  }

  /** Applies captured formatting to the current selection / cell. */
  function applyFormatting(ed) {
    const painter = state.painter;
    if (!painter) return false;
    let chain = ed.chain().focus();

    if (painter.cellStyle && findSelectedCell(ed)) {
      applyCellStyle(ed, {
        bold: null, italic: null, underline: null, color: null, background: null,
        align: null, border: null, fontSize: null, fontFamily: null,
        ...painter.cellStyle,
      });
    }

    if (!painter.cellOnly) {
      chain = chain.unsetAllMarks();
      if (painter.marks.includes('bold')) chain = chain.setBold();
      if (painter.marks.includes('italic')) chain = chain.setItalic();
      if (painter.marks.includes('underline')) chain = chain.setUnderline();
      if (painter.marks.includes('strike')) chain = chain.setStrike();
      if (painter.textStyle.color) chain = chain.setColor(painter.textStyle.color);
      if (painter.textStyle.fontSize) chain = chain.setFontSize(painter.textStyle.fontSize);
      if (painter.textStyle.fontFamily) chain = chain.setFontFamily(painter.textStyle.fontFamily);
      if (painter.highlight) chain = chain.setHighlight({ color: painter.highlight });
      if (painter.paragraph.heading) chain = chain.setHeading({ level: painter.paragraph.heading });
      else chain = chain.setParagraph();
      if (painter.paragraph.textAlign) chain = chain.setTextAlign(painter.paragraph.textAlign);
    }
    chain.run();
    return true;
  }

  function painterButtonState(active) {
    root.querySelectorAll('[data-action$="painter"]').forEach((el) => el.classList.toggle('is-active', active));
  }

  const closeMenus = () => {
    root.querySelectorAll('[data-menu]').forEach((menu) => menu.classList.add('hidden'));
  };

  const run = (fn) => {
    fn?.(editor);
    onChange?.();
    refresh();
  };

  root.addEventListener('mousedown', (event) => {
    // Keep the selection in the editor when clicking toolbar buttons.
    if (event.target.closest('button')) event.preventDefault();
  });

  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-menu-toggle]');
    if (toggle) {
      const id = toggle.dataset.menuToggle;
      const menu = root.querySelector(`[data-menu="${id}"]`);
      const isOpen = !menu.classList.contains('hidden');
      closeMenus();
      if (!isOpen) menu.classList.remove('hidden');
      return;
    }

    const pick = event.target.closest('[data-pick]');
    if (pick) {
      const id = pick.dataset.pick;
      const value = pick.dataset.value;
      closeMenus();
      applyColor(id, value);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) {
      if (!event.target.closest('[data-menu]')) closeMenus();
      return;
    }
    closeMenus();
    handleAction(action);
  });

  root.addEventListener('change', (event) => {
    const select = event.target.closest('[data-select]');
    if (select) {
      if (select.dataset.select === 'heading') setHeading(select.value);
      if (select.dataset.select === 'fontSize') setFontSize(select.value);
    }
    const custom = event.target.closest('[data-custom]');
    if (custom) applyColor(custom.dataset.custom, custom.value);
  });

  let activeEditor = editor;

  function applyColor(id, value) {
    const ed = activeEditor;
    if (id === 'color') {
      state.color = value;
      ed.chain().focus().setColor(value).run();
    } else if (id === 'highlight') {
      state.highlight = value;
      if (value === 'transparent') ed.chain().focus().unsetHighlight().run();
      else ed.chain().focus().setHighlight({ color: value }).run();
    } else if (id === 'cell-text') {
      state.cellText = value;
      applyCellStyle(ed, { color: value === 'transparent' ? null : value });
    } else if (id === 'cell-fill') {
      state.cellFill = value;
      applyCellStyle(ed, { background: value === 'transparent' ? null : value });
    }
    refresh();
    onChange?.();
  }

  function setHeading(value) {
    const chain = activeEditor.chain().focus();
    if (value === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: Number(value.slice(1)) }).run();
    refresh();
  }

  function setFontSize(value) {
    if (!value) activeEditor.chain().focus().unsetFontSize().run();
    else activeEditor.chain().focus().setFontSize(value).run();
    refresh();
  }

  function toggleCell(patch) {
    const cell = findSelectedCell(activeEditor);
    if (!cell) return;
    const current = cell.node.attrs.cellStyle || {};
    applyCellStyle(activeEditor, { ...patch, ...(current[patch.key] ? { [patch.key]: null } : {}) });
  }

  function handleAction(action) {
    const chain = activeEditor.chain().focus();
    switch (action) {
      case 'undo': chain.undo().run(); break;
      case 'redo': chain.redo().run(); break;
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'underline': chain.toggleUnderline().run(); break;
      case 'strike': chain.toggleStrike().run(); break;
      case 'align-left': chain.setTextAlign('left').run(); break;
      case 'align-center': chain.setTextAlign('center').run(); break;
      case 'align-right': chain.setTextAlign('right').run(); break;
      case 'align-justify': chain.setTextAlign('justify').run(); break;
      case 'bullet-list': chain.toggleBulletList().run(); break;
      case 'ordered-list': chain.toggleOrderedList().run(); break;
      case 'blockquote': chain.toggleBlockquote().run(); break;
      case 'hr': chain.setHorizontalRule().run(); break;
      case 'link': openLinkDialog(activeEditor); break;
      case 'table': document.dispatchEvent(new CustomEvent('lm:open-table-dialog')); break;
      case 'format-painter': {
        const captured = captureFormatting(activeEditor);
        painterButtonState(true);
        const target = activeEditor.view.dom;
        // Next click inside the editor drops the formatting, then it lets go.
        const onMouseUp = () => {
          setTimeout(() => {
            applyFormatting(activeEditor);
            state.painter = null;
            painterButtonState(false);
            refresh();
          }, 0);
          target.removeEventListener('mouseup', onMouseUp, true);
        };
        target.addEventListener('mouseup', onMouseUp, true);
        void captured;
        break;
      }
      case 'cell-painter': {
        captureFormatting(activeEditor, { cellOnly: true });
        painterButtonState(true);
        toastOnce('Cell formatting copied — click the target cell(s)');
        const target = activeEditor.view.dom;
        const onMouseUp = () => {
          setTimeout(() => {
            applyFormatting(activeEditor);
            state.painter = null;
            painterButtonState(false);
            refresh();
          }, 0);
          target.removeEventListener('mouseup', onMouseUp, true);
        };
        target.addEventListener('mouseup', onMouseUp, true);
        break;
      }
      case 'clear-format': chain.unsetAllMarks().clearNodes().run(); break;

      // --- cell scope ---
      case 'cell-bold': applyCellStyle(activeEditor, { bold: toggle(activeEditor, 'bold') }); break;
      case 'cell-italic': applyCellStyle(activeEditor, { italic: toggle(activeEditor, 'italic') }); break;
      case 'cell-underline': applyCellStyle(activeEditor, { underline: toggle(activeEditor, 'underline') }); break;
      case 'cell-align-left': applyCellStyle(activeEditor, { align: 'left' }); break;
      case 'cell-align-center': applyCellStyle(activeEditor, { align: 'center' }); break;
      case 'cell-align-right': applyCellStyle(activeEditor, { align: 'right' }); break;
      case 'cell-border': applyCellStyle(activeEditor, { border: toggle(activeEditor, 'border') ? '1px solid #9aa4b2' : null }); break;
      case 'cell-clear':
        applyCellStyle(activeEditor, {
          bold: null, italic: null, underline: null, color: null, background: null,
          align: null, border: null, fontSize: null, fontFamily: null,
        });
        break;

      // --- table structure ---
      case 'row-add-before': chain.addRowBefore().run(); break;
      case 'row-add-after': chain.addRowAfter().run(); break;
      case 'row-delete': chain.deleteRow().run(); break;
      case 'col-add-before': chain.addColumnBefore().run(); break;
      case 'col-add-after': chain.addColumnAfter().run(); break;
      case 'col-delete': chain.deleteColumn().run(); break;
      case 'merge': chain.mergeCells().run(); break;
      case 'split': chain.splitCell().run(); break;
      case 'header-row': chain.toggleHeaderRow().run(); break;
      case 'header-col': chain.toggleHeaderColumn().run(); break;
      case 'table-delete': chain.deleteTable().run(); break;
      case 'cell-copy': copyCells(); break;
      default: break;
    }
    refresh();
    onChange?.();
  }

  function copyCells() {
    const ed = activeEditor;
    if (!(ed.state.selection instanceof CellSelection)) return false;
    const matrix = matrixFromCells(ed.view, ed.state.selection);
    if (!matrix) return false;
    const tsv = toTsv(matrix);
    navigator.clipboard?.writeText(tsv).catch(() => {});
    return true;
  }

  function toggle(ed, key) {
    const cell = findSelectedCell(ed);
    const style = cell?.node?.attrs?.cellStyle || {};
    return !style[key];
  }

  /** Reflects the current selection in the toolbar's active states. */
  function refresh() {
    const ed = activeEditor;
    if (!ed || ed.isDestroyed) return;
    const set = (action, active) => {
      root.querySelectorAll(`[data-action="${action}"]`).forEach((el) => el.classList.toggle('is-active', active));
    };
    set('bold', ed.isActive('bold'));
    set('italic', ed.isActive('italic'));
    set('underline', ed.isActive('underline'));
    set('strike', ed.isActive('strike'));
    set('bullet-list', ed.isActive('bulletList'));
    set('ordered-list', ed.isActive('orderedList'));
    set('blockquote', ed.isActive('blockquote'));
    ['left', 'center', 'right', 'justify'].forEach((align) =>
      set(`align-${align}`, ed.isActive({ textAlign: align })),
    );
    const heading = [1, 2, 3].find((level) => ed.isActive('heading', { level }));
    const headingSelect = root.querySelector('[data-select="heading"]');
    if (headingSelect) headingSelect.value = heading ? `h${heading}` : 'p';
    const sizeSelect = root.querySelector('[data-select="fontSize"]');
    if (sizeSelect) sizeSelect.value = ed.getAttributes('textStyle')?.fontSize || '';
    const colorDot = root.querySelector('[data-color-dot="color"]');
    if (colorDot) colorDot.style.background = ed.getAttributes('textStyle')?.color || state.color;
    const highlightDot = root.querySelector('[data-color-dot="highlight"]');
    if (highlightDot) highlightDot.style.background = ed.getAttributes('highlight')?.color || state.highlight;

    if (scope === 'cell') {
      const cell = findSelectedCell(ed);
      const style = cell?.node?.attrs?.cellStyle || {};
      set('cell-bold', Boolean(style.bold));
      set('cell-italic', Boolean(style.italic));
      set('cell-underline', Boolean(style.underline));
      ['left', 'center', 'right'].forEach((align) => set(`cell-align-${align}`, style.align === align));
      const textDot = root.querySelector('[data-color-dot="cell-text"]');
      if (textDot) textDot.style.background = style.color || state.cellText;
      const fillDot = root.querySelector('[data-color-dot="cell-fill"]');
      if (fillDot) fillDot.style.background = style.background || state.cellFill;
      root.querySelectorAll('[data-action^="cell-"]').forEach((el) => {
        el.disabled = !cell;
      });
    }
  }

  const onSelectionUpdate = () => refresh();
  editor.on('selectionUpdate', onSelectionUpdate);
  editor.on('transaction', onSelectionUpdate);
  refresh();

  return {
    refresh,
    setEditor(next) {
      editor.off('selectionUpdate', onSelectionUpdate);
      editor.off('transaction', onSelectionUpdate);
      activeEditor = next;
      next.on('selectionUpdate', onSelectionUpdate);
      next.on('transaction', onSelectionUpdate);
      refresh();
    },
    destroy() {
      editor.off('selectionUpdate', onSelectionUpdate);
      editor.off('transaction', onSelectionUpdate);
      closeMenus();
    },
  };
}

/** Shows/hides the contextual table toolbar and its host editor. */
export function bindTableToolbar({ root, editor, toolbar }) {
  if (!root) return;
  root.innerHTML = tableToolbarMarkup();
  const sync = () => {
    const show = inTable(editor);
    root.classList.toggle('hidden', !show);
    root.classList.toggle('flex', show);
    if (show) toolbar?.refresh?.();
  };
  editor.on('selectionUpdate', sync);
  editor.on('transaction', sync);
  sync();
  return sync;
}

let toastHandler = null;
/** The host app can show a toast; falls back to a no-op. */
export function setToastHandler(handler) {
  toastHandler = handler;
}
function toastOnce(message) {
  toastHandler?.(message);
}

export { CellStyleState, insertMatrix };
