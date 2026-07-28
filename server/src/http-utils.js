import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > config.maxBodyBytes) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
  }
  return JSON.parse(body || "{}");
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export async function sendStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(paths.publicDir, safePath));
  if (!filePath.startsWith(paths.publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "text/plain; charset=utf-8" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}
