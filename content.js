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
let currentCopyFormat = COPY_FORMAT_DEFAULT;

(() => {
  // 立即执行函数：把所有变量收进局部作用域，避免污染页面全局。
  const HOST_ID = "__edge_fab_host__"; // Shadow DOM 宿主元素的唯一 ID，用来防止重复创建。
  if (document.getElementById(HOST_ID)) return; // 如果已存在宿主，说明已初始化，直接退出。

  // --- 可调参数：控制尺寸、间距、吸边距离、层级等视觉与交互细节。
  const FAB_SIZE = 36;          // 主按钮直径（主按钮小一些）。
  const MINI_SIZE = 40;         // 小按钮直径（小按钮更醒目）。
  const MINI_BUTTON_COUNT = 4;  // 小按钮数量，用于计算 hover 保护区和弹出方向。
  const GAP = 10;               // 小按钮之间的垂直间距。
  const EDGE_MARGIN = 8;        // 吸附到左右边缘后的内侧偏移。
  const TOP_MARGIN = 10;        // 拖拽可到达的顶部安全边距。
  const BOTTOM_MARGIN = 10;     // 拖拽可到达的底部安全边距。
  const Z = 2147483647;         // 极高层级，保证浮窗显示在页面最上层。

  syncCopyFormatSetting();
  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local" || !changes[COPY_FORMAT_STORAGE_KEY]) return;
    currentCopyFormat = normalizeCopyFormatId(changes[COPY_FORMAT_STORAGE_KEY].newValue);
  });

  // 创建 Shadow DOM 宿主容器，用于隔离样式，避免被页面 CSS 干扰。
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";      // 宿主固定定位在视口中。
  host.style.left = "0";              // 位置不重要，仅用于挂载 Shadow DOM。
  host.style.top = "0";
  host.style.zIndex = String(Z);       // 保证宿主在最高层。
  host.style.pointerEvents = "none";  // 宿主默认不拦截鼠标事件，避免挡住网页。
  document.documentElement.appendChild(host); // 挂载到根节点，保证随页面滚动独立。

  // 创建 Shadow Root，让组件样式与页面样式互不影响。
  const shadow = host.attachShadow({ mode: "open" });

  // 默认位置：右侧 + 按窗口高度 35% 的高度。
  const defaultState = { side: "right", top: Math.round(window.innerHeight * 0.35) };

  // 从本地存储读取上次拖拽位置；没有则使用默认位置。
  chrome.storage?.local?.get?.({ edgeFabState: defaultState }, (res) => {
    init(res.edgeFabState || defaultState);
  });

  // 数值夹取：保证 top 不会越界到可视区域外。
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // 初始化 UI 与交互逻辑。
  function init(state) {
    // side 只允许 left/right，不合法则兜底为 right。
    const side = (state.side === "left" || state.side === "right") ? state.side : "right";
    // top 位置做可视区域夹取，防止超出屏幕。
    const top0 = clamp(state.top ?? defaultState.top, TOP_MARGIN, window.innerHeight - FAB_SIZE - BOTTOM_MARGIN);

    // ---- 注入组件样式（在 Shadow DOM 内）
    const style = document.createElement("style");
    style.textContent = `
      /* 清空 Shadow DOM 根的默认样式，避免宿主样式残留 */
      :host { all: initial; }

      /* 外层容器：固定定位、放置主按钮与小按钮 */
      .ef-wrap{
        position: fixed;
        top: ${top0}px;
        ${side}: ${EDGE_MARGIN}px;
        width: ${FAB_SIZE}px;
        height: ${FAB_SIZE}px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        pointer-events: auto;

        /* 半隐藏：默认缩进一半（右侧向右，左侧向左） */
        transform: translateX(0);
        transition: transform 180ms ease;
      }

      /* 收起时：右侧向外推、左侧向外推，露出一半 */
      .ef-wrap[data-side="right"][data-collapsed="1"] { transform: translateX(52%); }
      .ef-wrap[data-side="left"][data-collapsed="1"]  { transform: translateX(-52%); }

      /* 主按钮弹性动画：点击/悬停时微弹一下 */
      @keyframes efPop {
        0%   { transform: scale(.86); }
        70%  { transform: scale(1.06); }
        100% { transform: scale(1); }
      }

      /* 主按钮样式 */
      .ef-fab{
        width:${FAB_SIZE}px; height:${FAB_SIZE}px;
        border-radius: 999px;
        background: #0b57d0;
        color: white;
        display:flex; align-items:center; justify-content:center;
        box-shadow: 0 10px 22px rgba(0,0,0,.22);
        cursor: grab;
        position: relative;
        transform: scale(.86);
        transition: transform 160ms ease;
      }
      .ef-fab:active{ cursor: grabbing; }

      /* hover 或 pinned 时，主按钮放大并弹性 */
      .ef-wrap:hover .ef-fab,
      .ef-wrap[data-pinned="1"] .ef-fab{
        transform: scale(1);
        animation: efPop 180ms ease-out;
      }

      /* 主按钮里的图标大小 */
      .ef-icon{ width: 18px; height: 18px; display:block; }

      /* 小按钮容器：从主按钮上方弹出，默认隐藏 */
      .ef-mini{
        position: absolute;
        left: 50%;
        top: calc(100% + 8px);
        transform: translateX(-50%) translateY(-10px) scale(.96);
        opacity: 0;
        pointer-events: none;

        display: flex;
        flex-direction: column; /* 竖向排列 */
        gap: ${GAP}px;

        transition: transform 160ms ease, opacity 160ms ease;
      }

      /* 当靠近底部时，改成“往上弹出” */
      .ef-wrap[data-menu="up"] .ef-mini{
        top: auto;
        bottom: calc(100% + 8px);
        transform: translateX(-50%) translateY(10px) scale(.96);
      }
      .ef-wrap[data-menu="up"]:hover .ef-mini,
      .ef-wrap[data-menu="up"][data-open="1"] .ef-mini,
      .ef-wrap[data-menu="up"][data-pinned="1"] .ef-mini{
        transform: translateX(-50%) translateY(0) scale(1);
      }

      /* 打开条件：hover 或 pinned 或 data-open=1 */
      .ef-wrap:hover .ef-mini,
      .ef-wrap[data-open="1"] .ef-mini,
      .ef-wrap[data-pinned="1"] .ef-mini{
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
        pointer-events: auto;
      }

      /* 单个小按钮样式 */
      .ef-btn{
        width:${MINI_SIZE}px; height:${MINI_SIZE}px;
        border-radius: 999px;
        border: 1px solid rgba(0,0,0,.10);
        background: white;
        display:flex; align-items:center; justify-content:center;
        box-shadow: 0 10px 22px rgba(0,0,0,.16);
        cursor: pointer;
        font-size: 16px;
      }
      .ef-btn:hover{ transform: translateY(-1px); }
      .ef-btn[data-active="1"]{
        background: #e8f0fe;
        border-color: #8ab4f8;
        color: #174ea6;
      }

      /* 小按钮提示气泡 */
      .ef-tip{
        position:absolute;
        left: calc(100% + 8px);
        top: 50%;
        transform: translateY(-50%);
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(0,0,0,.78);
        color: white;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 120ms ease;
        pointer-events: none;
      }
      .ef-btn[data-tip]:hover .ef-tip{ opacity: 1; }

      /* hover 保护区：防止鼠标移向小按钮时触发隐藏 */
      .ef-hoverpad{
        position: absolute;
        left: 50%;
        top: 0;
        bottom: auto;
        transform: translateX(-50%);
        width: ${Math.max(MINI_SIZE, FAB_SIZE) + 28}px;
        height: ${FAB_SIZE + (MINI_SIZE + GAP) * MINI_BUTTON_COUNT + 30}px;
        pointer-events: none; /* 默认不挡网页 */
        background: transparent;
      }
      .ef-wrap:hover .ef-hoverpad,
      .ef-wrap[data-open="1"] .ef-hoverpad,
      .ef-wrap[data-pinned="1"] .ef-hoverpad{
        pointer-events: auto;
      }

      /* menu 往上弹时，保护区也要往上覆盖 */
      .ef-wrap[data-menu="up"] .ef-hoverpad{
        top: auto;
        bottom: 0;
      }

      /* 可选面板（嵌入 panel.html） */
      .ef-panel{
        position: fixed;
        top: 18vh;
        width: 340px;
        height: 260px;
        min-height: 0;
        max-height: min(78vh, 560px);
        border-radius: 16px;
        overflow: hidden;
        background: white;
        box-shadow: 0 12px 30px rgba(0,0,0,.25);
        opacity: 0;
        transform: translateY(6px);
        pointer-events: none;
        transition: opacity 160ms ease, transform 160ms ease, height 160ms ease;
      }
      .ef-panel[data-show="1"]{
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .ef-panel iframe{ width:100%; height:100%; border:0; display:block; }
    `;

    // 创建外层容器，并设置当前状态。
    const wrap = document.createElement("div");
    wrap.className = "ef-wrap";
    wrap.dataset.side = side;       // 当前吸附边：left/right。
    wrap.dataset.open = "0";        // 是否打开小按钮列表。
    wrap.dataset.pinned = "0";      // 是否锁定展开。
    wrap.dataset.collapsed = "1";   // 是否处于半隐藏。
    wrap.dataset.menu = "down";     // 小按钮弹出方向：down/up。


    // 主按钮：使用 SVG 做一个简单菜单图标。
    const fab = document.createElement("div");
    fab.className = "ef-fab";
    fab.innerHTML = `
      <svg class="ef-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 7h10M7 12h10M7 17h10" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;

    // hover 保护区：扩展鼠标有效区域，避免移向小按钮时触发关闭。
    const hoverPad = document.createElement("div");
    hoverPad.className = "ef-hoverpad";

    let lastTexList = [];
    let formulaObserver = null;
    let continuousScanBtn = null;

    // 小按钮组（竖向排列）。
    const mini = document.createElement("div");
    mini.className = "ef-mini";
    const scanOnceBtn = miniBtn("Scan formulas once", "✨", () => {
      const stats = scanFormulas({ flash: true, includeText: true });
      toast(`Scan complete: found ${stats.total} formulas, newly tagged ${stats.newlyTagged}.`);
    });
    continuousScanBtn = miniBtn("Enable continuous scan", "↻", () => {
      if (formulaObserver) {
        stopFormulaObserver();
        toast("Continuous LaTeX scanning disabled");
        return;
      }

      const stats = scanFormulas({ flash: false, includeText: true });
      startFormulaObserver();
      toast(`Continuous LaTeX scanning enabled. Found ${stats.total} formulas.`);
    });
    mini.append(
      scanOnceBtn,
      continuousScanBtn,
      miniBtn("Open panel", "resources/panel.svg", () => {
        togglePanel(true);
      }),
      miniBtn("Collapse", "×", () => { wrap.dataset.open = "0"; togglePanel(false); if (wrap.dataset.pinned !== "1") collapse(); })
    );

    // 可选面板：通过 iframe 加载扩展内部页面。
    const panel = document.createElement("div");
    panel.className = "ef-panel";
    let iframe = null;

    // 组装 DOM：顺序决定层级与交互关系。
    wrap.append(hoverPad, fab, mini, panel);
    shadow.append(style, wrap);

    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type !== "PANEL_ACTION") return false;

        Promise.resolve(handlePanelAction(msg.payload?.action)).then(
          (payload) => sendResponse({ ok: true, payload }),
          (err) => sendResponse({ ok: false, error: String(err?.message || err || "Action failed") })
        );
        return true;
      });
    }

    window.addEventListener("message", (e) => {
      if (!iframe || e.source !== iframe.contentWindow) return;
      const action = e.data?.payload?.action;
      if (e.data?.type !== "ACTION" || !action) return;

      handlePanelAction(action);
      if (action === "SHOW_TOAST") toast("panel button triggered");
    });

    window.addEventListener("message", (e) => {
      if (!iframe || e.source !== iframe.contentWindow) return;
      if (e.data?.type !== "PANEL_SIZE") return;

      const nextHeight = clamp(Number(e.data.payload?.height) || 0, 180, Math.min(window.innerHeight * 0.78, 560));
      panel.style.height = `${Math.round(nextHeight)}px`;
      if (panel.dataset.show === "1") positionPanelNearFab(panel, wrap);
    });


    function sendTexList() {
      iframe?.contentWindow?.postMessage({ type: "TEX_LIST", payload: lastTexList }, "*");
    }

    function sendScanState() {
      iframe?.contentWindow?.postMessage({ type: "SCAN_STATE", payload: { continuous: Boolean(formulaObserver) } }, "*");
    }

    function updateContinuousScanButton() {
      if (!continuousScanBtn) return;
      const enabled = Boolean(formulaObserver);
      continuousScanBtn.dataset.active = enabled ? "1" : "0";
      continuousScanBtn.dataset.tip = enabled ? "Disable continuous scan" : "Enable continuous scan";
      const tip = continuousScanBtn.querySelector(".ef-tip");
      if (tip) tip.textContent = continuousScanBtn.dataset.tip;
      sendScanState();
    }

    function getPanelState() {
      return {
        title: document.title || "",
        url: location.href,
        texList: lastTexList,
        continuous: Boolean(formulaObserver)
      };
    }

    function toggleContinuousScan() {
      if (formulaObserver) {
        stopFormulaObserver();
        toast("Continuous LaTeX scanning disabled");
        return { continuous: false, stats: { total: lastTexList.length, newlyTagged: 0 } };
      }

      const stats = scanFormulas({ flash: false, includeText: true });
      startFormulaObserver();
      toast(`Continuous LaTeX scanning enabled. Found ${stats.total} formulas.`);
      return { continuous: true, stats };
    }

    function handlePanelAction(action) {
      if (action === "GET_STATE") {
        return getPanelState();
      }

      if (action === "FLASH_FORMULAS") {
        const stats = flashFormulas({ includeText: true });
        return { ...getPanelState(), stats };
      }

      if (action === "TOGGLE_CONTINUOUS_SCAN") {
        const result = toggleContinuousScan();
        return { ...getPanelState(), ...result };
      }

      if (action === "CLOSE_PANEL") {
        togglePanel(false);
        return getPanelState();
      }

      if (action === "SHOW_FLOATING_PANEL") {
        togglePanel(true);
        return getPanelState();
      }

      return getPanelState();
    }

    function scanFormulas(options = {}) {
      const { flash = false, includeText = false, cleanup = includeText } = options;
      const scope = options.scope || "viewport";
      ensureFormulaStyle();
      const stats = tagFormulasAndBindCopy({
        flash,
        includeText,
        cleanup,
        scope,
        onCopy: (ok) => toast(ok ? "Copied LaTeX" : "Copy failed. Please copy from the panel.")
      });
      lastTexList = cleanup ? stats.texList : uniqueTexList([...stats.texList, ...lastTexList]);
      stats.texList = lastTexList;
      stats.total = lastTexList.length;
      sendTexList();
      return stats;
    }

    function startFormulaObserver() {
      if (formulaObserver) return;

      let pending = false;
      let pendingIncludeText = false;
      let lastScanAt = 0;
      let scanTimer = null;
      const scheduleViewportScan = (includeText = true, delay = 500) => {
        pendingIncludeText = pendingIncludeText || includeText;
        if (pending) return;

        const elapsed = Date.now() - lastScanAt;
        pending = true;
        setTimeout(() => {
          pending = false;
          lastScanAt = Date.now();
          const shouldIncludeText = pendingIncludeText;
          pendingIncludeText = false;
          scanFormulas({
            flash: false,
            includeText: shouldIncludeText,
            cleanup: false,
            scope: "viewport"
          });
        }, Math.max(delay, 900 - elapsed));
      };

      formulaObserver = new MutationObserver((mutations) => {
        const hasUsefulChange = mutations.some((m) => {
          if (isNodeInEditableField(m.target)) return false;
          if (m.type === "attributes") {
            return nodeMayContainFormula(m.target) || formulaAttributeMayContainTex(m.target, m.attributeName);
          }
          if (m.type === "characterData") {
            return textMayContainFormula(m.target?.textContent || "");
          }
          return Array.from(m.addedNodes || []).slice(0, 20).some((node) => {
            return nodeMayContainFormula(node);
          });
        });

        if (!hasUsefulChange || pending) return;
        scheduleViewportScan(true, 800);
      });

      formulaObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-tex", "data-latex", "data-latex-display", "data-latex-source", "data-math", "data-mathml", "data-value", "data-formula", "data-equation", "aria-label", "title"],
        childList: true,
        subtree: true,
        characterData: true
      });

      const onScroll = () => scheduleViewportScan(true, 350);
      const onResize = () => scheduleViewportScan(true, 350);
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") scheduleViewportScan(true, 250);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize, { passive: true });
      document.addEventListener("visibilitychange", onVisibilityChange);
      scanTimer = window.setInterval(() => {
        if (document.visibilityState !== "hidden") scheduleViewportScan(true, 1200);
      }, 2500);
      formulaObserver.__stopFormulaViewportScan = () => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (scanTimer) window.clearInterval(scanTimer);
      };
      updateContinuousScanButton();

      function nodeMayContainFormula(node) {
        if (!node || isNodeInEditableField(node)) return false;
        if (node.nodeType === Node.TEXT_NODE) return textMayContainFormula(node.textContent || "");
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        if (isExtensionElement(node)) return false;
        if (node.matches?.(FORMULA_CANDIDATE_SELECTOR)) return true;
        if (node.querySelector?.(FORMULA_CANDIDATE_SELECTOR)) return true;
        if (node.shadowRoot?.querySelector?.(FORMULA_CANDIDATE_SELECTOR)) return true;
        if (formulaAttributeMayContainTex(node, "data-tex")) return true;
        if (formulaAttributeMayContainTex(node, "data-latex")) return true;
        if (formulaAttributeMayContainTex(node, "data-latex-display")) return true;
        if (formulaAttributeMayContainTex(node, "data-latex-source")) return true;
        if (formulaAttributeMayContainTex(node, "data-math")) return true;
        if (formulaAttributeMayContainTex(node, "data-mathml")) return true;
        if (formulaAttributeMayContainTex(node, "data-value")) return true;
        if (formulaAttributeMayContainTex(node, "data-formula")) return true;
        if (formulaAttributeMayContainTex(node, "data-equation")) return true;
        if (formulaAttributeMayContainTex(node, "aria-label")) return true;
        if (formulaAttributeMayContainTex(node, "title")) return true;
        return textMayContainFormula(node.textContent || "");
      }

      function formulaAttributeMayContainTex(node, attrName) {
        if (!node?.getAttribute || !attrName) return false;
        if (attrName === "class") return node.matches?.(FORMULA_CONTAINER_SELECTOR) || node.querySelector?.(FORMULA_CONTAINER_SELECTOR);
        const raw = node.getAttribute(attrName) || "";
        if (!raw) return false;
        if (/^(?:data-tex|data-latex|data-latex-source|data-latex-display|data-math|data-mathml|data-value|data-formula|data-equation)$/i.test(attrName)) return true;
        return textMayContainFormula(raw) || /(?:latex|tex|formula)/i.test(raw);
      }

      function textMayContainFormula(text) {
        const value = String(text || "");
        if (!value) return false;
        if (value.length <= 4000) return maybeContainsLatex(value);
        return maybeContainsLatex(value.slice(0, 4000)) || maybeContainsLatex(value.slice(-4000));
      }
    }

    function stopFormulaObserver() {
      if (!formulaObserver) return;
      formulaObserver.__stopFormulaViewportScan?.();
      formulaObserver.disconnect();
      formulaObserver = null;
      updateContinuousScanButton();
    }


    function ensurePanelIframe() {
      if (iframe) return;

      iframe = document.createElement("iframe");
      iframe.src = chrome.runtime.getURL("panel.html");
      panel.appendChild(iframe);
      iframe.addEventListener("load", () => {
        iframe.contentWindow?.postMessage?.(
          { type: "CONTEXT", payload: { url: location.href, title: document.title, side: wrap.dataset.side } },
          "*"
        );

        sendTexList();
        sendScanState();
      });
    }

    // —— 1) hover 展开/收起（带一点延迟，手感更稳）
    let hideTimer = null; // 延迟收起用的定时器。
    function expandTemp() {
      if (hideTimer) clearTimeout(hideTimer); // 进入时取消即将收起。
      wrap.dataset.open = "1";                // 展开小按钮。
      wrap.dataset.collapsed = "0";          // 主按钮完全露出。
    }
    function scheduleCollapseIfNotPinned() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (wrap.dataset.pinned === "1") return; // 已锁定时不收起。
        wrap.dataset.open = "0";                 // 关闭小按钮。
        togglePanel(false);                      // 关闭面板。
        collapse();                               // 恢复半隐藏。
      }, 180);
    }
    function collapse() {
      wrap.dataset.collapsed = "1"; // 切换到半隐藏状态。
    }

    // 鼠标进入：如果没锁定，就临时展开。
    wrap.addEventListener("mouseenter", () => {
      if (wrap.dataset.pinned === "1") return;
      expandTemp();
    });
    // 鼠标离开：如果没锁定，就延迟收起。
    wrap.addEventListener("mouseleave", () => {
      if (wrap.dataset.pinned === "1") return;
      scheduleCollapseIfNotPinned();
    });

    // —— 2) 点击主按钮：锁定常驻 / 再点解除
    fab.addEventListener("click", () => {
      if (wrap.__dragJustEnded) return; // 刚结束拖拽时避免误触发点击。

      const pinned = wrap.dataset.pinned === "1";
      if (!pinned) {
        wrap.dataset.pinned = "1";     // 锁定展开。
        wrap.dataset.open = "1";       // 展开小按钮。
        wrap.dataset.collapsed = "0"; // 主按钮完全露出。
      } else {
        wrap.dataset.pinned = "0";     // 解除锁定。
        wrap.dataset.open = "0";       // 收起小按钮。
        togglePanel(false);            // 关闭面板。
        collapse();                    // 半隐藏。
      }
    });

    // —— 3) 拖拽 + 吸边
    let dragging = false; // 当前是否处于拖拽状态。
    let startX = 0, startY = 0; // 拖拽起点坐标。
    let startTop = 0; // 拖拽开始时的 top 值。
    let raf = 0; // requestAnimationFrame 句柄。

    fab.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return; // 只处理鼠标左键。
      dragging = true;
      wrap.__dragJustEnded = false; // 标记拖拽开始。

      fab.setPointerCapture(ev.pointerId); // 捕获指针，避免拖拽时丢失事件。
      startX = ev.clientX;
      startY = ev.clientY;
      startTop = wrap.getBoundingClientRect().top; // 记录拖拽开始位置。

      // 拖拽时先收起，避免按钮弹出干扰。
      wrap.dataset.open = "0";
      wrap.dataset.pinned = "0";
      togglePanel(false);
      wrap.dataset.collapsed = "0"; // 拖拽时完全露出。

      ev.preventDefault(); // 阻止默认行为，避免选择文字等。
    });

    fab.addEventListener("pointermove", (ev) => {
      if (!dragging) return;

      const dy = ev.clientY - startY; // 计算垂直位移。
      const newTop = clamp(startTop + dy, TOP_MARGIN, window.innerHeight - FAB_SIZE - BOTTOM_MARGIN);

      // 根据当前鼠标 x 位置判断吸附到左侧还是右侧。
      const newSide = (ev.clientX < window.innerWidth / 2) ? "left" : "right";

      if (raf) cancelAnimationFrame(raf); // 取消上一帧更新，避免抖动。
        raf = requestAnimationFrame(() => {
          wrap.style.top = `${newTop}px`;   // 更新垂直位置。
          wrap.style.left = "auto";        // 先清空左右定位。
          wrap.style.right = "auto";
          wrap.style[newSide] = `${EDGE_MARGIN}px`; // 设置吸附边。
          wrap.dataset.side = newSide;      // 更新数据状态。
          updateMenuDir();
        });
      });

    fab.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;

      const rect = wrap.getBoundingClientRect();
      const finalTop = clamp(rect.top, TOP_MARGIN, window.innerHeight - FAB_SIZE - BOTTOM_MARGIN);
      const finalSide = wrap.dataset.side;

      updateMenuDir();

      // 保存最终位置，供下次进入页面恢复。
      chrome.storage?.local?.set?.({ edgeFabState: { side: finalSide, top: Math.round(finalTop) } });

      // 防止拖拽结束瞬间触发点击。
      wrap.__dragJustEnded = true;
      setTimeout(() => { wrap.__dragJustEnded = false; }, 120);

      // 松手后恢复半隐藏。
      wrap.dataset.collapsed = "1";
    });

    // 监听窗口尺寸变化，避免组件位置超出可视区域。
    window.addEventListener("resize", () => {
      const rect = wrap.getBoundingClientRect();
      const fixedTop = clamp(rect.top, TOP_MARGIN, window.innerHeight - FAB_SIZE - BOTTOM_MARGIN);
      wrap.style.top = `${fixedTop}px`;
      updateMenuDir();
      chrome.storage?.local?.set?.({ edgeFabState: { side: wrap.dataset.side, top: Math.round(fixedTop) } });
    });

    // 初始状态：半隐藏。
    collapse();
    updateMenuDir();

    // --- 小工具函数：创建小按钮。
    function miniBtn(tip, icon, onClick) {
      const b = document.createElement("div");
      b.className = "ef-btn";
      b.dataset.tip = tip;

      const tipEl = document.createElement("div");
      tipEl.className = "ef-tip";
      tipEl.textContent = tip;

      let contentEl;

      if (icon instanceof HTMLElement) {
        // 直接传了 DOM 节点
        contentEl = icon;
      } else if (typeof icon === "string") {
        const s = icon.trim();

        const looksLikeUrl =
          /^https?:\/\//i.test(s) ||
          s.startsWith("chrome-extension://") ||
          s.startsWith("data:image/");

        const isImage =
          looksLikeUrl || /\.(svg|png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(s);

        if (isImage) {
          const img = document.createElement("img");
          // 如果不是 URL（比如 resources/panel.svg），用 runtime.getURL 转成扩展资源 URL
          img.src = looksLikeUrl ? s : chrome.runtime.getURL(s);
          img.alt = tip;
          img.style.width = "18px";
          img.style.height = "18px";
          img.draggable = false;
          contentEl = img;
        } else {
          // 纯文本图标
          const span = document.createElement("span");
          span.textContent = s;
          contentEl = span;
        }
      } else {
        // 兜底
        const span = document.createElement("span");
        span.textContent = "•";
        contentEl = span;
      }

      b.append(tipEl, contentEl);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    }


    function updateMenuDir() {
      const wr = wrap.getBoundingClientRect();

      // 估算菜单高度：小按钮数量 + 间距 + 上下余量
      const menuH = (MINI_SIZE * MINI_BUTTON_COUNT) + (GAP * (MINI_BUTTON_COUNT - 1)) + 16;
      const spaceBelow = window.innerHeight - wr.bottom;
      const spaceAbove = wr.top;

      wrap.dataset.menu = (spaceBelow < menuH && spaceAbove > spaceBelow) ? "up" : "down";
    }

    // 控制面板显隐。
    function togglePanel(show) {
      panel.dataset.show = show ? "1" : "0";
      if (show) {
        ensurePanelIframe();
        updateMenuDir();
        wrap.dataset.open = "1";
        wrap.dataset.collapsed = "0";
        positionPanelNearFab(panel, wrap);
        iframe?.contentWindow?.postMessage({ type: "REQUEST_PANEL_SIZE" }, "*");
      }
    }

    // 高亮页面中的公式元素。
    function flashFormulas(options = {}) {
      const stats = scanFormulas({ flash: true, includeText: Boolean(options.includeText) });
      const nodes = stats.elements;
      if (!nodes.length) {
        toast("No formula elements found");
        return stats;
      }

      const STYLE_ID = "__edge_fab_flash_style__";
      if (!document.getElementById(STYLE_ID)) {
        const s = document.createElement("style");
        s.id = STYLE_ID;
        s.textContent = `
          @keyframes __edgeFabFlash {
            0%   { outline: 2px solid rgba(0, 180, 0, 1); }
            100% { outline: 2px solid rgba(0, 180, 0, 0); }
          }
          .__edge_fab_flash__ { animation: __edgeFabFlash 900ms ease-out; }
        `;
        document.documentElement.appendChild(s);
      }
      nodes.forEach((el) => {
        el.classList.remove("__edge_fab_flash__"); // 清理旧动画类。
        void el.offsetWidth;                        // 强制回流，确保动画重新触发。
        el.classList.add("__edge_fab_flash__");    // 加入动画类。
        setTimeout(() => el.classList.remove("__edge_fab_flash__"), 950); // 动画结束后移除。
      });
      toast(`Tagged ${stats.total} formulas`);
      return stats;
    }

    // 页面右下角提示泡泡。
    function toast(text) {
      const id = "__edge_fab_toast__";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        Object.assign(el.style, {
          position: "fixed",
          right: "16px",
          bottom: "16px",
          zIndex: String(Z),
          padding: "10px 12px",
          borderRadius: "10px",
          background: "rgba(0,0,0,.82)",
          color: "white",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          fontSize: "13px",
          pointerEvents: "none",
          maxWidth: "60vw",
          opacity: "0",
          transform: "translateY(6px)",
          transition: "opacity 120ms ease, transform 120ms ease"
        });
        document.documentElement.appendChild(el);
      }
      el.textContent = text; // 设置提示文本。
      requestAnimationFrame(() => {
        el.style.opacity = "1";        // 淡入。
        el.style.transform = "translateY(0)";
      });
      setTimeout(() => {
        el.style.opacity = "0";        // 淡出。
        el.style.transform = "translateY(6px)";
      }, 1200);
    }
  }
})();


const FORMULA_CONTAINER_SELECTOR = ".math-block, .math-inline, .katex-display, .katex, .MathJax, mjx-container, math";
const FORMULA_CANDIDATE_SELECTOR = [
  FORMULA_CONTAINER_SELECTOR,
  "annotation[encoding]",
  'script[type^="math/tex" i]',
  "[data-tex]",
  "[data-latex]",
  "[data-latex-display]",
  "[data-latex-source]",
  "[data-math]",
  "[data-mathml]",
  "[data-value]",
  "[data-formula]",
  "[data-equation]",
  '[aria-label*="latex" i]',
  '[title*="latex" i]'
].join(",");
const FORMULA_TEX_ATTR = "data-ext-formula-tex";
const FORMULA_ID_ATTR = "data-ext-formula-element-id";
const FORMULA_ORIGINAL_TITLE_ATTR = "data-ext-formula-original-title";
const MAX_ATTRIBUTE_SCAN_NODES = 70;
const MAX_TEXT_SCAN_NODES = 36;
const MAX_DOM_SCAN_NODES = 320;
const MAX_TEXT_SCAN_MS = 10;
const MAX_FORMULA_RECORDS = 80;
const MAX_VIEWPORT_SCAN_ROOTS = 48;
const MAX_VIEWPORT_DATA_MATH_NODES = 220;
const MAX_VIEWPORT_ATTRIBUTE_SCAN_NODES = 240;
const MAX_VIEWPORT_TEXT_SCAN_NODES = 110;
const MAX_VIEWPORT_DOM_SCAN_NODES = 2200;
const MAX_VIEWPORT_TEXT_SCAN_MS = 28;
const MAX_VIEWPORT_AGGREGATE_TEXT_ELEMENTS = 80;
const MAX_VIEWPORT_AGGREGATE_TEXT_LENGTH = 20000;
const VIEWPORT_CONTENT_ROOT_SELECTOR = [
  '[data-message-author-role]',
  '[role="article"]',
  "article",
  "section",
  ".markdown",
  ".markdown-body",
  ".prose",
  "message-content",
  "model-response",
  ".model-response-text",
  ".response-content"
].join(", ");
const VIEWPORT_BLOCK_ROOT_SELECTOR = ["p", "li", "blockquote", "pre", "code"].join(", ");
const EDITABLE_FIELD_SELECTOR = [
  "textarea",
  "input",
  "select",
  "option",
  '[role="textbox"]',
  ".ql-editor",
  ".ProseMirror",
  ".cm-content",
  ".monaco-editor",
  '[data-slate-editor="true"]'
].join(",");
const FORMULA_TEXT_AGGREGATE_SELECTOR = [
  "p",
  "li",
  "blockquote",
  "pre",
  "code",
  "span",
  "div",
  "article",
  "section",
  ".markdown",
  ".markdown-body",
  ".prose",
  "message-content",
  "model-response",
  ".model-response-text",
  ".response-content"
].join(",");

function extractTexListFromPage() {
  return uniqueTexList(collectFormulaRecords().map((record) => record.tex));
}

function ensureFormulaStyle() {
  const STYLE_ID = "__ext_formula_hover_style__";
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .ext-formula-hover {
      cursor: copy !important;
      border-radius: 4px;
    }
    .ext-formula-hover:hover {
      outline: 2px solid #000 !important;
      outline-offset: 2px !important;
    }

    .ext-formula-flash { animation: extFormulaFlash 1s ease-out forwards; }
    @keyframes extFormulaFlash {
      0%   { box-shadow: 0 0 0 2px rgba(0,255,0,1); }
      100% { box-shadow: 0 0 0 2px rgba(0,0,0,0); }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function ensureKatexStyle() {
  ensureFormulaStyle();
}

function tagKatexAndBindCopy(options = {}) {
  return tagFormulasAndBindCopy(options);
}

function tagFormulasAndBindCopy(options = {}) {
  const { flash = true, includeText = true, cleanup = true, scope = "viewport", onCopy } = options;
  const records = collectFormulaRecords({ includeText, scope });
  const texList = uniqueTexList(records.map((record) => record.tex));
  const elementTex = new Map();
  let newlyTagged = 0;

  bindFormulaCopyDelegate(onCopy);

  for (const record of records) {
    if (!record.bindable || !record.element?.isConnected) continue;
    const list = elementTex.get(record.element) || [];
    list.push(record.tex);
    elementTex.set(record.element, uniqueTexList(list));
  }

  for (const [el, texValues] of elementTex) {
    const tex = texValues.join("\n\n");

    if (!el.classList.contains("ext-formula-hover")) {
      el.classList.add("ext-formula-hover");
      newlyTagged++;
    }

    el.setAttribute(FORMULA_TEX_ATTR, tex);
    setFormulaElementTitle(el, tex);

    if (flash) {
      el.classList.remove("ext-formula-flash");
      void el.offsetWidth;
      el.classList.add("ext-formula-flash");
    }
  }

  if (flash) {
    setTimeout(() => {
      for (const el of elementTex.keys()) el.classList.remove("ext-formula-flash");
    }, 1000);
  }

  if (cleanup) cleanupStaleFormulaTags(elementTex);

  return {
    total: texList.length,
    newlyTagged,
    texList,
    elements: Array.from(elementTex.keys())
  };
}

function collectFormulaRecords(options = {}) {
  const { includeText = true, scope = "document" } = options;
  const records = [];
  const roots = scope === "viewport" ? getViewportScanRoots() : [document];

  collectFromAnnotations(records, roots, scope);
  if (scope !== "viewport" && records.length >= MAX_FORMULA_RECORDS) return dedupeRecords(records);
  collectFromMathJaxScripts(records, roots, scope);
  if (scope !== "viewport" && records.length >= MAX_FORMULA_RECORDS) return dedupeRecords(records);
  collectFromMathMl(records, roots, scope);
  if (scope !== "viewport" && records.length >= MAX_FORMULA_RECORDS) return dedupeRecords(records);
  collectFromDataMath(records, roots, scope);
  if (scope !== "viewport" && records.length >= MAX_FORMULA_RECORDS) return dedupeRecords(records);
  collectFromRenderedMath(records, roots, scope);
  if (scope !== "viewport" && records.length >= MAX_FORMULA_RECORDS) return dedupeRecords(records);
  collectFromFormulaAttributes(records, roots, scope);
  if (scope !== "viewport" && records.length >= MAX_FORMULA_RECORDS) return dedupeRecords(records);
  if (includeText) collectFromDelimitedText(records, roots, scope);

  const deduped = dedupeRecords(records);
  sortFormulaRecords(deduped, scope);
  return deduped.slice(0, MAX_FORMULA_RECORDS);
}

function collectFromAnnotations(records, roots = [document], scope = "document") {
  for (const root of roots) {
    for (const ann of queryWithin(root, "annotation[encoding]")) {
      if (records.length >= MAX_FORMULA_RECORDS * 3) return;
      const encoding = ann.getAttribute("encoding") || "";
      if (!isTexEncoding(encoding)) continue;
      addFormulaRecord(records, findFormulaElementFor(ann), ann.textContent, "annotation", true, ann, scope);
    }
  }
}

function collectFromMathJaxScripts(records, roots = [document], scope = "document") {
  for (const root of roots) {
    for (const script of queryWithin(root, 'script[type^="math/tex" i]')) {
      if (records.length >= MAX_FORMULA_RECORDS * 3) return;
      const target = findRenderedMathJaxElement(script) || script.parentElement;
      addFormulaRecord(records, target, script.textContent, "mathjax-script", true, script, scope);
    }
  }
}

function collectFromMathMl(records, roots = [document], scope = "document") {
  for (const root of roots) {
    for (const math of queryWithin(root, "math")) {
      if (records.length >= MAX_FORMULA_RECORDS * 3) return;
      if (isExtensionElement(math) || isInEditableField(math)) continue;
      if (hasTexAnnotation(math)) continue;

      const tex = mathMlToTex(math);
      if (!tex) continue;
      addFormulaRecord(records, findFormulaElementFor(math), tex, "mathml", true, math, scope);
    }
  }
}

function collectFromDataMath(records, roots = [document], scope = "document") {
  if (records.length >= MAX_FORMULA_RECORDS * 3) return;

  const attrNames = [
    "data-math",
    "data-mathml",
    "data-latex-display",
    "data-formula",
    "data-equation",
    "data-value"
  ];
  const selector = attrNames.map((attr) => `[${attr}]`).join(",");
  const maxCandidates = scope === "viewport" ? MAX_VIEWPORT_DATA_MATH_NODES : MAX_FORMULA_RECORDS * 3;
  const maxVisited = scope === "viewport" ? Number.POSITIVE_INFINITY : MAX_ATTRIBUTE_SCAN_NODES;
  const maxAttrLength = scope === "viewport" ? 12000 : 3200;
  const candidates = [];
  const seenElements = new WeakSet();
  let visited = 0;

  for (const root of roots) {
    for (const el of queryWithin(root, selector)) {
      if (seenElements.has(el)) continue;
      seenElements.add(el);
      if (++visited > maxVisited) break;
      if (isExtensionElement(el) || isInEditableField(el)) continue;

      for (const attrName of attrNames) {
        const raw = el.getAttribute(attrName);
        if (!raw || raw.length > maxAttrLength) continue;

        if (attrName === "data-mathml") {
          const mathMlValues = extractTexFromMathMlString(raw);
          if (mathMlValues.length) {
            for (const tex of mathMlValues) queueDataMathCandidate(candidates, el, tex, "mathml", scope);
            continue;
          }
        }

        const values = extractTexCandidatesFromText(raw, attrName);
        const directValue = stripLatexLabel(raw);
        if (values.length) {
          for (const tex of values) queueDataMathCandidate(candidates, el, tex, attrName, scope);
        } else if (isLikelyTex(directValue, attrName)) {
          queueDataMathCandidate(candidates, el, directValue, attrName, scope);
        }

        if (candidates.length >= maxCandidates) break;
      }

      if (candidates.length >= maxCandidates) break;
    }

    if (visited > maxVisited || candidates.length >= maxCandidates) break;
  }

  sortQueuedFormulaCandidates(candidates);
  for (const candidate of candidates) {
    if (records.length >= MAX_FORMULA_RECORDS * 3) return;
    addFormulaRecord(records, candidate.element, candidate.tex, candidate.source, true, candidate.element, scope);
  }
}

function queueDataMathCandidate(candidates, el, rawTex, source, scope) {
  const tex = normalizeTex(stripLatexLabel(rawTex || ""));
  if (!tex || !isLikelyTex(tex, source)) return;

  const target = normalizeFormulaElement(el);
  const distance = scope === "viewport" ? getFormulaViewportDistance(target, el, source) : 0;
  if (scope === "viewport" && distance === Number.POSITIVE_INFINITY) return;

  candidates.push({
    element: el,
    tex,
    source,
    distance,
    priority: getFormulaRecordPriority(target, tex, source)
  });
}

function hasTexAnnotation(math) {
  for (const ann of math.querySelectorAll?.("annotation[encoding]") || []) {
    if (isTexEncoding(ann.getAttribute("encoding") || "") && normalizeTex(ann.textContent || "")) return true;
  }
  return false;
}

function collectFromRenderedMath(records, roots = [document], scope = "document") {
  const selector = 'mjx-container, .MathJax, [data-mml-node="math"], mjx-math';

  for (const root of roots) {
    for (const el of queryWithin(root, selector)) {
      if (records.length >= MAX_FORMULA_RECORDS * 3) return;
      if (isExtensionElement(el) || isInEditableField(el)) continue;
      if (el.querySelector?.("annotation[encoding], math annotation[encoding]")) continue;

      const tex = renderedMathToTex(el);
      if (!tex) continue;
      addFormulaRecord(records, findFormulaElementFor(el), tex, "rendered-math", true, el, scope);
    }
  }
}

function extractTexFromMathMlString(value) {
  const raw = String(value || "");
  if (!/<math[\s>]/i.test(raw) || typeof DOMParser === "undefined") return [];

  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const values = [];
    for (const math of doc.querySelectorAll("math")) {
      const tex = mathMlToTex(math);
      if (tex && isLikelyTex(tex, "mathml")) values.push(tex);
    }
    return uniqueTexList(values);
  } catch {
    return [];
  }
}

function collectFromFormulaAttributes(records, roots = [document], scope = "document") {
  if (records.length >= MAX_FORMULA_RECORDS * 3) return;

  const attrNames = [
    "data-tex",
    "data-latex",
    "data-latex-display",
    "data-latex-source",
    "data-source",
    "data-original",
    "data-content",
    "data-text",
    "data-raw",
    "data-markdown",
    "data-expression",
    "data-asciimath",
    "aria-label",
    "aria-description",
    "alt",
    "title"
  ];

  const selector = [
    "[data-tex]",
    "[data-latex]",
    "[data-latex-display]",
    "[data-latex-source]",
    "[data-source]",
    "[data-original]",
    "[data-content]",
    "[data-text]",
    "[data-raw]",
    "[data-markdown]",
    "[data-expression]",
    "[data-asciimath]",
    "[aria-label]",
    "[aria-description]",
    "[alt]",
    "[title]",
    '[aria-label*="latex" i]',
    '[aria-label*="formula" i]',
    '[title*="latex" i]',
    '[title*="formula" i]'
  ].join(",");

  const maxScanned = scope === "viewport" ? MAX_VIEWPORT_ATTRIBUTE_SCAN_NODES : MAX_ATTRIBUTE_SCAN_NODES;
  const maxAttrLength = scope === "viewport" ? 12000 : 3200;
  let scanned = 0;
  for (const root of roots) {
    for (const el of queryWithin(root, selector)) {
      if (records.length >= MAX_FORMULA_RECORDS * 3) return;
      if (++scanned > maxScanned) return;
      if (isExtensionElement(el)) continue;
      if (isInEditableField(el)) continue;

      for (const attrName of attrNames) {
        const raw = el.getAttribute(attrName);
        if (!raw) continue;
        if (raw.length > maxAttrLength) continue;

        const mathMlValues = extractTexFromMathMlString(raw);
        if (mathMlValues.length) {
          mathMlValues.forEach((tex) => addFormulaRecord(records, el, tex, "mathml", true, el, scope));
          continue;
        }

        const values = extractTexCandidatesFromText(raw, attrName);
        const directValue = stripLatexLabel(raw);
        if (values.length) {
          values.forEach((tex) => addFormulaRecord(records, el, tex, "delimited-formula", true, el, scope));
        } else if (isLikelyTex(directValue, attrName)) {
          addFormulaRecord(records, el, directValue, attrName, true, el, scope);
        }
      }
    }
  }
}

function collectFromDelimitedText(records, roots = [document.body], scope = "document") {
  if (!document.body) return;
  if (records.length >= MAX_FORMULA_RECORDS * 3) return;
  const start = performance.now();
  const textNodes = [];
  const aggregateElements = [];
  const aggregateSeen = new WeakSet();
  const stack = roots.length ? roots.slice().reverse() : [];
  const visitedNodes = new WeakSet();
  const maxDomNodes = scope === "viewport" ? MAX_VIEWPORT_DOM_SCAN_NODES : MAX_DOM_SCAN_NODES;
  const maxTextNodes = scope === "viewport" ? MAX_VIEWPORT_TEXT_SCAN_NODES : MAX_TEXT_SCAN_NODES;
  const maxScanMs = scope === "viewport" ? MAX_VIEWPORT_TEXT_SCAN_MS : MAX_TEXT_SCAN_MS;
  let visited = 0;

  while (stack.length) {
    if (++visited > maxDomNodes) break;
    if (performance.now() - start > maxScanMs) break;

    const node = stack.pop();
    if (!node) continue;
    if (typeof node === "object") {
      if (visitedNodes.has(node)) continue;
      visitedNodes.add(node);
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (!maybeContainsLatex(text)) continue;

      const parent = node.parentElement;
      if (!parent || isExtensionElement(parent)) continue;
      if (parent.closest("script, style, textarea, input, select, option, noscript")) continue;
      if (isInEditableField(parent)) continue;
      if (parent.closest(FORMULA_CONTAINER_SELECTOR)) continue;
      if (!isElementVisible(parent)) continue;

      textNodes.push(node);
      if (textNodes.length >= maxTextNodes) break;
      continue;
    }

    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_NODE
    ) continue;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (isExtensionElement(node)) continue;
      if (node.matches?.("script, style, textarea, input, select, option, noscript")) continue;
      if (isInEditableField(node)) continue;
      if (node.matches?.(FORMULA_CONTAINER_SELECTOR)) continue;
      queueAggregateTextElement(node);
      if (node.shadowRoot) stack.push(node.shadowRoot);
    }

    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  for (const node of textNodes) {
    if (records.length >= MAX_FORMULA_RECORDS * 3) break;
    const parent = node.parentElement;
    const values = extractTexCandidatesFromText(node.textContent || "", "page-text");
    if (!values.length) continue;

    const bindable = shouldBindTextFormula(parent, node.textContent || "", values);
    values.forEach((tex) => {
      addFormulaRecord(records, bindable ? parent : null, tex, "text-delimiter", bindable, node, scope);
    });
  }

  collectFromAggregateTextElements(records, aggregateElements, scope);

  function queueAggregateTextElement(el) {
    if (scope !== "viewport") return;
    if (!el.matches?.(FORMULA_TEXT_AGGREGATE_SELECTOR)) return;
    if (aggregateElements.length >= MAX_VIEWPORT_AGGREGATE_TEXT_ELEMENTS) return;
    if (aggregateSeen.has(el)) return;
    if (!isElementNearViewport(el, getViewportScanMargin())) return;

    const text = el.textContent || "";
    if (text.length < 4 || text.length > MAX_VIEWPORT_AGGREGATE_TEXT_LENGTH) return;
    if (!maybeContainsLatex(text)) return;

    aggregateSeen.add(el);
    aggregateElements.push(el);
  }
}

function collectFromAggregateTextElements(records, elements, scope) {
  if (!elements.length) return;

  const emitted = [];
  const sorted = elements.slice().sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const areaA = Math.max(1, ra.width * ra.height);
    const areaB = Math.max(1, rb.width * rb.height);
    if (areaA !== areaB) return areaA - areaB;
    return ra.top - rb.top;
  });

  for (const el of sorted) {
    if (records.length >= MAX_FORMULA_RECORDS * 3) break;

    const text = el.textContent || "";
    const values = extractTexCandidatesFromText(text, "page-text");
    if (!values.length) continue;

    const keys = values.map((tex) => normalizeTex(tex).replace(/\s+/g, " "));
    if (emitted.some((item) => el.contains(item.el) && keys.every((key) => item.keys.has(key)))) continue;

    const bindable = shouldBindTextFormula(el, text, values);
    values.forEach((tex) => {
      addFormulaRecord(records, bindable ? el : null, tex, "delimited-formula", bindable, el, scope);
    });
    emitted.push({ el, keys: new Set(keys) });
  }
}

function getViewportScanRoots() {
  if (!document.body) return [document];

  const nodes = collectViewportRootCandidates();

  const roots = [];
  const seen = new Set();
  for (const node of nodes) {
    if (!node || seen.has(node)) continue;
    seen.add(node);
    roots.push(node);
    if (roots.length >= MAX_VIEWPORT_SCAN_ROOTS) break;
  }

  return roots;
}

function collectViewportRootCandidates() {
  const seen = new Set();
  const fallbackSeen = new Set();
  const nodes = [];
  const fallbackNodes = [];
  const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  const xs = [0.12, 0.28, 0.5, 0.72, 0.88].map((ratio) => Math.round(width * ratio));
  const ys = [0.05, 0.14, 0.25, 0.36, 0.5, 0.64, 0.75, 0.86, 0.95].map((ratio) => Math.round(height * ratio));
  const semanticRootSelector = `${VIEWPORT_CONTENT_ROOT_SELECTOR}, ${VIEWPORT_BLOCK_ROOT_SELECTOR}, td, th`;

  const canUse = (el) => {
    if (!el) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (isExtensionElement(el) || isInEditableField(el)) return false;
    return isElementNearViewport(el, getViewportScanMargin());
  };

  const addFallback = (el) => {
    if (!canUse(el) || fallbackSeen.has(el)) return;
    fallbackSeen.add(el);
    fallbackNodes.push(el);
  };

  const add = (el) => {
    if (!canUse(el) || seen.has(el)) return;
    addFallback(el);

    const text = el.textContent || "";
    const hasFormulaCandidate = el.matches?.(FORMULA_CANDIDATE_SELECTOR) || el.querySelector?.(FORMULA_CANDIDATE_SELECTOR);
    if (!hasFormulaCandidate && (text.length > 6000 || !maybeContainsLatex(text))) return;

    seen.add(el);
    nodes.push(el);
  };

  const sortByPriority = (list) => list.sort((a, b) => {
    const pa = getViewportRootPriority(a);
    const pb = getViewportRootPriority(b);
    if (pa !== pb) return pb - pa;

    const da = getViewportDistance(a);
    const db = getViewportDistance(b);
    if (da !== db) return da - db;

    const sa = a.getBoundingClientRect();
    const sb = b.getBoundingClientRect();
    const areaA = Math.max(1, sa.width * sa.height);
    const areaB = Math.max(1, sb.width * sb.height);
    if (areaA !== areaB) return areaA - areaB;

    return sa.top - sb.top;
  });

  collectViewportFormulaRoots(add);

  for (const x of xs) {
    for (const y of ys) {
      const stack = document.elementsFromPoint(x, y).slice(0, 8);
      for (const hit of stack) {
        if (!hit || hit === document.body || hit === document.documentElement) continue;

        add(hit.closest?.(FORMULA_CONTAINER_SELECTOR));
        add(hit.closest?.(semanticRootSelector));

        let cur = hit;
        for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) add(cur);
      }
    }
  }

  sortByPriority(fallbackNodes);
  sortByPriority(nodes);
  return uniqueElementList([...nodes, ...fallbackNodes]).slice(0, MAX_VIEWPORT_SCAN_ROOTS);
}

function collectViewportFormulaRoots(add) {
  for (const el of document.querySelectorAll(FORMULA_CANDIDATE_SELECTOR)) {
    if (isExtensionElement(el) || isInEditableField(el)) continue;

    const target = findFormulaElementFor(el) || el;
    if (target && isElementNearViewport(target, getViewportScanMargin())) {
      add(target);
    }
  }
}

function uniqueElementList(values) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function queryWithin(root, selector) {
  if (!root) return [];
  const out = [];
  if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(selector)) out.push(root);
  if (root.querySelectorAll) out.push(...root.querySelectorAll(selector));
  if (root.nodeType === Node.ELEMENT_NODE && root.shadowRoot) out.push(...queryWithin(root.shadowRoot, selector));
  return out;
}

function addFormulaRecord(records, element, rawTex, source, bindable = true, sourceNode = null, scope = "document") {
  const tex = normalizeTex(stripLatexLabel(rawTex || ""));
  if (!tex || !isLikelyTex(tex, source)) return;

  const target = normalizeFormulaElement(element);
  const distance = scope === "viewport" ? getFormulaViewportDistance(target, sourceNode, source) : 0;
  if (scope === "viewport" && distance === Number.POSITIVE_INFINITY) return;
  records.push({
    element: target,
    tex,
    source,
    bindable: Boolean(bindable && target),
    distance,
    priority: getFormulaRecordPriority(target, tex, source)
  });
}

function normalizeFormulaElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  if (isExtensionElement(element)) return null;
  if (element === document.body || element === document.documentElement) return null;
  if (isInEditableField(element)) return null;
  return findFormulaElementFor(element) || element;
}

function findFormulaElementFor(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!el) return null;
  return el.closest(".math-block") ||
    el.closest(".math-inline") ||
    el.closest(".katex-display") ||
    el.closest(".katex") ||
    el.closest("mjx-container") ||
    el.closest(".MathJax") ||
    el.closest("math") ||
    el;
}

function findRenderedMathJaxElement(script) {
  const id = script.id;
  if (id) {
    const byFrameId = document.getElementById(`${id}-Frame`);
    if (byFrameId) return byFrameId;

    const escapedFrameId = window.CSS?.escape?.(`${id}-Frame`);
    if (escapedFrameId) {
      const byEscapedId = document.querySelector(`#${escapedFrameId}`);
      if (byEscapedId) return byEscapedId;
    }
  }

  let el = script.nextElementSibling;
  for (let i = 0; el && i < 5; i++, el = el.nextElementSibling) {
    if (el.matches?.(".MathJax, mjx-container, .katex, .katex-display, math")) return el;
  }

  el = script.previousElementSibling;
  for (let i = 0; el && i < 5; i++, el = el.previousElementSibling) {
    if (el.matches?.(".MathJax, mjx-container, .katex, .katex-display, math")) return el;
  }

  return null;
}

