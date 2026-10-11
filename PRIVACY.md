# Privacy Policy for getTexFormula

**Effective Date:** October 11, 2026

## 1. Overview

getTexFormula is a browser extension that finds LaTeX math formulas on web pages and lets you copy them. It does not collect, transmit, or sell personal data. Everything the extension does happens locally in your browser.

## 2. Website Content Processing

To find formulas, the extension reads the content of the pages you visit, including KaTeX, MathJax, MathML, and LaTeX text and attributes. This processing happens entirely inside your browser.

- Extracted formulas are kept in memory only while the page is open, so they can be highlighted, listed, and copied.
- To make a formula clickable, the extension temporarily adds marker attributes and a CSS class to the matching page elements (and may set a tooltip showing the formula). These are removed when you press **Clear** or reload the page.
- The extension ignores text you type into input fields and editors, and messages you sent in chat interfaces.
- The extension displays the current page's title and URL in its panel. This is shown to you only; it is not stored, logged, or sent anywhere.

## 3. Local Storage

The extension uses the browser's local extension storage (`chrome.storage.local`) only to remember your preferences:

- Floating button position and side
- Preferred LaTeX copy format
- Single-line copy preference

This data stays on your device. Extracted formulas, page content, and browsing history are never saved to storage.

## 4. Clipboard Access

When you click a formula or the copy buttons, the extension writes the selected LaTeX text to your clipboard. It does not read your clipboard contents.

## 5. Data Collection and Sharing

- The extension makes no network requests and has no servers or accounts.
- It does not collect or transmit formulas, page content, browsing history, or personal information.
- It uses no analytics, advertising, tracking, or remotely hosted code.
- It does not sell, rent, or share any data with third parties.

## 6. Permissions

- **`storage`**: save the preferences listed in Section 3.
- **`clipboardWrite`**: copy formulas to your clipboard.
- **Content script on all websites**: formulas can appear on any site, so the content script runs on all pages in order to detect them locally.

## 7. Data Retention

Preferences remain in local browser storage until you change them or remove the extension, which deletes them. Nothing else is retained.

## 8. Children's Privacy

The extension collects no personal information from anyone, including children.

## 9. Changes to This Policy

If the extension's data handling changes, this policy will be updated and the effective date revised. Changes are published in this repository.

## 10. Contact

For questions about this policy, please open an issue at:
https://github.com/DannyHuang-1024/getTexFromWeb/issues
