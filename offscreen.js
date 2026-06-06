chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "OFFSCREEN_COPY_TEXT") return false;

  copyText(String(msg.payload?.text || ""))
    .then((ok) => sendResponse(ok))
    .catch(() => sendResponse(false));

  return true;
});

async function copyText(text) {
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithTextarea(text);
  }
}

function copyWithTextarea(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  Object.assign(ta.style, {
    position: "fixed",
    left: "-9999px",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0"
  });

  document.body.appendChild(ta);

  try {
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