function mathMlToTex(math) {
  return normalizeTex(cleanJoinedMathTex(renderMathMlNode(math)));
}

function renderMathMlNode(node) {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) return normalizeTex(node.textContent || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = node.localName?.toLowerCase() || "";

  if (tag === "annotation" || tag === "annotation-xml") return "";
  if (tag === "math" || tag === "mrow" || tag === "mstyle" || tag === "mpadded" || tag === "mphantom") {
    return renderMathMlChildren(node);
  }
  if (tag === "semantics") {
    const first = Array.from(node.children).find((child) => child.localName?.toLowerCase() !== "annotation");
    return renderMathMlNode(first);
  }
  if (tag === "mi") return renderMathMlIdentifier(node);
  if (tag === "mn") return normalizeTex(node.textContent || "");
  if (tag === "mo") return renderMathMlOperator(node);
  if (tag === "mtext") return `\\text{${escapeTexText(node.textContent || "")}}`;
  if (tag === "ms") return `\\text{${escapeTexText(node.textContent || "")}}`;

  const children = Array.from(node.children);
  if (tag === "mfrac") return `\\frac{${renderMathMlNode(children[0])}}{${renderMathMlNode(children[1])}}`;
  if (tag === "msqrt") return `\\sqrt{${renderMathMlChildren(node)}}`;
  if (tag === "mroot") return `\\sqrt[${renderMathMlNode(children[1])}]{${renderMathMlNode(children[0])}}`;
  if (tag === "msup") return `${wrapMathMlBase(children[0])}^{${renderMathMlNode(children[1])}}`;
  if (tag === "msub") return `${wrapMathMlBase(children[0])}_{${renderMathMlNode(children[1])}}`;
  if (tag === "msubsup") return `${wrapMathMlBase(children[0])}_{${renderMathMlNode(children[1])}}^{${renderMathMlNode(children[2])}}`;
  if (tag === "mover") return renderMathMlMover(children[0], children[1]);
  if (tag === "munder") return `${wrapMathMlBase(children[0])}_{${renderMathMlNode(children[1])}}`;
  if (tag === "munderover") return `${wrapMathMlBase(children[0])}_{${renderMathMlNode(children[1])}}^{${renderMathMlNode(children[2])}}`;
  if (tag === "mfenced") return renderMathMlFenced(node);
  if (tag === "mtable") return renderMathMlTable(node);
  if (tag === "mtr" || tag === "mlabeledtr") return children.map(renderMathMlNode).filter(Boolean).join(" & ");
  if (tag === "mtd") return renderMathMlChildren(node);
  if (tag === "menclose") return renderMathMlChildren(node);

  return renderMathMlChildren(node);
}

