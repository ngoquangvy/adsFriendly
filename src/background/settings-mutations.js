const MAX_RULES_PER_SITE = 250;

let defaultStore = null;

export function getSettingsMutationStore(storage = chrome.storage.local) {
  if (!defaultStore) defaultStore = createSettingsMutationStore(storage);
  return defaultStore;
}

export function createSettingsMutationStore(storage) {
  let mutationTail = Promise.resolve();

  const serial = (operation) => {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.catch(() => {});
    return result;
  };

  return Object.freeze({
    upsertCustomRules(hostname, incomingRules) {
      return serial(async () => {
        const host = normalizeHostname(hostname);
        const additions = normalizeRules(incomingRules);
        if (!host || !additions.length)
          throw new Error("No valid custom rules to save.");
        const { userCustomRules = {} } = await storage.get("userCustomRules");
        const existing = Array.isArray(userCustomRules[host])
          ? userCustomRules[host]
          : [];
        const bySelector = new Map(
          existing
            .filter((rule) => selectorOf(rule))
            .map((rule) => [selectorOf(rule), rule]),
        );
        additions.forEach((rule) => bySelector.set(selectorOf(rule), rule));
        userCustomRules[host] = [...bySelector.values()].slice(
          -MAX_RULES_PER_SITE,
        );
        await setAndVerify(storage, { userCustomRules });
        return {
          status: "saved",
          hostname: host,
          ruleCount: userCustomRules[host].length,
        };
      });
    },

    removeCustomRules(hostname, selectors) {
      return serial(async () => {
        const host = normalizeHostname(hostname);
        const selectorSet = new Set(
          (Array.isArray(selectors) ? selectors : [selectors])
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        );
        if (!host || !selectorSet.size)
          throw new Error("No valid custom rules to remove.");
        const { userCustomRules = {} } = await storage.get("userCustomRules");
        const existing = Array.isArray(userCustomRules[host])
          ? userCustomRules[host]
          : [];
        const remaining = existing.filter(
          (rule) => !selectorSet.has(selectorOf(rule)),
        );
        if (remaining.length) userCustomRules[host] = remaining;
        else delete userCustomRules[host];
        await setAndVerify(storage, { userCustomRules });
        return { status: "saved", hostname: host, ruleCount: remaining.length };
      });
    },

    restoreCustomRules(hostname, selectors = null) {
      return serial(async () => {
        const host = normalizeHostname(hostname);
        const selectorSet = normalizeSelectorSet(selectors);
        if (!host || !selectorSet.size)
          throw new Error("No valid custom rules to restore.");
        const { userCustomRules = {} } = await storage.get("userCustomRules");
        const existing = Array.isArray(userCustomRules[host])
          ? userCustomRules[host]
          : [];
        const restored = existing.filter((rule) =>
          selectorSet.has(selectorOf(rule)),
        );
        const remaining = existing.filter(
          (rule) => !selectorSet.has(selectorOf(rule)),
        );
        if (remaining.length) userCustomRules[host] = remaining;
        else delete userCustomRules[host];

        await setAndVerify(storage, { userCustomRules });
        return {
          status: "saved",
          hostname: host,
          restoredCount: restored.length,
          ruleCount: remaining.length,
        };
      });
    },

    resetCustomRules(hostname) {
      return serial(async () => {
        const host = normalizeHostname(hostname);
        if (!host) throw new Error("Invalid hostname for site reset.");
        const { userCustomRules = {}, siteResetHistory = {} } =
          await storage.get(["userCustomRules", "siteResetHistory"]);
        const removed = Array.isArray(userCustomRules[host])
          ? userCustomRules[host]
          : [];
        delete userCustomRules[host];
        siteResetHistory[host] = { oldRules: removed, timestamp: Date.now() };
        await setAndVerify(storage, { userCustomRules, siteResetHistory });
        return {
          status: "saved",
          hostname: host,
          restoredCount: removed.length,
        };
      });
    },

    saveDomainDecision(action, domain) {
      return serial(async () => {
        const hostname = normalizeHostname(domain);
        if (!hostname) throw new Error("Invalid domain decision.");
        const { whitelist = [], blacklist = [] } = await storage.get([
          "whitelist",
          "blacklist",
        ]);
        let nextWhitelist = [...whitelist];
        let nextBlacklist = [...blacklist];
        if (action === "WHITELIST") {
          nextWhitelist = [...new Set([...nextWhitelist, hostname])];
          nextBlacklist = nextBlacklist.filter(
            (entry) => normalizeHostname(entry) !== hostname,
          );
        } else if (action === "BLACKLIST") {
          nextBlacklist = [...new Set([...nextBlacklist, `||${hostname}^`])];
          nextWhitelist = nextWhitelist.filter(
            (entry) => normalizeHostname(entry) !== hostname,
          );
        } else {
          throw new Error(`Unsupported domain action: ${String(action)}`);
        }
        await setAndVerify(storage, {
          whitelist: nextWhitelist,
          blacklist: nextBlacklist,
        });
        return { status: "saved", action, domain: hostname };
      });
    },

    removeDomainDecision(listName, domain) {
      return serial(async () => {
        const hostname = normalizeHostname(domain);
        if (!hostname || !["whitelist", "blacklist"].includes(listName))
          throw new Error("Invalid domain removal.");
        const current = await storage.get(listName);
        const next = (current[listName] || []).filter(
          (entry) => normalizeHostname(entry) !== hostname,
        );
        await setAndVerify(storage, { [listName]: next });
        return { status: "saved", listName, domain: hostname };
      });
    },
  });
}

export async function getStorageHealth(storage = chrome.storage.local) {
  const bytesInUse =
    typeof storage.getBytesInUse === "function"
      ? await storage.getBytesInUse(null)
      : null;
  let unlimited = false;
  try {
    unlimited = await chrome.permissions.contains({
      permissions: ["unlimitedStorage"],
    });
  } catch {}
  return { status: "ok", bytesInUse, unlimited };
}

async function setAndVerify(storage, updates) {
  try {
    await storage.set(updates);
    const saved = await storage.get(Object.keys(updates));
    for (const [key, expected] of Object.entries(updates)) {
      if (JSON.stringify(saved[key]) !== JSON.stringify(expected)) {
        throw new Error(`Storage verification failed for ${key}.`);
      }
    }
  } catch (error) {
    const message = String(error?.message || error);
    if (/quota|bytes|storage/i.test(message)) {
      throw new Error(`Settings storage is full: ${message}`);
    }
    throw error;
  }
}

function normalizeRules(rules) {
  return (Array.isArray(rules) ? rules : [rules])
    .filter((rule) => rule && typeof rule === "object")
    .filter((rule) => selectorOf(rule));
}

function normalizeSelectorSet(selectors) {
  if (selectors == null) return new Set();
  return new Set(
    (Array.isArray(selectors) ? selectors : [selectors])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
}

function selectorOf(rule) {
  return typeof rule === "string"
    ? rule.trim()
    : String(rule?.selector || "").trim();
}

function normalizeHostname(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^\|\|/, "")
    .replace(/\^$/, "");
  if (!raw) return "";
  try {
    const hostname = new URL(
      raw.includes("://") ? raw : `https://${raw}`,
    ).hostname.toLowerCase();
    return /^[a-z0-9.-]+$/.test(hostname) ? hostname : "";
  } catch {
    return "";
  }
}
