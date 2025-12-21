// Use getElementById() funciton to select the element in html
const btnShowFormula = document.getElementById("ShowFormula-js");

let lastHtml = ""; // Temporarily storage the HTML strings
let lastTitle = "page"; // Temporarily save the page name
let lastTexList = []; // NEW: store extracted LaTeX (KaTeX annotations)

function safeName(s) {
  return (s || "page")
    .replace(/[\\/:*?"<>|]+/g, "_") // Replace illegal file name char with _
    .replace(/\s+/g, " ")   // Merge continuous white blank into one 
    .trim() // Delete the blanks in the head and tail
    .slice(0, 80); // restrict the length of file name with 80 characters 
}

btnShowFormula.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found");

    // Capture HTML/title/TeX first so later actions have data.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const normalize = (s) => (s || "").replace(/\s+/g, " ").trim();

        const html = document.documentElement.outerHTML;
        const title = document.title || "page";
        const texList = Array.from(
            document.querySelectorAll('.katex annotation[encoding="application/x-tex"]')
        )
            .map(n => normalize(n.textContent))
            .filter(Boolean);

        return { html, title, texList };
      }
    });

    const data = results?.[0]?.result;
    lastHtml = data?.html ?? "";
    lastTitle = safeName(data?.title ?? "page");
    lastTexList = Array.isArray(data?.texList) ? data.texList : [];

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const STYLE_ID = "__ext_katex_hover_style__";

        // Inject hover styling once per page to highlight KaTeX blocks on hover.
        if (!document.getElementById(STYLE_ID)) {
          const style = document.createElement("style");
          style.id = STYLE_ID;
          style.textContent = `
            .ext-katex-hover { position: relative; border-radius: 4px; }
            .ext-katex-hover:hover { outline: 2px solid #000; outline-offset: 2px; }

            /* Flash effect: show black tag then fade out over 1s */
            .ext-katex-flash {
              animation: extKatexFlash 1s ease-out forwards;
            }
            @keyframes extKatexFlash {
              0%   { box-shadow: 0 0 0 2px rgba(0,255,0,1); }
              100% { box-shadow: 0 0 0 2px rgba(0,0,0,0); }
            }
          `;
          document.head.appendChild(style);
        }

        

        // Tag all KaTeX nodes and add TeX as tooltip and data attribute.
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
            // Bind once: click to copy the TeX to clipboard.
            if (!k.dataset.texCopyBound) {
              k.addEventListener("click", () => {
                const toCopy = k.dataset.tex || "";
                const copy = async () => {
                  try {
                    await navigator.clipboard.writeText(toCopy);
                  } catch {
                    // Fallback for pages without clipboard permission.
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

          // Restart the flash animation on every click:
          k.classList.remove("ext-katex-flash");
          // Force reflow so animation restarts even if clicked repeatedly
          void k.offsetWidth;
          k.classList.add("ext-katex-flash");
        }

          // Remove the class after 1s (optional, but keeps DOM cleaner)
        setTimeout(() => {
          for (const k of katexNodes) k.classList.remove("ext-katex-flash");
        }, 1000);

        // Report how many KaTeX blocks were found and newly tagged.
        return { total: katexNodes.length, newlyTagged: tagged };
      }
    });

  } catch (e) {
    console.error("ShowFormula error:", e);
  }
});
