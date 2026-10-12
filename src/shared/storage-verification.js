// Storage APIs may reorder object properties and omit undefined values. Compare
// JSON meaning, not insertion order; arrays still retain their original order.
export function storageValuesEqual(actual, expected) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .filter((key) => value[key] !== undefined)
          .map((key) => [key, normalize(value[key])]),
      );
    return value;
  };
  return (
    JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
  );
}

export function isStorageQuotaError(error) {
  const message = String(error?.message || error || "");
  // Older builds mistakenly wrapped verification failures in "storage full".
  if (/verification failed/i.test(message)) return false;
  return /\bquota(?:_bytes(?:_per_item)?)?\b.*(?:exceeded|exceeds|limit|full)|(?:storage|disk)(?:\s+is)?\s+full|(?:exceeded|exceeds).*(?:quota|storage.*limit)/i.test(
    message,
  );
}
