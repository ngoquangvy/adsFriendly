// Shared Settings presenter; no storage, timers or transport state.
export function createDownloadProgressBar(document) {
  const track = document.createElement("div");
  track.className = "download-progress-track";
  const bar = document.createElement("div");
  bar.className = "download-progress-bar";
  track.append(bar);
  return track;
}

export function updateDownloadProgressBar(track, percent, active) {
  track.hidden = !active;
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", "Download progress");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  const known = Number.isFinite(percent);
  const value = known ? Math.max(0, Math.min(100, percent)) : null;
  track.classList.toggle("is-indeterminate", !known);
  track.querySelector(".download-progress-bar").style.width = known
    ? `${value}%`
    : "100%";
  if (known) {
    track.setAttribute("aria-valuenow", String(value));
    track.setAttribute("aria-valuetext", `${value}%`);
  } else {
    track.removeAttribute("aria-valuenow");
    track.setAttribute("aria-valuetext", "Progress not yet available");
  }
}
