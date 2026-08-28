import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { windowsRevealArguments } from "./output-action-arguments.js";

export async function openManagedOutput(rawPath: string): Promise<void> {
  const outputPath = await managedOutputPath(rawPath);
  if (process.platform === "win32")
    return spawnDetached("explorer.exe", [outputPath]);
  if (process.platform === "darwin") return spawnDetached("open", [outputPath]);
  return spawnDetached("xdg-open", [outputPath]);
}

export async function revealManagedOutput(rawPath: string): Promise<void> {
  const outputPath = await managedOutputPath(rawPath);
  if (process.platform === "win32")
    return spawnDetached("rundll32.exe", windowsRevealArguments(outputPath));
  if (process.platform === "darwin")
    return spawnDetached("open", ["-R", outputPath]);
  return spawnDetached("xdg-open", [resolve(outputPath, "..")]);
}

async function managedOutputPath(rawPath: string): Promise<string> {
  if (!isAbsolute(rawPath)) throw new Error("Output path must be absolute.");
  const downloadsRoot = resolve(homedir(), "Downloads");
  const outputPath = resolve(rawPath);
  const fromDownloads = relative(downloadsRoot, outputPath);
  if (
    !fromDownloads ||
    fromDownloads.startsWith("..") ||
    isAbsolute(fromDownloads)
  ) {
    throw new Error("Output path is outside the managed Downloads directory.");
  }
  const output = await stat(outputPath);
  if (!output.isFile())
    throw new Error("Downloaded output file was not found.");
  return outputPath;
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}
