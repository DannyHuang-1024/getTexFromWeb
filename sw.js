chrome.runtime.onInstalled.addListener(() => {
  // 初始化默认设置（可选）
  chrome.storage.local.set({ edgeSide: "right" });
});