function renderMathMlChildren(node) {
  return cleanJoinedMathTex(Array.from(node.childNodes).map(renderMathMlNode).filter(Boolean).join(" "));
}

function renderMathMlIdentifier(node) {
  const text = normalizeTex(node.textContent || "");
  if (!text) return "";

  const mapped = Array.from(text).map((ch) => MATHML_IDENTIFIER_TEX[ch] || ch).join(" ");
  const value = cleanJoinedMathTex(mapped);
  const variant = node.getAttribute("mathvariant") || "";

  if (/bold/i.test(variant)) return `\\mathbf{${value}}`;
  if (/italic/i.test(variant) && text.length > 1) return `\\mathit{${value}}`;
  if (!MATHML_IDENTIFIER_TEX[text] && /^[A-Za-z]{2,}$/.test(text)) return `\\operatorname{${text}}`;
  return value;
}

function renderMathMlOperator(node) {
  const text = normalizeTex(node.textContent || "");
  if (!text) return "";
  return MATHML_OPERATOR_TEX[text] ?? text;
}

function renderMathMlMover(baseNode, overNode) {
  const base = wrapMathMlBase(baseNode);
  const over = renderMathMlNode(overNode);

  if (/^(?:\u00af|\u203e|-)$/.test(overNode?.textContent || "")) return `\\overline{${renderMathMlNode(baseNode)}}`;
  if (/^(?:\^|\u005e)$/.test(overNode?.textContent || "")) return `\\hat{${renderMathMlNode(baseNode)}}`;
  if (/^(?:\u2192|\u20d7)$/.test(overNode?.textContent || "")) return `\\vec{${renderMathMlNode(baseNode)}}`;
  return `${base}^{${over}}`;
}

