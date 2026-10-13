export const PLAYER_DOWNLOAD_NOTICE_MS = 3_000;

// A visibility transition, not a position/progress update, starts the notice.
// Transient UI state only: no settings writes, polling or persistent timers.
export function createPlayerDownloadAttention({
  onNotice,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let visible = false;
  let timer = null;
  let revision = 0;
  let disposed = false;
  function reset() {
    revision++;
    visible = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
    onNotice(false);
  }
  return {
    setVisible(next) {
      if (disposed || Boolean(next) === visible) return;
      if (!next) {
        reset();
        return;
      }
      visible = true;
      const expected = ++revision;
      onNotice(true);
      timer = setTimer(() => {
        if (disposed || expected !== revision || !visible) return;
        timer = null;
        onNotice(false);
      }, PLAYER_DOWNLOAD_NOTICE_MS);
    },
    reset() {
      if (!disposed) reset();
    },
    dispose() {
      if (!disposed) {
        reset();
        disposed = true;
      }
    },
  };
}
