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
  };
}