function renderMathMlFenced(node) {
  const open = node.getAttribute("open") || "(";
  const close = node.getAttribute("close") || ")";
  const separators = node.getAttribute("separators") || ",";
  const sep = separators[0] || ",";
  const body = Array.from(node.children).map(renderMathMlNode).filter(Boolean).join(`${sep} `);
  return `\\left${escapeTexFence(open)} ${body} \\right${escapeTexFence(close)}`;
}

function renderMathMlTable(node) {
  const rows = Array.from(node.children)
    .filter((child) => /^(?:mtr|mlabeledtr)$/i.test(child.localName || ""))
    .map(renderMathMlNode)
    .filter(Boolean);

  if (!rows.length) return "";
  return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
}

function wrapMathMlBase(node) {
  const tex = renderMathMlNode(node);
  if (!tex) return "";
  if (/^(?:\\[a-zA-Z]+|[A-Za-z0-9])$/.test(tex)) return tex;
  return `{${tex}}`;
}

function cleanJoinedMathTex(tex) {
  return normalizeTex(tex)
    .replace(/\s+([_^])/g, "$1")
    .replace(/([_^])\s+/g, "$1")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+\\right/g, " \\right")
    .replace(/\\left\s+/g, "\\left");
}

function escapeTexText(text) {
  return normalizeTex(text).replace(/[\\{}]/g, (ch) => `\\${ch}`);
}

