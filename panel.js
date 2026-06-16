const COPY_FORMAT_STORAGE_KEY = "latexCopyFormat";
const COPY_FORMAT_DEFAULT = "bare";
const COPY_FORMAT_IDS = new Set([
  "bare",
  "inline-dollar",
  "display-dollar",
  "display-bracket",
  "inline-paren",
  "equation"
]);

const pageTitle = document.getElementById("pageTitle");
const pageUrl = document.getElementById("pageUrl");

const btnFlash = document.getElementById("btnFlash");
const btnContinuous = document.getElementById("btnContinuous");
const btnClose = document.getElementById("btnClose");
const copyFormatEl = document.getElementById("copyFormat");
const statusEl = document.getElementById("status");

const texListEl = document.getElementById("texList");
const texCountEl = document.getElementById("texCount");
const btnCopyAll = document.getElementById("btnCopyAll");
const texDetailsEl = document.getElementById("texDetails");

const isPopup = window.parent === window;

let lastTexList = [];
let currentCopyFormat = COPY_FORMAT_DEFAULT;
let sizeReportRaf = 0;

init();

function init() {
  loadCopyFormat();
  bindEvents();
  initSizeReporting();

  if (isPopup) {
    document.body.dataset.mode = "popup";
    renderContext({ title: "Current tab", url: "" });
    refreshState();
  } else {
    document.body.dataset.mode = "iframe";
  }
}

function bindEvents() {
  window.addEventListener("message", handleFrameMessage);

  btnFlash?.addEventListener("click", () => sendAction("FLASH_FORMULAS"));
  btnContinuous?.addEventListener("click", () => sendAction("TOGGLE_CONTINUOUS_SCAN"));
  btnClose?.addEventListener("click", () => sendAction("CLOSE_PANEL"));
  btnCopyAll?.addEventListener("click", () => copyFormulaList(lastTexList));

  copyFormatEl?.addEventListener("change", () => {
    currentCopyFormat = normalizeCopyFormatId(copyFormatEl.value);
    chrome.storage?.local?.set?.({ [COPY_FORMAT_STORAGE_KEY]: currentCopyFormat });
    setStatus("Copy format updated.");
  });

  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local" || !changes[COPY_FORMAT_STORAGE_KEY]) return;
    setCopyFormat(changes[COPY_FORMAT_STORAGE_KEY].newValue);
  });
}

function loadCopyFormat() {
  chrome.storage?.local?.get?.({ [COPY_FORMAT_STORAGE_KEY]: COPY_FORMAT_DEFAULT }, (res) => {
    if (chrome.runtime?.lastError) return;
    setCopyFormat(res?.[COPY_FORMAT_STORAGE_KEY]);
  });
}

function setCopyFormat(format) {
  currentCopyFormat = normalizeCopyFormatId(format);
  if (copyFormatEl) copyFormatEl.value = currentCopyFormat;
}

function normalizeCopyFormatId(format) {
  return COPY_FORMAT_IDS.has(format) ? format : COPY_FORMAT_DEFAULT;
}

function handleFrameMessage(e) {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "REQUEST_PANEL_SIZE") {
    reportPanelSize();
    return;
  }

  if (msg.type === "CONTEXT") {
    const { title, url } = msg.payload || {};
    renderContext({ title, url });
    return;
  }

  if (msg.type === "TEX_LIST") {
    renderTexList(Array.isArray(msg.payload) ? msg.payload : []);
    return;
  }

  if (msg.type === "SCAN_STATE") {
    renderScanState(Boolean(msg.payload?.continuous));
  }
}

function sendAction(action) {
  if (isPopup) {
    sendActionToActiveTab(action);
    return;
  }

  window.parent.postMessage(
    { type: "ACTION", payload: { action } },
    "*"
  );
}

async function sendActionToActiveTab(action) {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("No active tab found");

    const res = await sendMessageToTab(tab.id, action);

    if (res?.ok) {
      renderState(res.payload || {});
    } else {
      setStatus(res?.error || "Action failed.");
    }

    return res;
  } catch (err) {
    const message = getRuntimeErrorMessage(err);
    setStatus(message);
    return { ok: false, error: message };
  }
}

async function refreshState() {
  try {
    const response = await sendActionToActiveTab("GET_STATE");
    if (!response?.ok) {
      renderContext({ title: "Current tab", url: "" });
    }
  } catch (err) {
    setStatus(getRuntimeErrorMessage(err));
    renderContext({ title: "Current tab", url: "" });
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    try {
      if (!chrome.tabs?.query) {
        resolve(null);
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(tabs?.[0]);
      });
    } catch {
      resolve(null);
    }
  });
}

