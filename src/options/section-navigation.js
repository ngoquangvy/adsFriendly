import {
  SETTINGS_SECTIONS,
  resolveSettingsSection,
} from "./section-catalog.js";

const LAST_SECTION_KEY = "adsfriendly.settings.lastSection";
const ICON_PATHS = {
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z",
  rules: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1",
  package: "M12 3l9 5-9 5-9-5 9-5zm-9 5v10l9 5 9-5V8M12 13v10",
  download: "M12 3v12m-5-5l5 5 5-5M4 17v4h16v-4",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  tools: "M4 7h16M4 17h16M8 4v6m8 4v6",
};

// Navigation and visibility only. Each section's existing business handlers
// remain in the Settings controller; none are duplicated in the router.
export function createSettingsNavigation({ document, window, onActivate }) {
  const nav = document.getElementById("settings-navigation");
  const select = document.getElementById("settings-section-select");
  const title = document.getElementById("settings-page-title");
  const description = document.getElementById("settings-page-description");
  const links = new Map();
  const panels = new Map();
  let active = null;
  let stopped = false;
  for (const section of SETTINGS_SECTIONS) {
    const panel = document.getElementById(`settings-panel-${section.id}`);
    if (!panel) throw new Error(`Missing Settings section: ${section.id}`);
    panels.set(section.id, panel);
    const link = document.createElement("a");
    link.href = `#${section.id}`;
    link.className = "settings-nav-link";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[section.icon] || ICON_PATHS.tools);
    icon.append(path);
    const label = document.createElement("span");
    label.textContent = section.title;
    link.append(icon, label);
    nav.append(link);
    links.set(section.id, link);
    const option = document.createElement("option");
    option.value = section.id;
    option.textContent = section.title;
    select.append(option);
  }
  function remembered() {
    try {
      return window.sessionStorage.getItem(LAST_SECTION_KEY);
    } catch {
      return null;
    }
  }
  function activate() {
    if (stopped) return;
    const section = resolveSettingsSection(window.location.hash, remembered());
    const changed = section.id !== active;
    active = section.id;
    for (const [id, panel] of panels) panel.hidden = id !== active;
    for (const [id, link] of links) {
      if (id === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    select.value = active;
    title.textContent = section.title;
    description.textContent = section.description;
    document.title = `${section.title} · AdsFriendly Settings`;
    try {
      window.sessionStorage.setItem(LAST_SECTION_KEY, active);
    } catch {}
    if (changed) {
      document.getElementById("settings-main").scrollTop = 0;
      window.scrollTo?.({ top: 0, behavior: "instant" });
    }
    onActivate(section.id, { hash: window.location.hash, changed });
  }
  function onSelect() {
    window.location.hash = select.value;
  }
  // Native anchors preserve Back/Forward, deep links and modifier-clicks.
  window.addEventListener("hashchange", activate);
  select.addEventListener("change", onSelect);
  activate();
  return {
    isActive: (id) => active === id,
    current: () => active,
    stop() {
      stopped = true;
      window.removeEventListener("hashchange", activate);
      select.removeEventListener("change", onSelect);
    },
  };
}
