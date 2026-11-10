/**
 * Clipboard helpers.
 *
 * The Excel/Google-Sheets flow is the tricky one: Excel puts a full
 * `text/html` flavour on the clipboard where cells are separated by newlines
 * and *tab characters*, including inside `<td>`/`<th>`. Browsers' HTML parsing
 * happily collapses those tabs, so Tiptap's default table parser ends up with
 * one cell per row. We normalise those stray tabs into real cells first.
 */

/** Copy HTML + plain text to the clipboard (async API with a legacy fallback). */
export async function writeRichClipboard(html, text) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text || ''], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    /* fall through to the execCommand path */
  }
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const ok = document.execCommand('copy');
  selection.removeAllRanges();
  holder.remove();
  return ok;
}

/**
 * Detects tab-separated spreadsheet text.
 * Returns a 2D array of cell strings, or null when the text is not tabular.
 */
export function parseDelimitedText(text) {
  if (!text) return null;
  const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!normalized.includes('\t')) return null;
  const rows = normalized.split('\n').map((line) => line.split('\t'));
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2 || rows.length < 1) return null;
  // Guard against huge accidental pastes (e.g. a whole column of code).
  if (rows.length * width > 20000) return null;
  return rows.map((row) => {
    const padded = row.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/** Is this HTML already table-based? */
export function containsTable(html) {
  return /<table[\s>]/i.test(html || '');
}

/**
 * Pre-processes `text/html` from Excel/Sheets:
 *  1. turns `<br>` inside cells into line breaks,
 *  2. splits cell text on raw tab characters into separate cells,
 *  3. drops the noisy wrappers Excel adds around the table.
 * Returns the original HTML untouched when there is nothing to repair.
 */
export function normalizeSpreadsheetHtml(html) {
  if (!html || !containsTable(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = [...doc.querySelectorAll('table')];
  if (!tables.length) return html;

  let changed = false;
  for (const table of tables) {
    for (const row of [...table.rows]) {
      const cells = [...row.cells];
      for (const cell of cells) {
        const raw = cell.innerHTML;
        if (!raw.includes('\t')) continue;
        const parts = cell.textContent.split('\t');
        if (parts.length < 2) continue;
        // Keep the styling of the original cell for every new cell.
        const template = cell.cloneNode(false);
        const fragment = doc.createDocumentFragment();
        parts.forEach((part, index) => {
          const clone = template.cloneNode(false);
          clone.innerHTML = escapeHtml(part).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
          if (index === parts.length - 1) clone.innerHTML = clone.innerHTML;
          fragment.appendChild(clone);
        });
        row.replaceChild(fragment, cell);
        changed = true;
      }
    }
    // Remove Excel's invisible spacer rows/columns.
    for (const tr of [...table.rows]) {
      if (!tr.cells.length) tr.remove();
    }
  }

  if (!changed) return html;
  return doc.body.innerHTML;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

/**
 * Builds the HTML fragment used when inserting tabular clipboard text into an
 * empty editor. Cell formatting from a plain-text paste is never available, so
 * this is deliberately minimal — but it is a real table, which is what people
 * expect after copying from Excel.
 */
export function tableHtmlFromRows(rows) {
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td><p>${escapeHtml(cell).replace(/\n/g, '</p><p>')}</p></td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table><tbody>${body}</tbody></table>`;
}

/** Reads an image file as a data URL (used for optimistic previews). */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
