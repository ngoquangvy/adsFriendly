import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// A local UI fixture only: actual Settings HTML/bundle plus mock Chrome APIs.
// Strict allowlist and loopback binding; never serves the workspace or user data.
const root = fileURLToPath(new URL("../", import.meta.url));
const allowed = new Set([
  "/options/options.html",
  "/options/options.js",
  "/options/settings-shell.css",
  "/icons/icon48.png",
  "/tests/settings-browser-bootstrap.js",
  "/packages/default-settings-package.json",
]);
createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (!allowed.has(path)) {
    response.writeHead(404).end();
    return;
  }
  try {
    let content = await readFile(resolve(root, `.${path}`));
    if (path.endsWith(".html"))
      content = content
        .toString()
        .replace(
          '<script src="options.js"></script>',
          '<script src="/tests/settings-browser-bootstrap.js"></script><script src="options.js"></script>',
        );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".png")
            ? "image/png"
            : path.endsWith(".json")
              ? "application/json"
              : "text/html",
    );
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(8768, "127.0.0.1", () =>
  console.log(
    "Settings UI fixture: http://127.0.0.1:8768/options/options.html",
  ),
);
