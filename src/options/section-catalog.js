// Register each top-level Settings page here. The router knows nothing about
// protection/download implementation; aliases keep existing extension links.
export const SETTINGS_SECTIONS = Object.freeze(
  [
    {
      id: "protection",
      title: "Protection",
      description: "Choose how AdsFriendly protects your browsing.",
      icon: "shield",
    },
    {
      id: "sites",
      title: "Sites & Rules",
      description:
        "Manage allowed sites, blocked sites and personal page decisions.",
      icon: "rules",
      aliases: ["element-decisions"],
    },
    {
      id: "packages",
      title: "Settings Package",
      description: "Save, share or install an editable settings snapshot.",
      icon: "package",
    },
    {
      id: "downloads",
      title: "Downloads",
      description: "Manage downloads and files without leaving Settings.",
      icon: "download",
    },
    {
      id: "activity",
      title: "Activity",
      description: "Review recent navigation blocks.",
      icon: "activity",
    },
    {
      id: "advanced",
      title: "Advanced",
      description:
        "Local training data, developer diagnostics and storage tools.",
      icon: "tools",
    },
  ].map((section) =>
    Object.freeze({
      ...section,
      aliases: Object.freeze(section.aliases || []),
    }),
  ),
);

export function resolveSettingsSection(hash, remembered = null) {
  const requested = String(hash || "").replace(/^#/, "");
  const direct = SETTINGS_SECTIONS.find(
    (section) =>
      section.id === requested || section.aliases.includes(requested),
  );
  // An explicit (even unknown) URL takes precedence over the previous page.
  if (requested) return direct || SETTINGS_SECTIONS[0];
  return (
    SETTINGS_SECTIONS.find((section) => section.id === remembered) ||
    SETTINGS_SECTIONS[0]
  );
}

export function matchesSettingsSearch(values, query) {
  const needle = String(query || "")
    .trim()
    .toLocaleLowerCase();
  return (
    !needle ||
    values.some((value) =>
      String(value || "")
        .toLocaleLowerCase()
        .includes(needle),
    )
  );
}
