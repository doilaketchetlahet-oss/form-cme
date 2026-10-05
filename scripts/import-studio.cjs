// Rebuild upstream with VITE_BASE=./ before importing its dist folder.
// node scripts/import-studio.cjs "D:/Game Mới/dist"
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "studio");
const source = path.resolve(process.argv[2] || "D:/Game Mới/dist");

async function filesIn(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

async function main() {
  if (source === output || source.startsWith(output + path.sep)) throw new Error("Source must be outside studio.");
  const html = await fs.readFile(path.join(source, "index.html"), "utf8");
  if (!html.includes('src="./assets/')) throw new Error("Rebuild with VITE_BASE=./ before importing.");
  const expected = new Set();
  const replacements = new Map();
  const files = await filesIn(source);
  // Existing optimized images have the upstream content hash in their name.
  // Reuse them so a runtime-only rebuild does not recompress unchanged artwork.
  for (const file of files) {
    const relative = path.relative(source, file);
    if (!relative.startsWith("assets" + path.sep) || !/\.(png|jpe?g)$/i.test(relative)) continue;
    const webp = relative.replace(/\.(png|jpe?g)$/i, ".webp");
    const dest = path.join(output, webp);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try { await fs.access(dest); }
    catch {
      await sharp(file).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 }).toFile(dest);
    }
    replacements.set(path.basename(relative), path.basename(webp));
    expected.add(webp);
  }
  for (const file of files) {
    const relative = path.relative(source, file);
    if (replacements.has(path.basename(relative)) && relative.startsWith("assets" + path.sep)) continue;
    const dest = path.join(output, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (/\.(js|css|html|json)$/i.test(relative)) {
      let content = await fs.readFile(file, "utf8");
      for (const [original, optimized] of replacements) content = content.replaceAll(original, optimized);
      await fs.writeFile(dest, content);
    } else {
      await fs.copyFile(file, dest);
    }
    expected.add(relative);
  }
  // Only remove stale files from this exact managed output directory.
  if (path.resolve(output) !== path.join(root, "studio")) throw new Error("Invalid output path.");
  for (const file of await filesIn(output)) {
    if (!file.startsWith(output + path.sep)) throw new Error("File escaped studio.");
    if (!expected.has(path.relative(output, file))) await fs.unlink(file);
  }
  console.log(`Imported ${expected.size} studio files; optimized ${replacements.size} images.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
