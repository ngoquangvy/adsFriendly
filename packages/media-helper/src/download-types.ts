export interface DownloadCandidate {
  id: string;
  kind: "direct" | "hls" | "dash" | "adaptive";
  pageUrl: string;
  sourceUrl: string | null;
  manifestUrl: string | null;
  title: string | null;
  mimeType: string | null;
  duration: number | null;
  segmentCount: number | null;
  provider: string | null;
  acquisitionProfile: string | null;
  playerUrl: string | null;
  variants: AdaptiveHttpTrack[];
  audioTracks: AdaptiveHttpTrack[];
  manifestHandoff: {
    kind: "hls";
    manifestUrl: string;
    body: string;
    bodyBytes: number;
    revisionId: string | null;
  } | null;
  keyHandoff: {
    kind: "hls_aes_keys";
    manifestUrl: string;
    keys: Array<{ url: string; data: string; bytes: number }>;
  } | null;
  keyHandoffDiagnostic: {
    framesQueried: number;
    framesResponded: number;
    requestedManifestCount: number;
    matchedManifestCount: number;
    relatedManifestCount: number;
    relatedManifestBytes: number;
    childManifestCount: number;
    keyDirectiveCount: number;
    unsupportedKeyDirectiveCount: number;
    segmentDirectiveCount: number;
    encryptionMethods: string[];
    encryptionKeyFormats: string[];
    declaredKeyCount: number;
    capturedKeyCount: number;
    pageFetchAttemptCount: number;
    pageFetchSuccessCount: number;
    pageFetchStatuses: number[];
    pageFetchErrorCount: number;
    pageManifestFetchAttemptCount: number;
    pageManifestFetchSuccessCount: number;
    pageManifestFetchStatuses: number[];
    pageManifestFetchErrorCount: number;
  } | null;
  requestContext: {
    requestUrl: string | null;
    finalUrl: string | null;
    documentUrl: string | null;
    parentDocumentUrl: string | null;
    referrer: string | null;
    method: string;
    credentials: "omit" | "same-origin" | "include" | "unknown";
    requiresBrowserSession: boolean;
  } | null;
  /** Ephemeral request hints copied from a resolved provider track. */
  requestMode?: "youtube_query_range" | "http_range" | null;
  requestCpn?: string | null;
}

export interface AdaptiveHttpTrack {
  id: string;
  type: "video" | "audio";
  sourceUrl: string | null;
  mimeType: string | null;
  codecs: string | null;
  itag: string | null;
  bandwidth: number | null;
  averageBandwidth: number | null;
  contentLength: number | null;
  width: number | null;
  height: number | null;
  qualityLabel: string | null;
  urlResolution:
    | "resolved"
    | "n_transform_pending"
    | "signature_cipher_pending"
    | "provider_client_pending";
  signatureCipher: string | null;
  muxed: boolean;
  requestUserAgent?: string | null;
  providerClient?: string | null;
  /** Provider-specific byte request contract; kept ephemeral with the track. */
  requestMode?: "youtube_query_range" | "http_range" | null;
  requestCpn?: string | null;
}

export interface DownloadJob {
  jobId: string;
  connections: number;
  browserUserAgent: string | null;
  accessStrategyPreferences: Record<string, Record<string, number>>;
  outputDirectory: string | null;
  output: {
    profileId: "source" | "video-mp4" | "video-mkv" | "audio-ogg";
    container: "source" | "mp4" | "mkv" | "ogg";
    extension: string | null;
    videoTrackId: string | null;
    audioTrackId?: string | null;
    allowEquivalentVideo?: boolean;
  };
  candidate: DownloadCandidate;
}

export interface DownloadProgress {
  phase: "probing" | "downloading" | "finalizing";
  stage?:
    | "manifest_fetch"
    | "resource_check"
    | "output_prepare"
    | "ffmpeg_start"
    | "compatibility_check"
    | "provider_resolution"
    | "segment_download"
    | "local_assembly"
    | "local_processing";
  downloadedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  resumable: boolean;
  resumedBytes: number;
  processedSeconds?: number | null;
  duration?: number | null;
}

export interface DownloadResult {
  outputPath: string;
  totalBytes: number | null;
  resumedBytes: number;
}

export interface DownloadContext {
  signal: AbortSignal;
  progress(value: DownloadProgress): void;
  strategy(value: {
    resourceKind: "key";
    resourceHost: string;
    strategyId: string;
    outcome: "success" | "rejected" | "error";
    httpStatus: number | null;
    score: number;
  }): void;
}

export interface DownloadAdapter {
  id: string;
  supports(candidate: DownloadCandidate): boolean;
  execute(job: DownloadJob, context: DownloadContext): Promise<DownloadResult>;
}
