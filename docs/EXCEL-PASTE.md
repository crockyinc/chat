# Excel / Google Sheets interop — how it works

Copying cells from a spreadsheet puts two flavours on the clipboard:

| Flavour      | Shape |
| ------------ | ----- |
| `text/plain` | Rows separated by `\n`, cells separated by `\t` |
| `text/html`  | A `<table>` where the cells are separated by **literal tab characters inside `<td>`** |

Because HTML collapses whitespace, a naive `innerHTML` parse turns
`<td>Region\tSales</td>` into a *single* cell — which is why most editors lose the
grid. This app repairs that before Tiptap sees anything.

## The pipeline

```
paste event
   │
   ├─ clipboardData.getData('text/html')  ─────────────┐
   │                                                   │
   └─ clipboardData.getData('text/plain')              │
                                                       ▼
                             normalizeSpreadsheetHtml()   (client/editor/clipboard.js)
                               · splits <td> text on \t into extra cells
                               · keeps the original cell's style on every split cell
                               · drops Excel's spacer rows
                                                       │
                                                       ▼
                                   SpreadsheetPaste plugin   (extensions/SpreadsheetPaste.js)
                                     · cell range selected  → fillCellSelection()
                                     · caret inside a table → fillFromCaret() (grows the table)
                                     · no table yet         → insert a real table
                                     · plain TSV only       → tableFromMatrix()
```

Per-cell formatting is read from the pasted element's inline styles
(`background-color`, `color`, `font-weight`, `text-align`, `border`, `width`) and stored as a
`cellStyle` node attribute. It is written back out twice:

```html
<td data-cell-style='{"bold":true,"background":"#fff3c4","align":"center"}'
    style="font-weight: 700; background-color: rgb(255, 243, 196); text-align: center;">
```

* the inline `style` keeps the document meaningful for any HTML viewer;
* `data-cell-style` is the lossless representation used by the editor, and it is explicitly
  whitelisted by the server-side sanitiser (`server/security.js`).

## Behaviour details

* **Range paste** — select cells (drag, or click a column letter) and paste: values fill the
  range exactly like Excel. If the clipboard is larger, rows/columns are appended on the fly.
* **Caret paste** — with the cursor in a cell, a multi-cell clipboard flows right/down from that
  cell, growing the table as needed. A single-cell paste replaces the whole table (handy when
  re-pasting a table copied from the chat).
* **Copy out** — a cell-range copy writes both `text/plain` (TSV) and `text/html`, so Excel,
  Sheets and Word all receive a proper grid.
* **Plain text** — tab-separated text with no HTML (terminals, CSVs, chat) becomes a table too.
* **`Ctrl/Cmd+Shift+V`** always pastes as plain text, so you can opt out of table conversion.
* **Limits** — pastes over 20 000 cells are ignored to keep the composer responsive.

## Manually poking at it

The quickest check is in the browser console on the running app:

```js
const ed = window.lm.editor;

// Insert a 3x3 spreadsheet, caret lands in the first cell.
ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

// What will actually be stored/sent (inline CSS + data-cell-style JSON):
ed.getHTML();
```

For a scripted round-trip (the same functions the UI uses), see
`tests/ui.test.js → "tables behave like a spreadsheet"`: it builds a clipboard event with Excel's
exact `text/html` shape and asserts the cells are filled.
