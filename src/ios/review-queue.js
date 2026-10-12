export function createReviewQueue({ limit = 8 } = {}) {
  const pending = [];
  let current = null;
  return {
    enqueue(item) {
      if (
        current?.key === item.key ||
        pending.some((value) => value.key === item.key)
      )
        return false;
      if (pending.length >= limit) return false;
      pending.push(item);
      return true;
    },
    take() {
      if (!current) current = pending.shift() || null;
      return current;
    },
    finish() {
      const previous = current;
      current = null;
      return previous;
    },
    get size() {
      return pending.length + (current ? 1 : 0);
    },
    get active() {
      return current;
    },
  };
}

// Automatic banner reviews are deliberately scarce. This is document-local,
// not a persistent Keep rule: dismissal must never change saved protection.
export function createBannerReviewGate({ limit = 2, intervalMs = 60000 } = {}) {
  const reviewed = [];
  let lastPrompt = -Infinity;
  return {
    canPrompt(key, element, now = Date.now()) {
      if (reviewed.length >= limit || now - lastPrompt < intervalMs)
        return false;
      return !reviewed.some(
        (previous) =>
          previous.key === key ||
          previous.element === element ||
          previous.element?.contains?.(element) ||
          element?.contains?.(previous.element),
      );
    },
    record(key, element, now = Date.now()) {
      if (!this.canPrompt(key, element, now)) return false;
      reviewed.push({ key, element });
      lastPrompt = now;
      return true;
    },
  };
}
