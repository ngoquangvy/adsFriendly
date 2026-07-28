export function notifyContentScript(data) {
  window.postMessage({ source: "adsfriendly-spy", ...data }, "*");
}
export function onContentMessage(handler) {
  window.addEventListener("message", (event) => {
    if (event.data?.source === "adsfriendly-content") handler(event.data);
  });
}
