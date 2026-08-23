export function notifyContentScript(data) {
  window.postMessage({ source: "adsfriendly-spy", ...data }, "*");
}

export function onContentMessage(handler) {
  const onMessage = (event) => {
    if (event.data?.source === "adsfriendly-content") handler(event.data);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
