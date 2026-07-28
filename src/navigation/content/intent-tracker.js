export function startIntentTracker() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isTrusted) return;
      try {
        const link = event.target.closest("a");
        if (!link?.href) return;
        chrome.runtime.sendMessage({
          type: "TRUSTED_CLICK",
          intentUrl: link.href,
        });
      } catch {}
    },
    true,
  );

  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!event.isTrusted) return;
      try {
        const link = event.target.closest("a[href]");
        if (!link?.href) return;
        chrome.runtime.sendMessage({
          type: "TRUSTED_CLICK",
          intentUrl: link.href,
        });
      } catch {}
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted || event.key !== "Enter") return;
      try {
        const link = event.target.closest("a[href]");
        if (!link?.href) return;
        chrome.runtime.sendMessage({
          type: "TRUSTED_CLICK",
          intentUrl: link.href,
        });
      } catch {}
    },
    true,
  );
}
