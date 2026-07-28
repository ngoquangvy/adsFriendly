export function notifySpy(adMode) {
  window.postMessage(
    { source: "adsfriendly-content", type: "SET_AD_MODE", value: adMode },
    "*",
  );
}
export function startSpyBridge(onAdDetected) {
  window.addEventListener("message", (event) => {
    if (
      event.data?.source === "adsfriendly-spy" &&
      event.data.type === "AD_MAP_DETECTED"
    )
      onAdDetected();
    if (
      event.data?.source === "adsfriendly-content" &&
      event.data.type === "AD_DENSITY_VALUE" &&
      window.AdsFriendlyVideoState
    )
      window.AdsFriendlyVideoState.currentAdDensity = event.data.value;
  });
}
