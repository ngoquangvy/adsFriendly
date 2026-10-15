import { assertSafeRemoteUrl, fetchRemote } from "./http-remote.js";
import { rangeRequest, probeFailure } from "./http-transfer-types.js";
import type { HttpTransferSource, SourceProbe } from "./http-transfer-types.js";

// Only HTTP metadata and range support. Provider preflights are injected.
export async function probeHttpSource(
  source: HttpTransferSource,
  signal: AbortSignal,
): Promise<SourceProbe> {
  await assertSafeRemoteUrl(source.url);
  const firstRange = rangeRequest(source, source.url, {
    index: 0,
    start: 0,
    end: 0,
    length: 1,
  });
  const openRange = () =>
    fetchRemote(firstRange.url, {
      headers: firstRange.headers,
      signal,
    });
  let response =
    firstRange.acceptsFullResponse || source.preferRangeProbe
      ? await openRange()
      : await fetchRemote(source.url, {
          method: "HEAD",
          headers: source.headers,
          signal,
        });
  if (
    !response.ok ||
    !positiveInteger(response.headers.get("content-length"))
  ) {
    await response.body?.cancel().catch(() => {});
    response = await openRange();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(probeFailure(source, firstRange.url, response.status));
  }
  await assertSafeRemoteUrl(response.url);
  const totalBytes =
    positiveInteger(
      response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1],
    ) ||
    (firstRange.acceptsFullResponse && positiveInteger(source.rangeSizeHint)) ||
    positiveInteger(response.headers.get("content-length"));
  let acceptsRanges =
    firstRange.acceptsFullResponse ||
    response.status === 206 ||
    response.headers.get("accept-ranges")?.toLowerCase() === "bytes";
  if (
    source.verifyRangeSupport !== false &&
    !firstRange.acceptsFullResponse &&
    response.status !== 206 &&
    acceptsRanges
  ) {
    const verification = await openRange();
    acceptsRanges = verification.status === 206;
    await verification.body?.cancel().catch(() => {});
  }
  await response.body?.cancel().catch(() => {});
  const probe = {
    url: response.url || source.url,
    totalBytes: totalBytes || null,
    acceptsRanges,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
  };
  await source.afterProbe?.(probe, signal);
  return probe;
}

function positiveInteger(value: string | number | null | undefined) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
