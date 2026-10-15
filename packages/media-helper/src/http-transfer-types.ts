// Transport contracts contain no media candidates, browser APIs or provider IDs.
export interface ByteRange {
  index: number;
  start: number;
  end: number;
  length: number;
}

export interface SourceProbe {
  url: string;
  totalBytes: number | null;
  acceptsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  contentDisposition: string | null;
}

export interface HttpRangeRequest {
  url: string;
  headers: Record<string, string>;
  // Some providers encode the range in the URL and acknowledge with HTTP 200.
  acceptsFullResponse: boolean;
}

export interface HttpTransferSource {
  url: string;
  headers: Record<string, string>;
  preferRangeProbe?: boolean;
  rangeSizeHint?: number | null;
  verifyRangeSupport?: boolean;
  rangeRequest?: (
    url: string,
    range: ByteRange,
    etag?: string | null,
  ) => HttpRangeRequest;
  afterProbe?: (probe: SourceProbe, signal: AbortSignal) => Promise<void>;
  probeFailure?: (url: string, status: number) => string;
  rangeFailure?: (
    url: string,
    status: number,
    range: ByteRange,
    request: HttpRangeRequest,
  ) => string;
}

export function rangeRequest(
  source: HttpTransferSource,
  url: string,
  range: ByteRange,
  etag?: string | null,
): HttpRangeRequest {
  return (
    source.rangeRequest?.(url, range, etag) || {
      url,
      headers: {
        ...source.headers,
        Range: `bytes=${range.start}-${range.end}`,
        ...(etag ? { "If-Range": etag } : {}),
      },
      acceptsFullResponse: false,
    }
  );
}

export function probeFailure(
  source: HttpTransferSource,
  url: string,
  status: number,
) {
  return (
    source.probeFailure?.(url, status) ||
    `Media server returned HTTP ${status} during the initial probe.`
  );
}
