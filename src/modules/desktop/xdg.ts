export type DesktopFile = {
  name: string;
  genericName: string;
  comment: string;
  exec: string;
  tryExec: string;
  icon: string;
  categories: string;
  mimeTypes: string;
  terminal: boolean;
  noDisplay: boolean;
  hidden: boolean;
  wmClass: string;
  type: string;
  /** Localized values, e.g. { "ru": { name: "..." } }. */
  locales: Record<string, { name?: string; comment?: string; genericName?: string }>;
  /** Unrecognized keys preserved as-is. */
  extra: Record<string, string>;
};

const KNOWN = new Set([
  "Type", "Name", "GenericName", "Comment", "Exec", "TryExec", "Icon",
  "Categories", "MimeType", "Terminal", "NoDisplay", "Hidden", "StartupWMClass",
]);

function bool(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

/** Parses a .desktop (INI) file body; only the [Desktop Entry] group is read. */
export function parseDesktopFile(content: string): DesktopFile | null {
  const result: DesktopFile = {
    name: "",
    genericName: "",
    comment: "",
    exec: "",
    tryExec: "",
    icon: "",
    categories: "",
    mimeTypes: "",
    terminal: false,
    noDisplay: false,
    hidden: false,
    wmClass: "",
    type: "",
    locales: {},
    extra: {},
  };

  let inEntry = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    const localeMatch = key.match(/^(Name|GenericName|Comment)\[([^\]]+)\]$/);
    if (localeMatch) {
      const [, field, locale] = localeMatch as unknown as [string, string, string];
      result.locales[locale] ??= {};
      if (field === "Name") result.locales[locale]!.name = value;
      else if (field === "GenericName") result.locales[locale]!.genericName = value;
      else result.locales[locale]!.comment = value;
      continue;
    }

    switch (key) {
      case "Type": result.type = value; break;
      case "Name": result.name = value; break;
      case "GenericName": result.genericName = value; break;
      case "Comment": result.comment = value; break;
      case "Exec": result.exec = value; break;
      case "TryExec": result.tryExec = value; break;
      case "Icon": result.icon = value; break;
      case "Categories": result.categories = value; break;
      case "MimeType": result.mimeTypes = value; break;
      case "Terminal": result.terminal = bool(value); break;
      case "NoDisplay": result.noDisplay = bool(value); break;
      case "Hidden": result.hidden = bool(value); break;
      case "StartupWMClass": result.wmClass = value; break;
      default:
        if (!KNOWN.has(key)) result.extra[key] = value;
    }
  }

  return result.name ? result : null;
}