function escapeTexFence(value) {
  if (value === "{") return "\\{";
  if (value === "}") return "\\}";
  if (value === "") return ".";
  return value;
}

const MATHML_IDENTIFIER_TEX = {
  "\u03b1": "\\alpha",
  "\u03b2": "\\beta",
  "\u03b3": "\\gamma",
  "\u03b4": "\\delta",
  "\u03b5": "\\epsilon",
  "\u03b6": "\\zeta",
  "\u03b7": "\\eta",
  "\u03b8": "\\theta",
  "\u03b9": "\\iota",
  "\u03ba": "\\kappa",
  "\u03bb": "\\lambda",
  "\u03bc": "\\mu",
  "\u03bd": "\\nu",
  "\u03be": "\\xi",
  "\u03c0": "\\pi",
  "\u03c1": "\\rho",
  "\u03c3": "\\sigma",
  "\u03c4": "\\tau",
  "\u03c5": "\\upsilon",
  "\u03c6": "\\phi",
  "\u03c7": "\\chi",
  "\u03c8": "\\psi",
  "\u03c9": "\\omega",
  "\u0393": "\\Gamma",
  "\u0394": "\\Delta",
  "\u0398": "\\Theta",
  "\u039b": "\\Lambda",
  "\u039e": "\\Xi",
  "\u03a0": "\\Pi",
  "\u03a3": "\\Sigma",
  "\u03a6": "\\Phi",
  "\u03a8": "\\Psi",
  "\u03a9": "\\Omega"
};

