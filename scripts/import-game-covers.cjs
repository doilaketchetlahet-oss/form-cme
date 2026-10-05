// node scripts/import-game-covers.cjs "D:/Game Mới"
// Preserve the original artwork; optimize only the catalog copies.
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const source = path.resolve(process.argv[2] || "D:/Game Mới");
const covers = {
  quiz: "src/modules/Quiz/images/design.png",
  jigsaw: "src/modules/Jigsaw/images/demo.png",
  trucxanh: "src/modules/TrucXanh/images/demo.png",
  decodeletters: "src/modules/DecodeLetters/images/demo.png",
  wordsearch: "src/modules/WordSearch/images/demo.png",
  picword: "src/modules/PicWord/images/demo.png",
  connect: "src/modules/Connect/images/demo.png",
  unlock: "src/modules/Unlock/images/demo.png",
  bridgedash: "src/modules/BridgeDash/images/background.png",
  pulsecourier: "src/modules/PulseCourier/demo.png",
  balloon: "shots/06-balloon.png",
  hidden: "shots/09-hidden.png",
  wheel: "shots/08-wheel.png",
};

async function main() {
  // Confirm every source before writing any files.
  for (const file of Object.values(covers)) await fs.access(path.join(source, file));
  const output = path.join(root, "public/games/covers");
  await fs.mkdir(output, { recursive: true });
  for (const [id, file] of Object.entries(covers)) {
    await sharp(path.join(source, file)).resize({ width: 960, withoutEnlargement: true })
      .webp({ quality: 85 }).toFile(path.join(output, `${id}.webp`));
  }
  const catalogPath = path.join(root, "src/config/gameModules.json");
  const modules = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  for (const mod of modules) {
    if (covers[mod.id]) mod.cover = `/games/covers/${mod.id}.webp`;
  }
  await fs.writeFile(catalogPath, JSON.stringify(modules, null, 2) + "\n");
  console.log(`Imported ${Object.keys(covers).length} game covers from ${source}.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
