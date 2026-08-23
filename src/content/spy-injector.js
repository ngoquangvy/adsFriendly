export function injectSpy(settings = {}) {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected_spy.js");
    script.dataset.protectionMode = settings.protectionMode || "safe";
    script.dataset.protectionEnabled = String(settings.enabled !== false);
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (error) {
    console.error("[AdsFriendly] Injection failed:", error);
  }
}
