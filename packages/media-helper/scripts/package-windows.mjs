import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("This packaging script currently targets Windows only.");
}

await import("./build.mjs");

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const distDirectory = resolve(packageRoot, "dist");
const hostBundle = resolve(distDirectory, "host.cjs");
const seaConfig = resolve(distDirectory, "sea-config.json");
const seaBlob = resolve(distDirectory, "media-helper.blob");
const executable = resolve(distDirectory, "adsfriendly-media-helper.exe");
const postjectCli = require.resolve("postject/dist/cli.js");

await mkdir(distDirectory, { recursive: true });
await Promise.all([
  rm(seaBlob, { force: true }),
  rm(executable, { force: true }),
]);
await writeFile(
  seaConfig,
  `${JSON.stringify(
    {
      main: hostBundle,
      output: seaBlob,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], {
  stdio: "inherit",
});
await copyFile(process.execPath, executable);

const signatureRemoval = spawnSync(
  "signtool.exe",
  ["remove", "/s", executable],
  { windowsHide: true, stdio: "ignore" },
);
if (signatureRemoval.error && signatureRemoval.error.code !== "ENOENT") {
  throw signatureRemoval.error;
}

execFileSync(
  process.execPath,
  [
    postjectCli,
    executable,
    "NODE_SEA_BLOB",
    seaBlob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { cwd: dirname(postjectCli), stdio: "inherit" },
);

await verifyExecutable(executable);

process.stdout.write(`Packaged ${executable}\n`);

async function verifyExecutable(path) {
  const child = spawn(path, ["chrome-extension://packaging-check/"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const body = Buffer.from(
    JSON.stringify({
      type: "helper.hello",
      requestId: "packaging-check",
      protocolVersion: 1,
      payload: { extensionVersion: "packaging-check" },
    }),
    "utf8",
  );
  const framed = Buffer.allocUnsafe(body.length + 4);
  framed.writeUInt32LE(body.length, 0);
  body.copy(framed, 4);
  child.stdin.end(framed);
  const response = await new Promise((resolveResponse, rejectResponse) => {
    let pending = Buffer.alloc(0);
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectResponse(new Error("Packaged helper handshake timed out."));
    }, 5_000);
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.stdout.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 4) return;
      const length = pending.readUInt32LE(0);
      if (pending.length < length + 4) return;
      clearTimeout(timeout);
      resolveResponse(
        JSON.parse(pending.subarray(4, length + 4).toString("utf8")),
      );
      child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectResponse(error);
    });
    child.on("exit", (code) => {
      if (code && pending.length < 4) {
        clearTimeout(timeout);
        rejectResponse(
          new Error(`Packaged helper exited with ${code}: ${stderr.trim()}`),
        );
      }
    });
  });
  if (
    response?.type !== "helper.ready" ||
    response.requestId !== "packaging-check"
  ) {
    throw new Error("Packaged helper failed its Native Messaging handshake.");
  }
}
