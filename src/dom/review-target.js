const UI_SELECTOR = '[data-afs-ui], [id^="adsfriendly-"]';
const MEDIA_SELECTOR = "img, iframe, video, svg, canvas";

function visuallyPresent(element) {
  if (!element?.isConnected || element.closest?.(UI_SELECTOR)) return false;
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") <= 0.05 ||
      node.hasAttribute("data-adsfriendly-rule-hidden")
    )
      return false;
  }
  return true;
}

export function getReviewRect(element) {
  if (!visuallyPresent(element)) return null;
  const boxes = [
    element,
    ...Array.from(element.querySelectorAll(MEDIA_SELECTOR)).slice(0, 20),
  ]
    .filter(visuallyPresent)
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (!boxes.length) return null;
  let left = Math.max(0, Math.min(...boxes.map((rect) => rect.left)));
  let top = Math.max(0, Math.min(...boxes.map((rect) => rect.top)));
  let right = Math.min(
    innerWidth,
    Math.max(...boxes.map((rect) => rect.right)),
  );
  let bottom = Math.min(
    innerHeight,
    Math.max(...boxes.map((rect) => rect.bottom)),
  );
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent),
      rect = parent.getBoundingClientRect();
    if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
    if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
  }
  if (right - left < 12 || bottom - top < 12) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function hasReviewContent(element) {
  const media = [
    element,
    ...Array.from(element.querySelectorAll(MEDIA_SELECTOR)).slice(0, 20),
  ];
  if (
    media.some((node) => {
      if (!getReviewRect(node)) return false;
      if (node.tagName === "IMG") return node.complete && node.naturalWidth > 0;
      if (node.tagName === "IFRAME")
        return (
          !!node.getAttribute("srcdoc") || /^https?:/i.test(node.src || "")
        );
      if (node.tagName === "VIDEO") return node.readyState > 0;
      if (node.tagName === "SVG")
        return !!node.querySelector("path, rect, circle, image, use, text");
      return false; // An empty canvas/slot isn't proof of visible advertising.
    })
  )
    return true;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node, count = 0; (node = walker.nextNode()) && count < 80; count++) {
    if (!(node.textContent || "").trim() || !getReviewRect(node.parentElement))
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (
      Array.from(range.getClientRects()).some(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight,
      )
    )
      return true;
  }
  return false;
}

export function isReviewTarget(element) {
  return (
    !!element &&
    !["HTML", "BODY", "HEAD", "MAIN"].includes(element.tagName) &&
    !element.closest('nav, header, form, [role="navigation"]') &&
    !!getReviewRect(element) &&
    hasReviewContent(element)
  );
}

export function reviewTargetIdentity(element) {
  if (!element) return "";
  return JSON.stringify([
    element.tagName,
    element.id,
    (element.innerText || "").trim().slice(0, 500),
    [
      element,
      ...Array.from(
        element.querySelectorAll("a[href], img, iframe, video"),
      ).slice(0, 20),
    ].map((node) => [
      node.tagName,
      node.href || "",
      node.currentSrc || node.src || "",
    ]),
  ]);
}

// The marker is an isolated overlay: never alter the site's outline, styles,
// scroll position or pointer events. Track only the short-lived active review.
export function watchReviewTarget(
  element,
  {
    identity = reviewTargetIdentity(element),
    isValid = () => true,
    onInvalid = () => {},
  } = {},
) {
  if (!isReviewTarget(element) || !isValid()) return null;
  const marker = document.createElement("div");
  marker.id = "adsfriendly-review-target";
  marker.setAttribute("data-afs-ui", "true");
  marker.setAttribute("aria-hidden", "true");
  marker.style.cssText =
    "all:initial!important;position:fixed!important;z-index:2147483646!important;pointer-events:none!important;";
  const shadow = marker.attachShadow({ mode: "closed" });
  const frame = document.createElement("div");
  frame.style.cssText =
    "box-sizing:border-box;width:100%;height:100%;border:2px solid #60a5fa;border-radius:5px;box-shadow:0 0 0 1px #0f172a66;";
  const label = document.createElement("span");
  label.textContent = "Reviewing this area";
  label.style.cssText =
    "position:absolute;top:2px;left:2px;padding:2px 5px;background:#172235;color:#fff;border-radius:3px;font:11px -apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap;";
  frame.appendChild(label);
  shadow.appendChild(frame);
  document.body.appendChild(marker);
  let timer = null;
  const cleanup = () => {
    clearTimeout(timer);
    marker.remove();
  };
  const update = () => {
    if (
      !isValid() ||
      !isReviewTarget(element) ||
      reviewTargetIdentity(element) !== identity
    ) {
      cleanup();
      onInvalid();
      return;
    }
    const rect = getReviewRect(element);
    for (const [key, value] of Object.entries({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }))
      marker.style.setProperty(key, value + "px", "important");
    timer = setTimeout(update, 150);
  };
  update();
  return cleanup;
}
