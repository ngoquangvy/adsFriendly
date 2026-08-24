import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.adsfriendly.media_helper";
const extensionId = argument("--extension-id");
const sourceExecutable = resolve(
  argument("--exe") ||
    fileURLToPath(
      new URL("../dist/adsfriendly-media-helper.exe", import.meta.url),
    ),
);

if (process.platform !== "win32") {
  throw new Error("Native host registration currently targets Windows only.");
}
if (!/^[a-p]{32}$/.test(extensionId || "")) {
  throw new Error(
    "--extension-id must be the 32-character Chrome extension ID.",
  );
}
if (!process.env.LOCALAPPDATA) {
  throw new Error("LOCALAPPDATA is unavailable.");
}

const installDirectory = resolve(
  process.env.LOCALAPPDATA,
  "AdsFriendly",
  "MediaHelper",
);
const installedExecutable = resolve(
  installDirectory,
  "adsfriendly-media-helper.exe",
);
const manifestPath = resolve(installDirectory, "native-host.json");
await mkdir(installDirectory, { recursive: true });
await copyFile(sourceExecutable, installedExecutable);
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      name: HOST_NAME,
      description: "AdsFriendly optional media download helper",
      path: installedExecutable,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

execFileSync(
  "reg.exe",
  [
    "ADD",
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    manifestPath,
    "/f",
  ],
  { windowsHide: true, stdio: "inherit" },
);
process.stdout.write(`Registered ${HOST_NAME} for ${extensionId}.\n`);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
