const pageTitle = document.getElementById("pageTitle");
const pageUrl = document.getElementById("pageUrl");

const btnFlash = document.getElementById("btnFlash");
const btnToast = document.getElementById("btnToast");
const btnClose = document.getElementById("btnClose");

const texListEl = document.getElementById("texList");
const texCountEl = document.getElementById("texCount");
const btnCopyAll = document.getElementById("btnCopyAll");

let lastTexList = [];


window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "CONTEXT") {
    const { title, url } = msg.payload || {};
    pageTitle.textContent = title || "(No Title)";
    pageUrl.textContent = url || "";
  }
});

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg?.type !== "TEX_LIST") return;

  const texList = Array.isArray(msg.payload) ? msg.payload : [];
  renderTexList(texList);
});


function sendAction(action) {
  window.parent.postMessage(
    { type: "ACTION", payload: { action } },
    "*"
  );
}

btnFlash.addEventListener("click", () => sendAction("FLASH_FORMULAS"));
btnToast.addEventListener("click", () => sendAction("SHOW_TOAST"));
btnClose.addEventListener("click", () => sendAction("CLOSE_PANEL"));

async function copyText(s) {
  const text = String(s || "");
  if (!text) return false;

  if (copyWithCopyEvent(text)) return true;
  if (copyWithTextarea(text)) return true;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyWithCopyEvent(text) {
  let handled = false;
  const listener = (ev) => {
    ev.preventDefault();
    ev.clipboardData?.setData("text/plain", text);
    handled = Boolean(ev.clipboardData);
  };

  document.addEventListener("copy", listener, true);
  try {
    return Boolean(document.execCommand("copy") && handled);
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", listener, true);
  }
}

function copyWithTextarea(text) {
  const active = document.activeElement;
  const selection = document.getSelection?.();
  const ranges = [];

  if (selection) {
    for (let i = 0; i < selection.rangeCount; i++) {
      ranges.push(selection.getRangeAt(i).cloneRange());
    }
  }

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
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
    active?.focus?.({ preventScroll: true });
  }
}

function renderTexList(texList) {
  lastTexList = texList;

  if (texCountEl) texCountEl.textContent = `Number: ${texList.length}`;
  if (!texListEl) return;

  texListEl.innerHTML = "";

  if (!texList.length) {
    texListEl.textContent = "(No formulas yet, click the ✨ button on the page to capture)";
    return;
  }

  texList.forEach((tex, i) => {
    const row = document.createElement("div");
    row.className = "texrow";

    const code = document.createElement("div");
    code.className = "texcode";
    code.textContent = tex;

    // 点击整行复制
    row.addEventListener("click", () => copyText(tex));

    row.append(code);
    texListEl.appendChild(row);
  });
}

btnCopyAll?.addEventListener("click", () => {
  copyText(lastTexList.join("\n\n"));
});