const MATHML_OPERATOR_TEX = {
  "\u00b1": "\\pm",
  "\u2213": "\\mp",
  "\u00d7": "\\times",
  "\u22c5": "\\cdot",
  "\u00f7": "\\div",
  "\u2212": "-",
  "\u2260": "\\neq",
  "\u2264": "\\leq",
  "\u2265": "\\geq",
  "\u2248": "\\approx",
  "\u221e": "\\infty",
  "\u2202": "\\partial",
  "\u2207": "\\nabla",
  "\u2208": "\\in",
  "\u2209": "\\notin",
  "\u2282": "\\subset",
  "\u2286": "\\subseteq",
  "\u222a": "\\cup",
  "\u2229": "\\cap",
  "\u2227": "\\wedge",
  "\u2228": "\\vee",
  "\u2192": "\\to",
  "\u2190": "\\leftarrow",
  "\u2194": "\\leftrightarrow",
  "\u21d2": "\\Rightarrow",
  "\u21d4": "\\Leftrightarrow",
  "\u2211": "\\sum",
  "\u220f": "\\prod",
  "\u222b": "\\int",
  "\u222e": "\\oint",
  "\u2062": "",
  "\u2061": ""
};

function renderedMathToTex(el) {
  const root = el.matches?.("[data-mml-node], mjx-math")
    ? el
    : el.querySelector?.('[data-mml-node="math"], mjx-math') || el;
  return normalizeTex(cleanJoinedMathTex(renderRenderedMathNode(root)));
}

function renderRenderedMathNode(node) {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) return normalizeTex(node.textContent || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  if (node.matches?.("mjx-assistive-mml, mjx-assistive-mml *, annotation, annotation-xml")) return "";

  const type = getRenderedMathNodeType(node);
  if (type === "mi") return renderRenderedMathToken(node, "mi");
  if (type === "mn") return renderRenderedMathToken(node, "mn");
  if (type === "mo") return renderRenderedMathToken(node, "mo");
  if (type === "mtext" || type === "ms") return `\\text{${escapeTexText(renderRenderedMathToken(node, "mtext"))}}`;

  const children = getRenderedMathChildren(node);
  if (type === "mfrac") return `\\frac{${renderRenderedMathNode(children[0])}}{${renderRenderedMathNode(children[1])}}`;
  if (type === "msqrt") return `\\sqrt{${renderRenderedMathChildren(node)}}`;
  if (type === "mroot") return `\\sqrt[${renderRenderedMathNode(children[1])}]{${renderRenderedMathNode(children[0])}}`;
  if (type === "msup") return `${wrapRenderedMathBase(children[0])}^{${renderRenderedMathNode(children[1])}}`;
  if (type === "msub") return `${wrapRenderedMathBase(children[0])}_{${renderRenderedMathNode(children[1])}}`;
  if (type === "msubsup") return `${wrapRenderedMathBase(children[0])}_{${renderRenderedMathNode(children[1])}}^{${renderRenderedMathNode(children[2])}}`;
  if (type === "mover") return renderRenderedMathMover(children[0], children[1]);
  if (type === "munder") return `${wrapRenderedMathBase(children[0])}_{${renderRenderedMathNode(children[1])}}`;
  if (type === "munderover") return `${wrapRenderedMathBase(children[0])}_{${renderRenderedMathNode(children[1])}}^{${renderRenderedMathNode(children[2])}}`;
  if (type === "mtable") return renderRenderedMathTable(node);
  if (type === "mtr" || type === "mlabeledtr") return children.map(renderRenderedMathNode).filter(Boolean).join(" & ");
  if (type === "mtd") return renderRenderedMathChildren(node);

  return renderRenderedMathChildren(node);
}

function getRenderedMathNodeType(el) {
  const dataType = el.getAttribute?.("data-mml-node");
  if (dataType) return dataType.toLowerCase();

  const name = el.localName?.toLowerCase() || "";
  if (name.startsWith("mjx-")) return name.slice(4);
  return "";
}

function getRenderedMathChildren(el) {
  return Array.from(el.children || []).filter((child) => {
    if (child.matches?.("mjx-assistive-mml, mjx-assistive-mml *, defs, path, use")) return false;
    return true;
  });
}

function renderRenderedMathChildren(el) {
  return cleanJoinedMathTex(getRenderedMathChildren(el).map(renderRenderedMathNode).filter(Boolean).join(" "));
}

