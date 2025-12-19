// Use getElementById() funciton to select the element in html
const btnGrab = document.getElementById("grab");
const btnSave = document.getElementById("save");
const out = document.getElementById("out");

let lastHtml = ""; // Temporarily storage the HTML strings
let lastTitle = "page"; // Temporarily save the page name

function safeName(s) {
  return (s || "page")
    .replace(/[\\/:*?"<>|]+/g, "_") // Replace illegal file name char with _
    .replace(/\s+/g, " ")   // Merge continuous white blank into one 
    .trim() // Delete the blanks in the head and tail
    .slice(0, 80); // restrict the length of file name with 80 characters 
}

btnGrab.addEventListener("click", async () => {
  out.textContent = "Catching...";
  btnSave.disabled = true; // The save button is disabled during catching

  try {
    // ------------- 1 Get pages that are activated now 
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Can't not find the title page now");

    // 2 conduct scripts in the target page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, // Specify the target page
      func: () => ({
        // Get the whole HTML code and title of the page
        html: document.documentElement.outerHTML,
        // Get the title of the page, if not exist, use "page" instead
        title: document.title || "page"
      })
    });


    // -------------- 3 Process the results
    const data = results?.[0]?.result;
    /*
    The form of result:
        results = [
        {
            frameId: 0,
            result: {
            html: "<!DOCTYPE html>....",
            title: "Example Page"
            }
        }
        ]
    So, we choose the first frame's result, and get the result inside it.
    Which is data = result[0].result. 
    ?. here is optional chaining operator, to avoid errors 
    when some property is undefined. If the property before ?. is undefined,
    */

    // If data or data.html is undefined, use empty string instead
    lastHtml = data?.html ?? ""; 

    // If data or data.title is undefined, use "page" instead, 
    // and make it safe for file name
    lastTitle = safeName(data?.title ?? "page");

    // -------------- 4 Show the results in popup
    out.textContent = `Length: ${lastHtml.length}\n\n` + lastHtml.slice(0, 2000) + (lastHtml.length > 2000 ? "\n\n...(Truncated display)" : "");
    btnSave.disabled = !lastHtml; // Enable save button if we have HTML content
  } catch (e) {
    out.textContent = "Fail: " + e.message;
    console.error(e);
  }
});

btnSave.addEventListener("click", () => {
  if (!lastHtml) return;

  // Save the HTML content as a file
  // Blob is a file-like object of immutable, raw data.
  const blob = new Blob([lastHtml], { type: "text/html;charset=utf-8" });

  // Create a blob URL to download the blob object
  // Above we specified the type of blob as text/html,
  // so the browser will treat it as an HTML file.
  const url = URL.createObjectURL(blob);

  // Save the download link to the <a> element
  // And create a auto click to download it
  const a = document.createElement("a");
  a.href = url;
  a.download = `${lastTitle}.html`; // file name
  a.click();

  // Clear blob URL
  // Here 1000ms later to ensure the download is started
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
