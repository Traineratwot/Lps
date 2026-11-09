import { describe, expect, test } from "bun:test";
import { parseDesktopFile } from "./xdg.ts";

const DESKTOP = `[Desktop Entry]
Type=Application
Name=Firefox
Name[ru]=Файрфокс
GenericName=Web Browser
Comment=Browse the Web
Comment[ru]=Веб-браузер
Exec=firefox %u
TryExec=firefox
Icon=firefox
Categories=Network;WebBrowser;
MimeType=text/html;
Terminal=false
NoDisplay=false
Hidden=false
StartupWMClass=firefox
X-Extra-Key=extra-value

[Desktop Action new-window]
Name=New Window
`;

describe("parseDesktopFile", () => {
  test("parses standard keys", () => {
    const d = parseDesktopFile(DESKTOP);
    expect(d).not.toBeNull();
    expect(d!.name).toBe("Firefox");
    expect(d!.type).toBe("Application");
    expect(d!.exec).toBe("firefox %u");
    expect(d!.tryExec).toBe("firefox");
    expect(d!.icon).toBe("firefox");
    expect(d!.categories).toBe("Network;WebBrowser;");
    expect(d!.mimeTypes).toBe("text/html;");
    expect(d!.terminal).toBe(false);
    expect(d!.noDisplay).toBe(false);
    expect(d!.wmClass).toBe("firefox");
  });

  test("collects localized values and extras", () => {
    const d = parseDesktopFile(DESKTOP)!;
    expect(d.locales.ru?.name).toBe("Файрфокс");
    expect(d.locales.ru?.comment).toBe("Веб-браузер");
    expect(d.extra["X-Extra-Key"]).toBe("extra-value");
  });

  test("ignores non-[Desktop Entry] groups", () => {
    const d = parseDesktopFile(DESKTOP)!;
    // "New Window" lives in the Action group and must not override Name
    expect(d.name).toBe("Firefox");
  });

  test("boolean keys", () => {
    const d = parseDesktopFile("[Desktop Entry]\nName=T\nNoDisplay=true\nHidden=true\n")!;
    expect(d.noDisplay).toBe(true);
    expect(d.hidden).toBe(true);
  });

  test("returns null without Name", () => {
    expect(parseDesktopFile("[Desktop Entry]\nType=Application\n")).toBeNull();
    expect(parseDesktopFile("")).toBeNull();
  });
});