function renderRenderedMathToken(el, type) {
  const text = normalizeTex(el.textContent || "");
  const raw = text || extractRenderedMathGlyphText(el);
  if (!raw) return "";

  if (type === "mo") return Array.from(raw).map((ch) => MATHML_OPERATOR_TEX[ch] ?? ch).join(" ");
  if (type === "mi") {
    const value = cleanJoinedMathTex(Array.from(raw).map((ch) => MATHML_IDENTIFIER_TEX[ch] || ch).join(" "));
    if (!MATHML_IDENTIFIER_TEX[raw] && /^[A-Za-z]{2,}$/.test(raw)) return `\\operatorname{${raw}}`;
    return value;
  }
  return raw;
}

function extractRenderedMathGlyphText(el) {
  const chars = [];

  for (const glyph of el.querySelectorAll?.("[data-c]") || []) {
    const value = mathGlyphCodeToText(glyph.getAttribute("data-c") || "");
    if (value) chars.push(value);
  }

  for (const glyph of el.querySelectorAll?.("mjx-c") || []) {
    const className = glyph.getAttribute("class") || "";
    const match = className.match(/\bmjx-c([0-9A-Fa-f]+)\b/);
    const value = match ? mathGlyphCodeToText(match[1]) : "";
    if (value) chars.push(value);
  }

  return chars.join("");
}

function mathGlyphCodeToText(value) {
  const codePoint = Number.parseInt(value, 16);
  if (!Number.isFinite(codePoint)) return "";
  return normalizeMathGlyph(String.fromCodePoint(codePoint), codePoint);
}

function normalizeMathGlyph(ch, codePoint) {
  if (codePoint >= 0x1d400 && codePoint <= 0x1d419) return String.fromCharCode(65 + codePoint - 0x1d400);
  if (codePoint >= 0x1d41a && codePoint <= 0x1d433) return String.fromCharCode(97 + codePoint - 0x1d41a);
  if (codePoint >= 0x1d434 && codePoint <= 0x1d44d) return String.fromCharCode(65 + codePoint - 0x1d434);
  if (codePoint >= 0x1d44e && codePoint <= 0x1d467) return String.fromCharCode(97 + codePoint - 0x1d44e);
  if (codePoint >= 0x1d7ce && codePoint <= 0x1d7d7) return String.fromCharCode(48 + codePoint - 0x1d7ce);
  return ch;
}

function renderRenderedMathMover(baseNode, overNode) {
  const rawOver = normalizeTex(overNode?.textContent || extractRenderedMathGlyphText(overNode) || "");
  const base = renderRenderedMathNode(baseNode);

  if (/^(?:\u00af|\u203e|-)$/.test(rawOver)) return `\\overline{${base}}`;
  if (/^(?:\^|\u005e)$/.test(rawOver)) return `\\hat{${base}}`;
  if (/^(?:\u2192|\u20d7)$/.test(rawOver)) return `\\vec{${base}}`;
  return `${wrapRenderedMathBase(baseNode)}^{${renderRenderedMathNode(overNode)}}`;
}

function renderRenderedMathTable(node) {
  const rows = getRenderedMathChildren(node)
    .filter((child) => /^(?:mtr|mlabeledtr)$/i.test(getRenderedMathNodeType(child)))
    .map(renderRenderedMathNode)
    .filter(Boolean);

  if (!rows.length) return "";
  return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
}

function wrapRenderedMathBase(node) {
  const tex = renderRenderedMathNode(node);
  if (!tex) return "";
  if (/^(?:\\[a-zA-Z]+|[A-Za-z0-9])$/.test(tex)) return tex;
  return `{${tex}}`;
}

function extractTexCandidatesFromText(text, source = "text-delimiter") {
  const results = [];
  const raw = String(text || "");
  const normalized = stripLatexLabel(raw);
  const jsonStrings = extractStringsFromJson(normalized);
  const valuesToScan = jsonStrings.length ? jsonStrings : [normalized];

  for (const value of valuesToScan) {
    const patterns = [
      /\\\[([\s\S]{1,6000}?)\\\]/g,
      /\\\(([\s\S]{1,2000}?)\\\)/g,
      /\$\$([\s\S]{1,6000}?)\$\$/g,
      /(^|[^$\\])\$((?:\\.|[^$\n]){1,2000}?)\$/g
    ];

    for (const pattern of patterns) {
      for (const match of value.matchAll(pattern)) {
        const tex = normalizeTex(match[2] ?? match[1]);
        if (tex && isLikelyTex(tex, "delimited-formula")) results.push(tex);
      }
    }

    const direct = normalizeTex(value);
    if (!results.length && isLikelyTex(direct, source)) results.push(direct);
  }

  return uniqueTexList(results);
}

function extractStringsFromJson(value) {
  const trimmed = String(value || "").trim();
  if (!/^[{\[]/.test(trimmed)) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const strings = [];
    const visit = (node) => {
      if (typeof node === "string") {
        if (maybeContainsLatex(node)) strings.push(node);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node && typeof node === "object") {
        Object.values(node).forEach(visit);
      }
    };
    visit(parsed);
    return strings;
  } catch {
    return [];
  }
}

function stripLatexLabel(value) {
  return String(value || "")
    .replace(/^\s*(?:latex|tex|math|formula)\s*[:：]\s*/i, "")
    .trim();
}

function normalizeTex(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueTexList(values) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    if (out.length >= MAX_FORMULA_RECORDS) break;
    const tex = normalizeTex(value);
    const key = tex.replace(/\s+/g, " ");
    if (!tex || seen.has(key)) continue;
    seen.add(key);
    out.push(tex);
  }

  return out;
}

