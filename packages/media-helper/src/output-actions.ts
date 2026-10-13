import { spawn } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
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
  const outputPath = await resolveManagedOutput(rawPath);
  const output = await stat(outputPath);
  if (!output.isFile())
    throw new Error("Downloaded output file was not found.");
  return outputPath;
}

async function resolveManagedOutput(rawPath: string): Promise<string> {
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
  // Junctions/symlinks must not turn a managed Downloads path into arbitrary
  // filesystem access. No scanning or reading media bytes is needed.
  const [realRoot, realOutput] = await Promise.all([
    realpath(downloadsRoot),
    realpath(outputPath),
  ]);
  const realRelative = relative(realRoot, realOutput);
  if (
    !realRelative ||
    realRelative.startsWith("..") ||
    isAbsolute(realRelative)
  )
    throw new Error("Output path is outside the managed Downloads directory.");
  return realOutput;
}

export async function inspectManagedOutput(rawPath: string) {
  try {
    const outputPath = await resolveManagedOutput(rawPath);
    const output = await stat(outputPath);
    return output.isFile()
      ? { status: "available", size: output.size, modifiedAt: output.mtimeMs }
      : { status: "missing", size: null, modifiedAt: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "missing", size: null, modifiedAt: null };
    throw error;
  }
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
