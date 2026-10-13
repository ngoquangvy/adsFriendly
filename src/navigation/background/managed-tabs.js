const ACTION_TTL_MS = 5000;
const MANAGED_ACTIONS = new Set([
  "extension_action",
  "download_manager",
  "element_decisions",
  "user_restore",
  "user_open_once",
  "user_allow_source",
]);

// Register before tabs.create; bind to the actual returned tab, not to a URL-wide
// whitelist. A matching in-flight URL only defers attribution until the API settles.
export function createManagedTabRegistry({
  now = () => Date.now(),
  maximum = 32,
} = {}) {
  const pending = new Set();
  const receipts = new Map();
  let nextId = 0;
  const prune = () => {
    for (const action of pending)
      if (action.expiresAt <= now()) pending.delete(action);
    for (const [id, receipt] of receipts)
      if (receipt.expiresAt <= now()) receipts.delete(id);
  };
  const owns = (tabId, url) => {
    prune();
    const receipt = receipts.get(tabId);
    return receipt?.url === url ? receipt : null;
  };
  const matching = (tab) =>
    [...pending].filter(
      (action) =>
        action.expiresAt > now() &&
        action.url === (tab.pendingUrl || tab.url) &&
        (!Number.isInteger(tab.windowId) ||
          !Number.isInteger(action.windowId) ||
          action.windowId === tab.windowId),
    );
  const open = async (
    properties,
    {
      reason = "extension_action",
      create = (value) => chrome.tabs.create(value),
    } = {},
  ) => {
    prune();
    if (!MANAGED_ACTIONS.has(reason))
      throw new Error(
        "Unknown managed tab action. Register its purpose before use.",
      );
    const target = new URL(properties.url);
    if (!["http:", "https:", "chrome-extension:"].includes(target.protocol))
      throw new Error("Unsupported managed tab destination.");
    if (pending.size >= maximum)
      throw new Error("Too many pending extension tab actions.");
    let finish;
    const action = {
      url: target.href,
      windowId: properties.windowId,
      expiresAt: now() + ACTION_TTL_MS,
      reason,
      settled: new Promise((resolve) => {
        finish = resolve;
      }),
    };
    pending.add(action);
    try {
      const tab = await create(properties);
      if (Number.isInteger(tab?.id)) {
        receipts.set(tab.id, {
          url: action.url,
          reason,
          navigationId: `nav-${now().toString(36)}-managed-${++nextId}`,
          expiresAt: now() + ACTION_TTL_MS,
        });
        while (receipts.size > maximum)
          receipts.delete(receipts.keys().next().value);
      }
      return tab;
    } finally {
      pending.delete(action);
      finish();
    }
  };
  const waitForCreatedTab = async (tab) => {
    if (owns(tab.id, tab.pendingUrl || tab.url)) return true;
    const actions = matching(tab);
    if (!actions.length) return false;
    let timeout;
    try {
      await Promise.race([
        Promise.all(actions.map((action) => action.settled)),
        new Promise((resolve) => {
          timeout = setTimeout(resolve, ACTION_TTL_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    return Boolean(owns(tab.id, tab.pendingUrl || tab.url));
  };
  return {
    open,
    owns,
    hasPending: (tab) => matching(tab).length > 0,
    waitForCreatedTab,
    removeTab: (tabId) => receipts.delete(tabId),
    clear: () => receipts.clear(),
  };
}

export const managedNavigationTabs = createManagedTabRegistry();
export const openExtensionManagedTab = (properties, reason) =>
  managedNavigationTabs.open(properties, { reason });
