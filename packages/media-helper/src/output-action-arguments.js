import { dirname } from "node:path";

export function windowsRevealArguments(outputPath) {
  // ShellExecute opens the containing folder without relying on Explorer's
  // legacy /select parser, which truncates some paths containing spaces.
  return ["url.dll,FileProtocolHandler", dirname(outputPath)];
}
