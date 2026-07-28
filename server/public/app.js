const state = {
  events: [],
  review: [],
  stats: null,
};

document.getElementById("refresh").addEventListener("click", load);
load();

async function load() {
  const [statsRes, eventsRes, reviewRes] = await Promise.all([
    fetch("/api/stats").then((res) => res.json()),
    fetch("/api/events?limit=500").then((res) => res.json()),
    fetch("/api/review?limit=80").then((res) => res.json()),
  ]);
  state.stats = statsRes.stats;
  state.events = eventsRes.events || [];
  state.review = reviewRes.events || [];
  renderStats();
  renderReview();
  renderEvents();
}

function renderStats() {
  const stats = state.stats || {};
  const byLabel = stats.byLabel || {};
  const byUnit = stats.byUnit || {};
  document.getElementById("stats").innerHTML = [
    statCard("Total Events", stats.total || 0),
    statCard("Ad Labels", byLabel.ad || 0),
    statCard("Unknown Labels", byLabel.unknown || 0),
    statCard("Review Queue", state.review.length || 0),
  ].join("");
}

function renderReview() {
  const list = document.getElementById("review-list");
  document.getElementById("review-count").textContent =
    `${state.review.length} weak labels`;

  if (!state.review.length) {
    list.innerHTML = `<div class="empty">No weak labels waiting for review.</div>`;
    return;
  }

  list.innerHTML = state.review
    .map((event, index) => {
      const features = event.evidence?.features || {};
      const reasons = event.evidence?.reasons || [];
      const selector =
        event.context?.selector || features.id || features.className || "";
      return `
        <article class="review-card" data-index="${index}">
          <div class="review-main">
            <div class="review-domain">${escapeHtml(event.site?.hostname || "unknown")}</div>
            <div class="review-selector">${escapeHtml(selector || event.sample_id || "")}</div>
            <div class="review-meta">
              <span>${escapeHtml(event.unit || "unknown")}</span>
              <span>${escapeHtml(event.label || "unknown")}</span>
              <span>${escapeHtml(event.label_source || "unknown")}</span>
              <span>${formatPct(event.context?.confidence)}</span>
            </div>
            <div class="chips">
              ${reasons
                .slice(0, 8)
                .map((reason) => `<span>${escapeHtml(reason)}</span>`)
                .join("")}
            </div>
            <div class="review-feature">${escapeHtml(featureSummary(features))}</div>
          </div>
          <div class="review-actions">
            <button data-label="ad">Ad</button>
            <button data-label="content">Content</button>
            <button data-label="false_positive">False positive</button>
            <button data-label="unknown">Unsure</button>
          </div>
        </article>
      `;
    })
    .join("");

  list.querySelectorAll("button[data-label]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const card = button.closest(".review-card");
      const reviewedEvent = state.review[Number(card.dataset.index)];
      await submitReview(reviewedEvent, button.dataset.label);
    });
  });

  list.querySelectorAll(".review-card").forEach((card) => {
    card.addEventListener("click", () => {
      const event = state.review[Number(card.dataset.index)];
      document.getElementById("selected").textContent = JSON.stringify(
        event,
        null,
        2,
      );
    });
  });
}

async function submitReview(event, label) {
  const response = await fetch("/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sample_id: event.sample_id, label, event }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    alert(body.error || "Could not save review.");
    return;
  }
  await load();
}

function renderEvents() {
  const tbody = document.getElementById("events");
  document.getElementById("event-count").textContent =
    `${state.events.length} shown`;

  tbody.innerHTML = state.events
    .slice()
    .reverse()
    .map((event, index) => {
      const actualIndex = state.events.length - index - 1;
      return `
        <tr data-index="${actualIndex}">
          <td>${formatTime(event.timestamp)}</td>
          <td>${escapeHtml(event.site?.hostname || "unknown")}</td>
          <td>${escapeHtml(event.unit || "unknown")}</td>
          <td><span class="badge ${escapeHtml(event.label || "unknown")}">${escapeHtml(event.label || "unknown")}</span></td>
          <td>${escapeHtml(event.label_source || "unknown")}</td>
          <td>${escapeHtml(event.action || "")}</td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", () => {
      const event = state.events[Number(row.dataset.index)];
      document.getElementById("selected").textContent = JSON.stringify(
        event,
        null,
        2,
      );
    });
  });
}

function statCard(label, value) {
  return `
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>
  `;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function formatPct(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
}

function featureSummary(features) {
  return [
    features.tag ? `tag:${features.tag}` : "",
    features.id ? `id:${features.id}` : "",
    features.className ? `class:${features.className}` : "",
    features.srcHost ? `src:${features.srcHost}` : "",
    features.hrefHost ? `href:${features.hrefHost}` : "",
    features.rect?.width && features.rect?.height
      ? `rect:${features.rect.width}x${features.rect.height}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
