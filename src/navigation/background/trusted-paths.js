export async function syncTrustedPath(source, target, isManual = false) {
  if (!source || !target || source === target) return;
  const key = `p:${source}>${target}`;
  const current = await chrome.storage.local.get([key]);
  const entry = current[key] || {
    source,
    target,
    visits: 0,
    isManual: false,
    lastUpdated: Date.now(),
  };
  entry.visits++;
  if (isManual) {
    entry.isManual = true;
    entry.visits = Math.max(entry.visits, 99);
  }
  entry.lastUpdated = Date.now();
  await chrome.storage.local.set({ [key]: entry });
}
export async function getTrustedPath(source, target) {
  const key = `p:${source}>${target}`;
  return (await chrome.storage.local.get([key]))[key] || null;
}
export async function handleUserDecision(message) {
  const { action, domain } = message;
  if (action === "WHITELIST") {
    const { whitelist = [], blacklist = [] } = await chrome.storage.local.get([
      "whitelist",
      "blacklist",
    ]);
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
    }
    await chrome.storage.local.set({
      whitelist,
      blacklist: blacklist.filter(
        (entry) =>
          String(entry || "")
            .replace(/^\|\|/, "")
            .replace(/\^$/, "") !== domain,
      ),
    });
  }
  if (action === "BLACKLIST") {
    const { blacklist = [], whitelist = [] } = await chrome.storage.local.get([
      "blacklist",
      "whitelist",
    ]);
    const rule = `||${domain}^`;
    if (!blacklist.includes(rule)) {
      blacklist.push(rule);
    }
    await chrome.storage.local.set({
      blacklist,
      whitelist: whitelist.filter((entry) => entry !== domain),
    });
  }
}
