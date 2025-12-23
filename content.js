(() => {
  // 立即执行函数：把所有变量收进局部作用域，避免污染页面全局。
  const HOST_ID = "__edge_fab_host__"; // Shadow DOM 宿主元素的唯一 ID，用来防止重复创建。
  if (document.getElementById(HOST_ID)) return; // 如果已存在宿主，说明已初始化，直接退出。

  // --- 可调参数：控制尺寸、间距、吸边距离、层级等视觉与交互细节。
  const FAB_SIZE = 36;          // 主按钮直径（主按钮小一些）。
  const MINI_SIZE = 40;         // 小按钮直径（小按钮更醒目）。
  const GAP = 10;               // 小按钮之间的垂直间距。
  const EDGE_MARGIN = 8;        // 吸附到左右边缘后的内侧偏移。
  const TOP_MARGIN = 10;        // 拖拽可到达的顶部安全边距。
  const BOTTOM_MARGIN = 10;     // 拖拽可到达的底部安全边距。
  const Z = 2147483647;         // 极高层级，保证浮窗显示在页面最上层。

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
        height: ${FAB_SIZE + (MINI_SIZE + GAP) * 3 + 30}px;
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
        width: 320px;
        height: min(70vh, 520px);
        border-radius: 14px;
        overflow: hidden;
        background: white;
        box-shadow: 0 12px 30px rgba(0,0,0,.25);
        opacity: 0;
        transform: translateY(6px);
        pointer-events: none;
        transition: opacity 160ms ease, transform 160ms ease;
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

    // 小按钮组（竖向排列）。
    const mini = document.createElement("div");
    mini.className = "ef-mini";
    mini.append(
      miniBtn("Mark Formulas", "✨", () => {
        ensureKatexStyle();
        const stats = tagKatexAndBindCopy();
        const texList = extractTexListFromPage();
        lastTexList = texList;
        sendTexList();
        toast(`Marked ${stats.total} formulas, with ${stats.newlyTagged} newly tagged.`);
      }),
      miniBtn("打开面板", "resources/panel.svg", () => togglePanel(true)),
      miniBtn("收起", "×", () => { wrap.dataset.open = "0"; togglePanel(false); if (wrap.dataset.pinned !== "1") collapse(); })
    );

    // 可选面板：通过 iframe 加载扩展内部页面。
    const panel = document.createElement("div");
    panel.className = "ef-panel";
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("panel.html");
    panel.appendChild(iframe);

    // 组装 DOM：顺序决定层级与交互关系。
    wrap.append(hoverPad, fab, mini, panel);
    shadow.append(style, wrap);

    window.addEventListener("message", (e) => {
      if (e.source !== iframe.contentWindow) return;
      const action = e.data?.payload?.action;
      if (e.data?.type !== "ACTION" || !action) return;

      if (action === "FLASH_FORMULAS") flashFormulas();
      if (action === "SHOW_TOAST") toast("panel button triggered");
      if (action === "CLOSE_PANEL") togglePanel(false);
    });


    let lastTexList = [];

    function sendTexList() {
      iframe.contentWindow?.postMessage({ type: "TEX_LIST", payload: lastTexList }, "*");
    }


    // iframe 加载完成后，向 iframe 发送上下文信息。
    iframe.addEventListener("load", () => {
      iframe.contentWindow?.postMessage?.(
        { type: "CONTEXT", payload: { url: location.href, title: document.title, side: wrap.dataset.side } },
        "*"
      );

      sendTexList();
    });

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

      // 估算菜单高度：3 个小按钮 + 间距 + 上下余量
      const menuH = (MINI_SIZE * 3) + (GAP * 2) + 16;
      const spaceBelow = window.innerHeight - wr.bottom;
      const spaceAbove = wr.top;

      wrap.dataset.menu = (spaceBelow < menuH && spaceAbove > spaceBelow) ? "up" : "down";
    }

    // 控制面板显隐。
    function togglePanel(show) {
      panel.dataset.show = show ? "1" : "0";
      if (show) {
        updateMenuDir();
        wrap.dataset.open = "1";
        wrap.dataset.collapsed = "0";
        positionPanelNearFab(panel, wrap);
      }
    }

    // 高亮页面中的公式元素。
    function flashFormulas() {
      const nodes = [
        ...document.querySelectorAll("math, .katex, .katex-display, .MathJax, mjx-container")
      ];
      if (!nodes.length) return toast("没检测到公式元素");

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
      toast(`已标记 ${nodes.length} 个公式`);
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


function extractTexListFromPage() {
  const normalize = (s) => (s || "").replace(/\s+/g, " ").trim();

  return Array.from(
    document.querySelectorAll('.katex annotation[encoding="application/x-tex"]')
  )
    .map(n => normalize(n.textContent))
    .filter(Boolean);
}


function ensureKatexStyle() {
  const STYLE_ID = "__ext_katex_hover_style__";
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .ext-katex-hover { position: relative; border-radius: 4px; }
    .ext-katex-hover:hover { outline: 2px solid #000; outline-offset: 2px; }

    .ext-katex-flash { animation: extKatexFlash 1s ease-out forwards; }
    @keyframes extKatexFlash {
      0%   { box-shadow: 0 0 0 2px rgba(0,255,0,1); }
      100% { box-shadow: 0 0 0 2px rgba(0,0,0,0); }
    }
  `;
  document.head.appendChild(style);
}


function tagKatexAndBindCopy() {
  const katexNodes = Array.from(document.querySelectorAll(".katex"));
  let tagged = 0;

  for (const k of katexNodes) {
    if (!k.classList.contains("ext-katex-hover")) {
      k.classList.add("ext-katex-hover");
      tagged++;
    }

    const ann = k.querySelector('annotation[encoding="application/x-tex"]');
    if (ann) {
      const tex = (ann.textContent || "").replace(/\s+/g, " ").trim();
      k.dataset.tex = tex;
      k.title = tex.length > 300 ? tex.slice(0, 300) + "…" : tex;

      if (!k.dataset.texCopyBound) {
        k.addEventListener("click", () => {
          const toCopy = k.dataset.tex || "";
          const copy = async () => {
            try {
              await navigator.clipboard.writeText(toCopy);
            } catch {
              const ta = document.createElement("textarea");
              ta.value = toCopy;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              ta.remove();
            }
          };
          copy();
        });
        k.dataset.texCopyBound = "1";
      }
    }

    // 触发闪烁（每次都重置动画）
    k.classList.remove("ext-katex-flash");
    void k.offsetWidth;
    k.classList.add("ext-katex-flash");
  }

  setTimeout(() => {
    for (const k of katexNodes) k.classList.remove("ext-katex-flash");
  }, 1000);

  return { total: katexNodes.length, newlyTagged: tagged };
}

function positionPanelNearFab(panel, wrap) {
  const pr = panel.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();

  const panelW = pr.width || 320;
  const panelH = pr.height || Math.min(window.innerHeight * 0.7, 520);

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
