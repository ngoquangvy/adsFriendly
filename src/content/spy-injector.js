export function injectSpy() {
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected_spy.js");
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  } catch (e) {
    console.error("[AdsFriendly] Injection failed:", e);
  }
}
