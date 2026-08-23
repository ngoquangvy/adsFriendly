export function startIntentTracker() {
  const recordIntent = (event) => {
    if (!event.isTrusted) return;
    try {
      const link = event.target.closest("a[href]");
      if (!link?.href) return;
      chrome.runtime.sendMessage({
        type: "TRUSTED_CLICK",
        intentUrl: link.href,
      });
    } catch {}
  };
  const onKeydown = (event) => {
    if (event.key === "Enter") recordIntent(event);
  };

  document.addEventListener("pointerdown", recordIntent, true);
  document.addEventListener("contextmenu", recordIntent, true);
  document.addEventListener("keydown", onKeydown, true);

  return () => {
    document.removeEventListener("pointerdown", recordIntent, true);
    document.removeEventListener("contextmenu", recordIntent, true);
    document.removeEventListener("keydown", onKeydown, true);
  };
}