function dedupeRecords(records) {
  const seen = new Set();
  const out = [];

  for (const record of records) {
    const key = `${record.element ? getStableElementKey(record.element) : "no-element"}::${record.tex.replace(/\s+/g, " ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }

  return out;
}

function sortFormulaRecords(records, scope = "document") {
  records.sort((a, b) => {
    if (scope === "viewport") {
      const aVisible = (a.distance ?? Number.POSITIVE_INFINITY) === 0;
      const bVisible = (b.distance ?? Number.POSITIVE_INFINITY) === 0;
      if (aVisible !== bVisible) return aVisible ? -1 : 1;
    }

    const priorityA = a.priority ?? getFormulaRecordPriority(a.element, a.tex, a.source);
    const priorityB = b.priority ?? getFormulaRecordPriority(b.element, b.tex, b.source);
    if (priorityA !== priorityB) return priorityB - priorityA;

    const distanceA = scope === "viewport" ? (a.distance ?? Number.POSITIVE_INFINITY) : 0;
    const distanceB = scope === "viewport" ? (b.distance ?? Number.POSITIVE_INFINITY) : 0;
    if (distanceA !== distanceB) return distanceA - distanceB;

    if (a.tex.length !== b.tex.length) return b.tex.length - a.tex.length;
    return String(a.source || "").localeCompare(String(b.source || ""));
  });
}

function sortQueuedFormulaCandidates(candidates) {
  candidates.sort((a, b) => {
    if ((a.distance ?? Number.POSITIVE_INFINITY) !== (b.distance ?? Number.POSITIVE_INFINITY)) {
      const aVisible = (a.distance ?? Number.POSITIVE_INFINITY) === 0;
      const bVisible = (b.distance ?? Number.POSITIVE_INFINITY) === 0;
      if (aVisible !== bVisible) return aVisible ? -1 : 1;
    }

    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    if ((a.distance ?? Number.POSITIVE_INFINITY) !== (b.distance ?? Number.POSITIVE_INFINITY)) {
      return (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY);
    }
    return b.tex.length - a.tex.length;
  });
}

function getFormulaRecordPriority(element, tex, source) {
  const value = normalizeTex(tex);
  let score = 0;

  if (source === "annotation" || source === "mathjax-script") score += 90;
  else if (source === "mathml" || source === "rendered-math") score += 75;
  else if (source === "data-latex-display") score += 70;
  else if (source === "data-math" || source === "data-mathml" || source === "data-formula" || source === "data-equation" || source === "data-value") score += 60;
  else if (source === "data-tex" || source === "data-latex" || source === "data-latex-source") score += 45;
  else if (source === "delimited-formula") score += 30;
  else if (source === "text-delimiter") score += 15;

  if (element?.classList?.contains("math-block") || element?.classList?.contains("katex-display")) score += 50;
  else if (element?.classList?.contains("math-inline") || element?.classList?.contains("katex")) score += 15;

  if (value.length >= 40) score += 30;
  else if (value.length >= 18) score += 18;
  else if (value.length >= 8) score += 8;
  else if (value.length <= 2) score -= 12;

  if (/[\\_^=+\-*/{}<>]/.test(value)) score += 12;
  if (/\\(?:frac|sqrt|sum|prod|int|oint|lim|left|right|begin|end|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|Delta|Omega|nabla|partial|cdot|times|div|leq|geq|neq|approx|infty|mathbf|mathrm|text|operatorname|overline|underline|hat|bar)\b/.test(value)) {
    score += 18;
  }

  return score;
}

function getViewportRootPriority(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const text = normalizeTex(el.textContent || "");
  const raw =
    el.getAttribute("data-math") ||
    el.getAttribute("data-latex-display") ||
    el.getAttribute("data-mathml") ||
    el.getAttribute("data-formula") ||
    el.getAttribute("data-equation") ||
    el.getAttribute("data-value") ||
    el.getAttribute("data-tex") ||
    el.getAttribute("data-latex") ||
    "";

  if (el.matches?.(VIEWPORT_CONTENT_ROOT_SELECTOR)) score += 100;
  else if (el.matches?.(VIEWPORT_BLOCK_ROOT_SELECTOR)) score += 28;

  if (el.matches?.(".math-block, .katex-display")) score += 140;
  else if (el.matches?.(".math-inline, .katex, mjx-container, .MathJax, math")) score += 55;

  if (el.matches?.("[data-math], [data-mathml], [data-latex-display], [data-formula], [data-equation], [data-value], [data-tex], [data-latex], [data-latex-source]")) {
    score += 35;
  }

  if (raw) score += getFormulaTextPriority(raw);
  if (text.length >= 120) score += 20;
  else if (text.length >= 40) score += 10;
  else if (text.length <= 6) score -= 10;

  if (isElementNearViewport(el, getViewportScanMargin())) score += 12;
  return score;
}

function getFormulaTextPriority(value) {
  const tex = normalizeTex(value);
  if (!tex) return 0;

  let score = 0;
  if (tex.length >= 40) score += 20;
  else if (tex.length >= 18) score += 12;
  else if (tex.length >= 8) score += 6;
  else if (tex.length <= 2) score -= 8;

  if (/[\\_^=+\-*/{}<>]/.test(tex)) score += 8;
  if (/\\[a-zA-Z]+/.test(tex)) score += 10;

  return score;
}

function getStableElementKey(el) {
  if (!el.getAttribute(FORMULA_ID_ATTR)) {
    el.setAttribute(FORMULA_ID_ATTR, String(Date.now()) + Math.random().toString(36).slice(2));
  }
  return el.getAttribute(FORMULA_ID_ATTR);
}

function maybeContainsLatex(text) {
  return /\\[()[\]]|\${1,2}|\\[a-zA-Z]+/.test(String(text || ""));
}

function isLikelyTex(value, source) {
  const tex = normalizeTex(value);
  if (!tex || tex.length > 6000) return false;
  if (/^(?:https?:\/\/|www\.)/i.test(tex)) return false;
  if (/^\s*[{\[]/.test(tex) && source !== "annotation" && source !== "mathjax-script") return false;
  if (/<\/?[a-z][\s\S]*>/i.test(tex)) return false;

  if (/\\(?:frac|sqrt|sum|prod|int|oint|lim|left|right|begin|end|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|Delta|Omega|nabla|partial|cdot|times|div|leq|geq|neq|approx|infty|mathbf|mathrm|text|operatorname|overline|underline|hat|bar)\b/.test(tex)) {
    return true;
  }

  if (source === "annotation" || source === "mathjax-script") return /[A-Za-z0-9\\]/.test(tex);
  if (source === "mathml" || source === "rendered-math") return /[A-Za-z0-9\\_^=+\-*/{}<>]/.test(tex);
  if (source === "delimited-formula" || source === "text-delimiter") {
    if (/^[\d\s.,]+$/.test(tex)) return false;
    if (!/[\\_^=+\-*/{}<>]/.test(tex)) {
      const words = tex.match(/[A-Za-z]{2,}/g) || [];
      if (words.length > 3) return false;
    }
    return /[A-Za-z]/.test(tex) || /[=<>+\-*/^_]/.test(tex);
  }
  if (source === "page-text") return false;
  if (/data-(?:tex|latex|latex-display|latex-source|math|mathml|formula|equation)/.test(source)) {
    if (/^[A-Za-z]{1,2}$/.test(tex)) return true;
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(tex)) return true;
    if (/^[A-Za-z0-9._\-+*/^=(),[\]{}\\ ]{1,24}$/.test(tex) && /(?:\\|[_^=+\-*/{}<>])/.test(tex)) return true;
    if (/^[A-Za-z0-9._\-+*/^=(),[\]{}\\'| ]{1,80}$/.test(tex) && /[A-Za-z0-9]/.test(tex) && /[(),'\[\]{}]/.test(tex)) return true;
    return /[A-Za-z0-9]/.test(tex) && /\\[a-zA-Z]+/.test(tex);
  }
  if (source === "data-value") {
    return /[A-Za-z0-9]/.test(tex) && /(?:\\[a-zA-Z]+|[_^=+\-*/{}<>])/.test(tex);
  }
  if (/data-(?:source|original|content|text|raw|markdown|expression|asciimath)/.test(source)) {
    return /[A-Za-z0-9]/.test(tex) && /(?:\\[a-zA-Z]+|[_^=+\-*/{}<>])/.test(tex);
  }
  if (source === "aria-label" || source === "aria-description" || source === "alt" || source === "title") {
    return /(?:latex|tex|math|formula|equation)\s*[:：]/i.test(value) && /[A-Za-z0-9]/.test(tex);
  }
  if (source === "data-math" || source === "data-value") return /\\[a-zA-Z]+|[_^]/.test(tex) && /[A-Za-z0-9]/.test(tex);

  return /\\/.test(tex) && /[A-Za-z]/.test(tex);
}

function isTexEncoding(value) {
  return /(?:application\/x-)?(?:tex|latex)|math\/tex/i.test(String(value || ""));
}

function shouldBindTextFormula(parent, rawText, values) {
  if (!parent || values.length > 4) return false;

  const text = normalizeTex(parent.textContent || rawText);
  if (text.length > 600) return false;
  if (text.length > normalizeTex(rawText).length + 120) return false;

  return true;
}

function isExtensionElement(el) {
  if (!el) return false;
  if (el.closest?.("#__edge_fab_host__")) return true;

  const root = el.getRootNode?.();
  const host = root?.host;
  return Boolean(host?.id === "__edge_fab_host__" || host?.closest?.("#__edge_fab_host__"));
}

function isInEditableField(el) {
  if (!el?.closest) return false;
  if (el.closest(EDITABLE_FIELD_SELECTOR)) return true;

  for (let cur = el; cur && cur.nodeType === Node.ELEMENT_NODE; cur = cur.parentElement) {
    if (cur.isContentEditable) return true;
    const contentEditable = cur.getAttribute?.("contenteditable");
    if (/^(?:true|plaintext-only)$/i.test(contentEditable || "")) return true;
  }

  return false;
}

function isNodeInEditableField(node) {
  if (!node) return false;
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return Boolean(el && isInEditableField(el));
}

function isElementVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return Boolean(el.getClientRects().length);
}

function getViewportScanMargin() {
  const height = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 800;
  return Math.max(360, Math.round(height * 1.15));
}

function isElementNearViewport(el, margin = 0) {
  if (!isElementVisible(el)) return false;

  const rects = el.getClientRects?.();
  if (!rects?.length) return false;

  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom < -margin) continue;
    if (rect.top > window.innerHeight + margin) continue;
    if (rect.right < 0 || rect.left > window.innerWidth) continue;
    return true;
  }

  return false;
}

function getViewportDistance(el) {
  const rect = el.getBoundingClientRect();
  const center = rect.top + rect.height / 2;
  const viewportCenter = window.innerHeight / 2;
  if (rect.bottom >= 0 && rect.top <= window.innerHeight) return 0;
  return Math.abs(center - viewportCenter);
}

function getFormulaViewportDistance(element, sourceNode, source) {
  const margin = getViewportScanMargin();

  if (source === "text-delimiter" || source === "page-text") {
    const textDistance = getTextNodeViewportDistance(sourceNode);
    if (textDistance === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    if (textDistance > margin) return Number.POSITIVE_INFINITY;
    return textDistance;
  }

  if (element && isElementNearViewport(element, margin)) {
    return getViewportDistance(element);
  }

  if (sourceNode?.nodeType === Node.ELEMENT_NODE && isElementNearViewport(sourceNode, margin)) {
    return getViewportDistance(sourceNode);
  }

  return Number.POSITIVE_INFINITY;
}

function getTextNodeViewportDistance(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE || !document.body) return Number.POSITIVE_INFINITY;

  const range = document.createRange();
  try {
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects?.() || []);
    if (!rects.length) return Number.POSITIVE_INFINITY;

    let best = Number.POSITIVE_INFINITY;
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const intersects = rect.bottom >= 0 &&
        rect.top <= window.innerHeight &&
        rect.right >= 0 &&
        rect.left <= window.innerWidth;
      if (intersects) return 0;

      const centerY = rect.top + rect.height / 2;
      const centerX = rect.left + rect.width / 2;
      const dx = Math.max(0, Math.abs(centerX - (window.innerWidth / 2)) - (window.innerWidth / 2));
      const dy = Math.max(0, Math.abs(centerY - (window.innerHeight / 2)) - (window.innerHeight / 2));
      const dist = Math.hypot(dx, dy);
      if (dist < best) best = dist;
    }

    return best;
  } catch {
    return Number.POSITIVE_INFINITY;
  } finally {
    range.detach?.();
  }
}

function setFormulaElementTitle(el, tex) {
  if (!el.hasAttribute(FORMULA_ORIGINAL_TITLE_ATTR)) {
    const originalTitle = el.getAttribute("title");
    if (originalTitle !== null) el.setAttribute(FORMULA_ORIGINAL_TITLE_ATTR, originalTitle);
  }

  el.title = tex.length > 300 ? `${tex.slice(0, 300)}...` : tex;
}

function cleanupStaleFormulaTags(activeElementTex) {
  document.querySelectorAll(".ext-formula-hover").forEach((el) => {
    if (activeElementTex.has(el) && !isInEditableField(el)) return;
    clearFormulaTag(el);
  });
}

function clearFormulaTag(el) {
  el.classList.remove("ext-formula-hover", "ext-formula-flash", "__edge_fab_flash__");
  el.removeAttribute(FORMULA_TEX_ATTR);
  el.removeAttribute(FORMULA_ID_ATTR);

  if (el.hasAttribute(FORMULA_ORIGINAL_TITLE_ATTR)) {
    const originalTitle = el.getAttribute(FORMULA_ORIGINAL_TITLE_ATTR);
    el.removeAttribute(FORMULA_ORIGINAL_TITLE_ATTR);
    if (originalTitle === null || originalTitle === "") {
      el.removeAttribute("title");
    } else {
      el.setAttribute("title", originalTitle);
    }
    return;
  }

  el.removeAttribute("title");
}

function bindFormulaCopyDelegate(onCopy) {
  document.__extFormulaCopyFeedback = onCopy;
  if (document.__extFormulaCopyDelegateBound) return;

  document.addEventListener("click", handleFormulaCopyClick, true);
  document.__extFormulaCopyDelegateBound = true;
}

function handleFormulaCopyClick(ev) {
  const target = ev.target;
  if (!target?.closest) return;

  const formulaEl = target.closest(".ext-formula-hover");
  const toCopy = formulaEl?.getAttribute?.(FORMULA_TEX_ATTR) || "";
  if (!toCopy) return;

  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation?.();

  Promise.resolve(copyFormulaTextToClipboard(toCopy)).then((ok) => {
    document.__extFormulaCopyFeedback?.(ok);
  });
}

function syncCopyFormatSetting() {
  if (!chrome.storage?.local?.get) return;

  try {
    chrome.storage.local.get({ [COPY_FORMAT_STORAGE_KEY]: COPY_FORMAT_DEFAULT }, (res) => {
      if (chrome.runtime?.lastError) return;
      currentCopyFormat = normalizeCopyFormatId(res?.[COPY_FORMAT_STORAGE_KEY]);
    });
  } catch {
    currentCopyFormat = COPY_FORMAT_DEFAULT;
  }
}

function copyFormulaTextToClipboard(tex) {
  return copyTextToClipboard(formatFormulaText(tex, currentCopyFormat));
}

function normalizeCopyFormatId(format) {
  return COPY_FORMAT_IDS.has(format) ? format : COPY_FORMAT_DEFAULT;
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

function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return Promise.resolve(false);

  if (copyWithCopyEvent(value)) return Promise.resolve(true);
  if (copyWithTextarea(value)) return Promise.resolve(true);

  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value)
      .then(() => true, () => copyViaExtension(value));
  }

  return copyViaExtension(value);
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
    ev.stopPropagation();
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
  const root = document.body || document.documentElement;
  if (!root) return false;

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
    opacity: "0",
    pointerEvents: "none"
  });

  root.appendChild(ta);

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

function positionPanelNearFab(panel, wrap) {
  const pr = panel.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();

  const panelH = pr.height || 260;

  // 目标：面板垂直中心对齐浮标中心
  let top = (wr.top + wr.height / 2) - panelH / 2;

  // 夹紧到视口内
  top = Math.max(10, Math.min(top, window.innerHeight - panelH - 10));

  // 左右：根据当前吸附边决定放哪边
  const side = wrap.dataset.side; // "left" or "right"
  panel.style.top = `${top}px`;

  if (side === "right") {
    panel.style.right = `${(window.innerWidth - wr.left) + 10}px`; // 面板出现在浮标左侧
    panel.style.left = "auto";
  } else {
    panel.style.left = `${wr.right + 10}px`; // 面板出现在浮标右侧
    panel.style.right = "auto";
  }
}
