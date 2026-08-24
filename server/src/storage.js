import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { paths, config } from "./config.js";

export async function ensureStorage() {
  await fs.mkdir(config.storageDir, { recursive: true });
  await touch(paths.dataset);
  await touch(paths.rejected);
  await touch(paths.reviews);
}

export async function appendJsonl(filePath, records) {
  if (!records.length) return;
  const lines =
    records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await fs.appendFile(filePath, lines, "utf8");
}

export async function readJsonl(filePath, { limit = 500, offset = 0 } = {}) {
  const rows = [];
  let index = 0;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    if (index++ < offset) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push({ parse_error: true, line });
    }
    if (rows.length >= limit) break;
  }

  return rows;
}

export async function readStats() {
  const stats = {
    total: 0,
    byLabel: {},
    byUnit: {},
    byDomain: {},
    latestTimestamp: null,
  };

  const stream = createReadStream(paths.dataset, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      stats.total++;
      inc(stats.byLabel, event.label || "unknown");
      inc(stats.byUnit, event.unit || "unknown");
      inc(stats.byDomain, event.site?.hostname || "unknown");
      stats.latestTimestamp = Math.max(
        stats.latestTimestamp || 0,
        event.timestamp || 0,
      );
    } catch {}
  }

  return stats;
}

export async function readReviewCandidates({ limit = 100 } = {}) {
  const [events, reviews] = await Promise.all([
    readAllJsonl(paths.dataset),
    readAllJsonl(paths.reviews),
  ]);
  const reviewedIds = new Set(
    reviews
      .map((review) => review.context?.review_of || review.feedback?.review_of)
      .filter(Boolean),
  );

  return events
    .filter((event) => isReviewable(event, reviewedIds))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

export async function readReviews({ limit = 250 } = {}) {
  return (await readAllJsonl(paths.reviews))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

async function readAllJsonl(filePath) {
  const rows = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {}
  }

  return rows;
}

function isReviewable(event, reviewedIds) {
  if (!event?.sample_id || reviewedIds.has(event.sample_id)) return false;
  if (event.label_source === "manual_review") return false;
  if (event.label_strength === "strong") return false;
  return (
    event.label_strength === "weak" ||
    event.label === "unknown" ||
    /^heuristic|rule|model/i.test(event.label_source || "")
  );
}

async function touch(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "", "utf8");
  }
}

function inc(map, key) {
  map[key] = (map[key] || 0) + 1;
}
