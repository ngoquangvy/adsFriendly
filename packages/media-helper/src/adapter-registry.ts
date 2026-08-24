import type { DownloadAdapter, DownloadCandidate } from "./download-types.js";

export class DownloadAdapterRegistry {
  private readonly adapters: DownloadAdapter[];

  constructor(adapters: DownloadAdapter[]) {
    this.adapters = [...adapters];
    const ids = this.adapters.map((adapter) => adapter.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Duplicate download adapter ID.");
    }
  }

  resolve(candidate: DownloadCandidate): DownloadAdapter {
    const adapter = this.adapters.find((item) => item.supports(candidate));
    if (!adapter) {
      throw new Error(`No download adapter supports "${candidate.kind}".`);
    }
    return adapter;
  }
}
