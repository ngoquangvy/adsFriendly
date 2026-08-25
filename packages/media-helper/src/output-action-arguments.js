export function windowsRevealArguments(outputPath) {
  // Explorer parses /select,<path> as one switch. Passing the path as a second
  // process argument opens inconsistently, especially when it contains spaces.
  return [`/select,${outputPath}`];
}
