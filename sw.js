chrome.runtime.onInstalled.addListener(() => {
  // 初始化默认设置（可选）
  chrome.storage.local.set({ edgeSide: "right" });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "COPY_TEXT") return false;

  copyTextOffscreen(String(msg.payload?.text || ""))
    .then((ok) => sendResponse({ ok }))
    .catch(() => sendResponse({ ok: false }));

  return true;
});

async function copyTextOffscreen(text) {
  if (!text) return false;

  await ensureOffscreenDocument();

  return chrome.runtime.sendMessage({
    type: "OFFSCREEN_COPY_TEXT",
    payload: { text }
  });
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL("offscreen.html");

  if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
    return;
  }

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url]
    });
    if (contexts.length) return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "Copy LaTeX formulas captured from web pages."
  });
}
