const selectors = [
  "ytd-masthead-ad-v3-renderer",
  "ytd-promoted-video-renderer",
  "ytd-display-ad-renderer",
  "ytd-ad-slot-renderer",
  "ytd-promoted-sparkles-web-renderer",
  "#masthead-ad",
  ".ytd-video-masthead-ad-v3-renderer",
  ".ytd-promoted-video-renderer",
];
export function startYouTubeCleaner() {
  const run = () => {
    if (location.hostname !== "www.youtube.com") return;
    selectors.forEach((sel) =>
      document
        .querySelectorAll(sel)
        .forEach((el) => el.style.setProperty("display", "none", "important")),
    );
    document
      .querySelectorAll("ytd-rich-item-renderer, ytd-video-renderer")
      .forEach((card) => {
        const text = card.innerText.trim().toLowerCase();
        if (
          text.includes("sponsored") ||
          text.includes("được tài trợ") ||
          text.includes("quảng cáo")
        )
          card.style.setProperty("display", "none", "important");
      });
  };
  run();
  const intervalId = setInterval(run, 2000);
  return () => clearInterval(intervalId);
}
