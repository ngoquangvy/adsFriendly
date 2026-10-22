import { normalizeSourceDiagnostic } from "../media/source-diagnostics.js";

// A developer disclosure, not another toast. Only sanitized metadata can be copied.
export function createMediaSourceDiagnostics({ document, clipboard }) {
  const panel = document.getElementById("media-source-diagnostics");
  let rows = [],
    signature = "";
  if (!panel) return () => {};
  const button = panel.querySelector("button");
  button.onclick = async () => {
    try {
      await clipboard.writeText(
        JSON.stringify(
          {
            version: 1,
            scope:
              "Memory only · current tab · expires after 15 minutes of inactivity",
            items: rows,
          },
          null,
          2,
        ),
      );
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed · retry";
    }
  };
  return (items = []) => {
    rows = items.slice(-50).flatMap((item) => {
      try {
        return [
          {
            ...normalizeSourceDiagnostic(item),
            frameId: Number.isInteger(item.frameId) ? item.frameId : -1,
            count: Number.isInteger(item.count)
              ? Math.max(1, Math.min(9999, item.count))
              : 1,
            firstSeenAt: Number.isSafeInteger(item.firstSeenAt)
              ? item.firstSeenAt
              : null,
            lastSeenAt: Number.isSafeInteger(item.lastSeenAt)
              ? item.lastSeenAt
              : null,
          },
        ];
      } catch {
        return [];
      }
    });
    panel.hidden = !rows.length;
    const next = JSON.stringify(rows);
    if (next === signature) return;
    signature = next;
    panel.querySelector("summary").textContent =
      `Source diagnostics · ${rows.length}`;
    panel.querySelector("pre").textContent = rows
      .map((row) =>
        [
          row.code,
          row.host,
          row.mime || row.extension,
          row.httpStatus,
          `frame ${row.frameId}`,
          `×${row.count}`,
        ]
          .filter(Boolean)
          .join(" · "),
      )
      .join("\n");
    button.textContent = "Copy diagnostics";
  };
}
