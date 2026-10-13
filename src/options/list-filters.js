import { matchesSettingsSearch } from "./section-catalog.js";
import { isMediaJobActive } from "../media/download-job-view.js";

export function matchesDownloadFilter(status, filter) {
  if (filter === "active") return isMediaJobActive({ status });
  if (filter === "paused") return ["paused", "cancelled"].includes(status);
  return filter === "all" || status === filter;
}

// Hide existing rows rather than rebuilding them while typing: index-based
// delete handlers, expanded rule groups and keyboard focus remain intact.
export function createSettingsListFilters(
  document,
  onDownloadsFiltered = () => {},
) {
  const groups = [
    {
      input: "sites-search",
      status: "sites-search-status",
      selector:
        "#whitelist-list > .item, #blacklist-list > .item, #custom-rules-container > .rule-site, #learned-paths-container > .item",
    },
    {
      input: "activity-search",
      status: "activity-search-status",
      selector: "#blocked-logs-container > .item",
    },
    {
      input: "download-search",
      status: "download-search-status",
      selector: "#download-job-manager > .download-history-item",
      filter: "download-filter",
    },
  ];
  const listeners = [];
  function apply(group) {
    const query = document.getElementById(group.input).value;
    const filter = group.filter
      ? document.getElementById(group.filter).value
      : "all";
    const rows = [...document.querySelectorAll(group.selector)];
    for (const row of rows)
      row.hidden =
        !matchesSettingsSearch(
          [row.dataset.searchText || row.textContent],
          query,
        ) ||
        (group.filter && !matchesDownloadFilter(row.dataset.status, filter));
    const visible = rows.filter((row) => !row.hidden).length;
    document.getElementById(group.status).textContent = rows.length
      ? `${visible} of ${rows.length} entries${visible === 0 ? " · No matches" : ""}`
      : "";
    if (group.filter) onDownloadsFiltered();
  }
  for (const group of groups) {
    for (const [id, event] of [
      [group.input, "input"],
      ...(group.filter ? [[group.filter, "change"]] : []),
    ]) {
      const element = document.getElementById(id);
      const run = () => apply(group);
      element.addEventListener(event, run);
      listeners.push(() => element.removeEventListener(event, run));
    }
  }
  return {
    update: () => groups.forEach(apply),
    stop: () => listeners.forEach((remove) => remove()),
  };
}