function sendMessageToTab(tabId, action) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: "PANEL_ACTION", payload: { action } },
        (res) => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(res);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

function getRuntimeErrorMessage(err) {
  const runtimeMessage = chrome.runtime?.lastError?.message;
  const message = runtimeMessage || err?.message || "";
  if (/Receiving end does not exist/i.test(message)) {
    return "The page is not ready. Refresh it and try again.";
  }
  if (/Cannot access/i.test(message)) {
    return "This page does not allow extension access.";
  }
  return message || "Could not connect to the current page.";
}

function renderState(state) {
  renderContext(state);
  renderTexList(Array.isArray(state.texList) ? state.texList : []);
  renderScanState(Boolean(state.continuous));
  if (state.stats) {
    setStatus(`Scan complete: ${state.stats.total || 0} formulas, ${state.stats.newlyTagged || 0} newly tagged.`);
    if ((state.stats.total || 0) > 0 && texDetailsEl) texDetailsEl.open = true;
    reportPanelSize();
  }
}

function renderContext({ title, url }) {
  if (pageTitle) pageTitle.textContent = title || "(Untitled)";
  if (pageUrl) pageUrl.textContent = url || "";
  reportPanelSize();
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text || "";
}

async function copyFormula(tex) {
  const ok = await copyText(formatFormulaText(tex, currentCopyFormat));
  setStatus(ok ? "Copied." : "Copy failed. Select the text manually.");
}

async function copyFormulaList(texList) {
  const text = texList.map((tex) => formatFormulaText(tex, currentCopyFormat)).join("\n\n");
  const ok = await copyText(text);
  setStatus(ok ? "Copied all." : "Copy failed. Select the text manually.");
}

function formatFormulaText(tex, format) {
  const value = String(tex || "");
  const normalizedFormat = normalizeCopyFormatId(format);

  if (!value) return "";
  if (normalizedFormat === "inline-dollar") return `$${value}$`;
  if (normalizedFormat === "display-dollar") return `$$${value}$$`;
  if (normalizedFormat === "display-bracket") return `\\[\n${value}\n\\]`;
  if (normalizedFormat === "inline-paren") return `\\(${value}\\)`;
  if (normalizedFormat === "equation") return `\\begin{equation}\n${value}\n\\end{equation}`;

  return value;
}

async function copyText(s) {
  const text = String(s || "");
  if (!text) return false;

  if (copyWithCopyEvent(text)) return true;
  if (copyWithTextarea(text)) return true;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyViaExtension(text);
  }
}

function copyViaExtension(text) {
  return new Promise((resolve) => {
    if (!chrome.runtime?.sendMessage) {
      resolve(false);
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { type: "COPY_TEXT", payload: { text } },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(Boolean(res?.ok));
        }
      );
    } catch {
      resolve(false);
    }
  });
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

  if (texCountEl) texCountEl.textContent = `${texList.length} formula${texList.length === 1 ? "" : "s"}`;
  if (!texListEl) return;

  texListEl.innerHTML = "";
  if (!texList.length && texDetailsEl) texDetailsEl.open = false;

  if (!texList.length) {
    texListEl.textContent = "No formulas yet. Run Quick Scan to capture formulas on this page.";
    reportPanelSize();
    return;
  }

  texList.forEach((tex) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "texrow";

    const code = document.createElement("span");
    code.className = "texcode";
    code.textContent = tex;

    row.addEventListener("click", () => copyFormula(tex));

    row.append(code);
    texListEl.appendChild(row);
  });
  reportPanelSize();
}

function renderScanState(enabled) {
  if (!btnContinuous) return;
  btnContinuous.textContent = enabled ? "Continuous: On" : "Continuous: Off";
  btnContinuous.classList.toggle("active", enabled);
  reportPanelSize();
}

function initSizeReporting() {
  texDetailsEl?.addEventListener("toggle", reportPanelSize);
  window.addEventListener("load", reportPanelSize);

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(reportPanelSize);
    observer.observe(document.querySelector(".wrap") || document.body);
    return;
  }

  setTimeout(reportPanelSize, 0);
}

function reportPanelSize() {
  if (isPopup || !window.parent || window.parent === window) return;
  if (sizeReportRaf) cancelAnimationFrame(sizeReportRaf);

  sizeReportRaf = requestAnimationFrame(() => {
    sizeReportRaf = 0;
    const content = document.querySelector(".wrap") || document.body;
    const rectHeight = content.getBoundingClientRect().height;
    const height = Math.ceil(rectHeight || content.scrollHeight || 0);
    window.parent.postMessage({ type: "PANEL_SIZE", payload: { height } }, "*");
  });
}
