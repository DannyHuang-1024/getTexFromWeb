# getTexHtml

Floating edge-panel and popup Chrome/Edge extension for capturing LaTeX formulas rendered with KaTeX/MathJax or embedded in page attributes/text (e.g., ChatGPT/Gemini responses).

## Features
- Draggable floating action button that docks to either edge, half-hides automatically, and remembers its position via storage.
- Marks formulas in-page, adds hover outlines, and lets you click any formula to copy its TeX.
- Detects TeX from KaTeX annotations, MathJax script nodes, MathML, rendered MathJax trees, trusted formula attributes such as `data-math`, and inline/display delimiters such as `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`.
- Uses a bounded viewport-nearby scanner for faster marking on long dynamic pages, with priority for visible formulas, display formulas, and longer TeX.
- Handles Gemini-style `math-block` / `math-inline` formula markup where source TeX is stored in `data-math`.
- Watches dynamic pages after the first scan, so newly streamed formulas can be captured without reopening the page.
- Reuses `panel.html` as both the floating side panel and the browser action popup, so the same scan controls are available from the toolbar.
- Panel/popup shows current page info, runs quick scans, toggles continuous scanning, lists captured TeX with one-click copy, and provides Copy All.
- Copy format setting supports plain LaTeX, `$...$`, `$$...$$`, `\[...]`, `\(...)`, and `equation` environment wrappers. The setting is saved and also applies to clicking highlighted formulas on the page.
- Uses multiple clipboard fallbacks, including an MV3 offscreen document, for sites that interfere with page-level copy events.
- Uses a Shadow DOM to isolate styles so pages cannot break the UI; works on any site through `<all_urls>` host permission.
- Manifest V3 service worker keeps defaults; icon assets live under `resources/`.

## Install (Chrome/Edge)
1) Clone or download this repository.
2) Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
3) Click **Load unpacked** and select this folder.
4) Ensure the extension is allowed to run on the sites where you want to capture formulas.

## Usage
1) Open a page with rendered or delimited LaTeX output (ChatGPT/Gemini are common sources).
2) Hover near the right edge to reveal the floating button, or click the extension toolbar icon to open the popup. Drag the floating button to reposition it (the spot is saved).
3) Click actions:
   - `Quick Scan`: injects helper styles, tags detected formulas near the viewport, records their TeX, and flashes detected formulas.
   - `Continuous`: watches DOM, attribute, scroll, resize, and visibility changes, then rescans the viewport-nearby region without falling back to a full-page scan.
   - `Open panel`: opens the floating panel with the same controls as the toolbar popup.
   - `Copy format`: chooses how individual formulas and Copy All are wrapped before copying.
   - `Results`: lists captured TeX; click a row to copy it or use **Copy All**.
   - `Collapse`: hides the mini menu (it also auto-collapses when the cursor leaves unless pinned open).
4) Click any highlighted formula in the page to copy its TeX directly; use the panel when you need the full list.

## Files of note
- `content.js`: injects the floating UI, bounded formula detection/tagging, copy helpers, and panel/popup messaging.
- `panel.html`, `panel.js`, `panel.css`: shared UI for the floating side panel, browser action popup, copy format control, and TeX list rendering.
- `sw.js`, `offscreen.html`, `offscreen.js`: Manifest V3 service worker and offscreen clipboard fallback.
- `resources/`: icons used by the extension.
- `cropIcon.py`: regenerate `resources/icon_{16,32,48,128}.png` from `resources/icon.png` (requires Pillow).

## Permissions
Requests `host_permissions: ["<all_urls>"]` to read formula markup on any page, `activeTab` so the toolbar popup can talk to the current tab, `storage` to remember button position/state and copy format, `clipboardWrite` to copy formulas, and `offscreen` to provide a clipboard fallback when page-level copy is blocked.


Some functions don't implement so far. Maybe added in future versions:
- Maybe add function to copy a selected whole paragraph
- Maybe add function to export all TeX to a .txt file
- Maybe add function to export all conversation to md file
...
