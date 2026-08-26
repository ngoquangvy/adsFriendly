import { isRegisteredMediaAccessStrategy } from "../media/access-strategy-catalog.js";

const STORAGE_KEY = "mediaAccessStrategyMemory";
const MEMORY_VERSION = 1;
const MAX_HOSTS = 100;
const MAX_STRATEGIES_PER_HOST = 8;
let mutationQueue = Promise.resolve();

export function recordMediaAccessStrategyResult(value = {}) {
  const operation = mutationQueue.then(() => recordResult(value));
  mutationQueue = operation.catch(() => {});
  return operation;
}

async function recordResult(value) {
  const hostname = normalizeHostname(value.resourceHost);
  const strategyId = normalizeStrategyId(value.strategyId);
  const outcome = ["success", "rejected", "error"].includes(value.outcome)
    ? value.outcome
    : null;
  if (!hostname || !strategyId || !outcome) return { status: "ignored" };
  const snapshot = await chrome.storage.local.get(STORAGE_KEY);
  const memory = normalizeMemory(snapshot[STORAGE_KEY]);
  const host = memory[hostname] || { updatedAt: 0, strategies: {} };
  const current = host.strategies[strategyId] || {
    score: 0,
    successes: 0,
    failures: 0,
    lastOutcome: null,
  };
  if (outcome === "success") {
    current.successes += 1;
    current.score = Math.min(10, current.score + 2);
  } else {
    current.failures += 1;
    current.score = Math.max(
      -5,
      current.score - (outcome === "rejected" ? 0.5 : 1),
    );
  }
  current.lastOutcome = outcome;
  current.updatedAt = Date.now();
  host.updatedAt = current.updatedAt;
  host.strategies[strategyId] = current;
  host.strategies = Object.fromEntries(
    Object.entries(host.strategies)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_STRATEGIES_PER_HOST),
  );
  memory[hostname] = host;
  const bounded = Object.fromEntries(
    Object.entries(memory)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_HOSTS),
  );
  await chrome.storage.local.set({
    [STORAGE_KEY]: { version: MEMORY_VERSION, hosts: bounded },
  });
  return { status: "recorded" };
}

export async function getMediaAccessStrategyPreferences() {
  const snapshot = await chrome.storage.local.get(STORAGE_KEY);
  const memory = normalizeMemory(snapshot[STORAGE_KEY]);
  return Object.fromEntries(
    Object.entries(memory).map(([hostname, host]) => [
      hostname,
      Object.fromEntries(
        Object.entries(host.strategies).map(([strategyId, facts]) => [
          strategyId,
          Number(facts.score) || 0,
        ]),
      ),
    ]),
  );
}

function normalizeMemory(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rawHosts = value.version === MEMORY_VERSION ? value.hosts : value;
  if (!rawHosts || typeof rawHosts !== "object" || Array.isArray(rawHosts)) {
    return {};
  }
  const memory = {};
  for (const [hostname, rawHost] of Object.entries(rawHosts).slice(
    0,
    MAX_HOSTS,
  )) {
    const normalizedHost = normalizeHostname(hostname);
    if (!normalizedHost || !rawHost || typeof rawHost !== "object") continue;
    const strategies = {};
    for (const [strategyId, rawFacts] of Object.entries(
      rawHost.strategies || {},
    ).slice(0, MAX_STRATEGIES_PER_HOST)) {
      const normalizedId = normalizeStrategyId(strategyId);
      if (!normalizedId || !rawFacts || typeof rawFacts !== "object") continue;
      strategies[normalizedId] = {
        score: Math.max(-5, Math.min(10, Number(rawFacts.score) || 0)),
        successes: Math.max(0, Number(rawFacts.successes) || 0),
        failures: Math.max(0, Number(rawFacts.failures) || 0),
        lastOutcome: String(rawFacts.lastOutcome || "").slice(0, 20),
        updatedAt: Math.max(0, Number(rawFacts.updatedAt) || 0),
      };
    }
    memory[normalizedHost] = {
      updatedAt: Math.max(0, Number(rawHost.updatedAt) || 0),
      strategies,
    };
  }
  return memory;
}

function normalizeHostname(value) {
  const hostname = String(value || "").toLowerCase();
  return /^[a-z0-9.-]{1,253}$/.test(hostname) ? hostname : null;
}

function normalizeStrategyId(value) {
  const strategyId = String(value || "");
  return /^[a-z0-9_]{1,64}$/.test(strategyId) &&
    isRegisteredMediaAccessStrategy(strategyId)
    ? strategyId
    : null;
}
