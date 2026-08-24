import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const checkOnly = process.argv.includes("--check");
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("../src/host.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/host.cjs", import.meta.url)),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["node20"],
  sourcemap: checkOnly ? false : "linked",
  legalComments: "none",
  logLevel: "info",
  write: !checkOnly,
});

if (checkOnly) process.stderr.write("Media helper build check passed.\n");
