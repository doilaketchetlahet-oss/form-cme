// Update @vladmandic/human to the latest version and refresh the model files
// that are served from public/models/human.
//
// Usage: npm run update:human

const { execSync } = require("node:child_process");
const { copyFileSync, existsSync, mkdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkgDir = path.join(root, "node_modules", "@vladmandic", "human");
const modelsSrc = path.join(pkgDir, "models");
const modelsDest = path.join(root, "public", "models", "human");

const MODEL_FILES = [
  "blazeface.json",
  "blazeface.bin",
  "facemesh.json",
  "facemesh.bin",
  "faceres.json",
  "faceres.bin",
  "antispoof.json",
  "antispoof.bin",
  "models.json",
];

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { cwd: root, stdio: "inherit" });
}

function installedVersion() {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  return pkg.version;
}

console.log("Updating @vladmandic/human...");
run("npm install @vladmandic/human@latest");

if (!existsSync(modelsSrc)) {
  console.error(`\nKhông tìm thấy thư mục models: ${modelsSrc}`);
  process.exit(1);
}

mkdirSync(modelsDest, { recursive: true });

let copied = 0;
for (const file of MODEL_FILES) {
  const from = path.join(modelsSrc, file);
  if (!existsSync(from)) {
    console.warn(`Bỏ qua (không có): ${file}`);
    continue;
  }
  copyFileSync(from, path.join(modelsDest, file));
  copied += 1;
}

console.log(`\n✓ @vladmandic/human@${installedVersion()}`);
console.log(`✓ Đã copy ${copied} file model vào public/models/human`);
console.log("\nKiểm tra version trong package.json rồi commit (package.json + package-lock.json + public/models/human).");
