# getTexHtml

Floating edge-panel Chrome/Edge extension for capturing LaTeX formulas rendered with KaTeX/MathJax (e.g., ChatGPT responses).

## Features
- Draggable floating action button that docks to either edge, half-hides automatically, and remembers its position via storage.
- Marks KaTeX formulas in-page, adds hover outlines, and lets you click any formula to copy its TeX.
- Side panel (`panel.html`) shows current page info, outlines formulas on demand, and lists all captured TeX with one-click copy and Copy All.
- Uses a Shadow DOM to isolate styles so pages cannot break the UI; works on any site through `<all_urls>` host permission.
- Manifest V3 service worker keeps defaults; icon assets live under `resources/`.

## Install (Chrome/Edge)
1) Clone or download this repository.  
2) Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.  
3) Click **Load unpacked** and select this folder.  
4) Ensure the extension is allowed to run on the sites where you want to capture formulas.

## Usage
1) Open a page with KaTeX/MathJax output (ChatGPT is a common source).  
2) Hover near the right edge to reveal the floating button; drag to reposition (the spot is saved).  
3) Click actions:
   - `Mark Formulas (?)`: injects helper styles, tags KaTeX blocks, and records their TeX; toast shows how many were found.
   - `Open panel`: shows page title/URL, lists captured TeX (click a row to copy), provides **Copy All**, and a **Flash Formulas** button to outline math on the page.
   - `Collapse`: hides the mini menu (it also auto-collapses when the cursor leaves unless pinned open).
4) Click any highlighted formula in the page to copy its TeX directly; use the panel when you need the full list.

## Files of note
- `content.js`: injects the floating UI, formula detection/tagging, copy helpers, and panel messaging.
- `panel.html`, `panel.js`, `panel.css`: UI for the side panel and TeX list rendering.
- `sw.js`: Manifest V3 service worker seeding default settings.
- `resources/`: icons used by the extension.
- `cropIcon.py`: regenerate `resources/icon_{16,32,48,128}.png` from `resources/icon.png` (requires Pillow).

## Permissions
Requests `host_permissions: ["<all_urls>"]` to read KaTeX markup on any page and `storage` to remember the button position/state.


Some functions don't implement so far. Maybe added in future versions:
- Maybe add function to copy a selected whole paragraph
- Maybe add function to export all TeX to a .txt file
- Maybe add function to export all conversation to md file
...