export interface DownloadCandidate {
  id: string;
  kind: "direct" | "hls";
  pageUrl: string;
  sourceUrl: string | null;
  manifestUrl: string | null;
  title: string | null;
  mimeType: string | null;
}

export interface DownloadJob {
  jobId: string;
  connections: number;
  outputDirectory: string | null;
  candidate: DownloadCandidate;
}

export interface DownloadProgress {
  phase: "probing" | "downloading" | "finalizing";
  downloadedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  resumable: boolean;
  resumedBytes: number;
}

export interface DownloadResult {
  outputPath: string;
  totalBytes: number | null;
  resumedBytes: number;
}

export interface DownloadContext {
  signal: AbortSignal;
  progress(value: DownloadProgress): void;
}

export interface DownloadAdapter {
  id: string;
  supports(candidate: DownloadCandidate): boolean;
  execute(job: DownloadJob, context: DownloadContext): Promise<DownloadResult>;
}
