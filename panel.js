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
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
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

