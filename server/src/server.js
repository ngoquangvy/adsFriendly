import http from "node:http";
import { createReadStream } from "node:fs";
import { config, paths } from "./config.js";
import { setCors, readJsonBody, sendJson, sendStatic } from "./http-utils.js";
import { normalizeBatch, normalizeEvent } from "./schema.js";
import {
  appendJsonl,
  ensureStorage,
  readJsonl,
  readReviewCandidates,
  readReviews,
  readStats,
} from "./storage.js";

await ensureStorage();

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "adsfriendly-telemetry",
        timestamp: Date.now(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ingest") {
      const body = await readJsonBody(req);
      const { accepted, rejected } = normalizeBatch(body);
      await appendJsonl(paths.dataset, accepted);
      await appendJsonl(paths.rejected, rejected);
      sendJson(res, rejected.length ? 207 : 200, {
        ok: true,
        accepted: accepted.length,
        rejected: rejected.length,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const limit = clamp(
        Number(url.searchParams.get("limit") || 250),
        1,
        2000,
      );
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      sendJson(res, 200, {
        ok: true,
        events: await readJsonl(paths.dataset, { limit, offset }),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/review") {
      const limit = clamp(Number(url.searchParams.get("limit") || 100), 1, 500);
      sendJson(res, 200, {
        ok: true,
        events: await readReviewCandidates({ limit }),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/reviews") {
      const limit = clamp(
        Number(url.searchParams.get("limit") || 250),
        1,
        1000,
      );
      sendJson(res, 200, { ok: true, events: await readReviews({ limit }) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/review") {
      const body = await readJsonBody(req);
      const review = normalizeReview(body);
      const normalized = normalizeEvent(review);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return;
      }
      await appendJsonl(paths.reviews, [normalized.event]);
      await appendJsonl(paths.dataset, [normalized.event]);
      sendJson(res, 200, { ok: true, event: normalized.event });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/rejected") {
      const limit = clamp(
        Number(url.searchParams.get("limit") || 250),
        1,
        2000,
      );
      sendJson(res, 200, {
        ok: true,
        events: await readJsonl(paths.rejected, { limit }),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      sendJson(res, 200, { ok: true, stats: await readStats() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/export.jsonl") {
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": "attachment; filename=adsfriendly-dataset.jsonl",
      });
      createReadStream(paths.dataset).pipe(res);
      return;
    }

    if (req.method === "GET") {
      await sendStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    sendJson(res, err.statusCode || 500, {
      ok: false,
      error: err.message || "Server error",
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(
    `AdsFriendly telemetry server listening at http://${config.host}:${config.port}`,
  );
  console.log(`Dataset: ${paths.dataset}`);
});

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeReview(body) {
  const original = body.event || {};
  const sampleId = body.sample_id || original.sample_id;
  const label = [
    "ad",
    "content",
    "false_positive",
    "false_negative",
    "unknown",
  ].includes(body.label)
    ? body.label
    : "unknown";
  return {
    schema_version: "dataset.v1",
    unit: "feedback",
    label,
    label_source: "manual_review",
    label_strength: "strong",
    ad_type: original.ad_type || body.ad_type || "unknown",
    site: original.site || body.site || { hostname: "unknown" },
    timestamp: Date.now(),
    context: {
      review_of: sampleId,
      original_unit: original.unit || null,
      original_label: original.label || null,
      original_label_source: original.label_source || null,
      reviewer_note: String(body.note || "").slice(0, 1000),
    },
    evidence: {
      original_context: original.context || {},
      original_evidence: original.evidence || {},
    },
    feedback: {
      review_of: sampleId,
      user_action: "manual_review",
      surface: "server_review_ui",
    },
    action: "label",
    outcome: `reviewed_${label}`,
  };
}
