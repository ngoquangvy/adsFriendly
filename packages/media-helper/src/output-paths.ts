import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join } from "node:path";

export function resolveOutputDirectory(value: string | null) {
  if (!value) return join(homedir(), "Downloads", "AdsFriendly");
  if (!isAbsolute(value)) throw new Error("Output directory must be absolute.");
  return value;
}

export function sanitizeFilename(value: string, fallbackExtension: string) {
  let name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
  if (!name || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) {
    name = `video${fallbackExtension}`;
  }
  if (!extname(name)) name += fallbackExtension;
  return name;
}

export async function availableOutputPath(directory: string, filename: string) {
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  for (let index = 0; index < 1000; index++) {
    const candidate = join(
      directory,
      index ? `${stem} (${index})${extension}` : filename,
    );
    if (!(await stat(candidate).catch(() => null))) return candidate;
  }
  throw new Error("Could not choose an available output filename.");
}
