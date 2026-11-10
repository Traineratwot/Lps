/**
 * Generates PNG/ICO favicon assets from assets/icon.svg.
 * Run: bun run icons
 * Outputs (committed to the repo):
 *   src/web/public/favicon.svg   — SVG favicon (modern browsers)
 *   src/web/public/favicon.ico   — ICO with 16+32px PNG entries
 *   src/web/public/favicon-16.png / favicon-32.png
 *   assets/icon-512.png          — GitHub avatar / social preview source
 *   assets/social-preview.png    — 1280×640 GitHub social preview
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const SVG = join(ROOT, "assets", "icon.svg");
const PUBLIC = join(ROOT, "src", "web", "public");
const ASSETS = join(ROOT, "assets");

mkdirSync(PUBLIC, { recursive: true });

async function png(size: number): Promise<Buffer> {
  return sharp(SVG, { density: (size / 64) * 300 })
    .resize(size, size)
    .png()
    .toBuffer();
}

/** Minimal ICO container wrapping PNG images (supported since Windows Vista). */
function makeIco(entries: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir: Buffer[] = [];
  let offset = 6 + entries.length * 16;
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette colors
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

const png16 = await png(16);
const png32 = await png(32);
const png180 = await png(180);
const png512 = await png(512);

copyFileSync(SVG, join(PUBLIC, "favicon.svg"));
writeFileSync(join(PUBLIC, "favicon-16.png"), png16);
writeFileSync(join(PUBLIC, "favicon-32.png"), png32);
writeFileSync(join(PUBLIC, "icon-180.png"), png180);
writeFileSync(join(PUBLIC, "favicon.ico"), makeIco([{ size: 16, data: png16 }, { size: 32, data: png32 }]));
writeFileSync(join(ASSETS, "icon-512.png"), png512);

// social preview: 1280×640, icon centered on the brand gradient
const icon = await sharp(SVG, { density: 450 }).resize(360, 360).png().toBuffer();
await sharp({
  create: { width: 1280, height: 640, channels: 4, background: { r: 37, g: 78, b: 216, alpha: 1 } },
})
  .composite([{ input: icon, gravity: "center" }])
  .png()
  .toFile(join(ASSETS, "social-preview.png"));

console.log("icons generated:", { png16: png16.length, png32: png32.length, ico: "favicon.ico", png512: png512.length });
