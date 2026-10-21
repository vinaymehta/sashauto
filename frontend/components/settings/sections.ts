// Settings pages, grouped in categories as on the All Settings page. `group` is the AppSetting group the page edits
// (backend AppSetting::DEFINITIONS); `href` links to another page instead (e.g. Users).
export interface SettingsSection {
  slug: string;
  title: string;
  description: string;
  category: string;
  group?: string;
  href?: string;
}

export const SETTINGS_CATEGORIES = ["Organization", "Documents", "Notifications", "Integrations"] as const;

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { slug: "company", title: "Company profile", category: "Organization", group: "Company",
    description: "Name, address, GSTIN and contact details on purchase orders, letters and emails." },
  { slug: "businesses", title: "Businesses", category: "Organization", group: "Businesses",
    description: "Currency of DTP's and GMBH's Deere prices, used on the dashboard." },
  { slug: "intimation-letter", title: "Intimation Letter", category: "Documents", group: "Intimation Letter",
    description: "Export council registration, export period and signatory printed on the letter." },
  { slug: "notifications", title: "Alerts and Slack", category: "Notifications", group: "Notifications",
    description: "Who gets the alert emails, the default Ship To and the Slack webhook." },
  { slug: "deere-portal", title: "Deere portal", category: "Integrations", group: "Deere portal",
    description: "Portal login and the supplier to download for DTP and GMBH." },
];

export const sectionHref = (s: SettingsSection) => s.href ?? `/settings/${s.slug}`;
