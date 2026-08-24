export function isExtensionContextInvalidated(error) {
  return /extension context invalidated/i.test(String(error?.message || error));
}
