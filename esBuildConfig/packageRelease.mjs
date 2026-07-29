import { readFileSync, rmSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const releaseDir = resolve(root, "release");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseArtifacts = [
  resolve(releaseDir, `tabwheel-firefox-v${version}.xpi`),
  resolve(releaseDir, `tabwheel-chrome-v${version}.zip`),
  resolve(releaseDir, `tabwheel-source-v${version}.zip`),
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function zipDirectory(sourceDir, archivePath) {
  run("zip", ["-r", "-q", archivePath, "."], { cwd: sourceDir });
}

function ensureCleanSourceTree() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: root, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    throw new Error("git status failed before source packaging");
  }
  if (result.stdout.trim()) {
    throw new Error("Source packaging requires a clean Git worktree");
  }
}

function archiveSource(archivePath) {
  run("git", [
    "archive",
    "--format=zip",
    `--output=${archivePath}`,
    "HEAD",
    "--",
    ".",
    ":(exclude)release",
  ]);
}

function main() {
  ensureCleanSourceTree();

  mkdirSync(releaseDir, { recursive: true });
  for (const artifactPath of releaseArtifacts) {
    rmSync(artifactPath, { force: true });
  }

  run("npm", ["run", "build:firefox"]);
  zipDirectory(dist, releaseArtifacts[0]);

  run("npm", ["run", "build:chrome"]);
  zipDirectory(dist, releaseArtifacts[1]);

  archiveSource(releaseArtifacts[2]);

  console.log("[release] Done");
  console.log(`- release/tabwheel-firefox-v${version}.xpi`);
  console.log(`- release/tabwheel-chrome-v${version}.zip`);
  console.log(`- release/tabwheel-source-v${version}.zip`);
}

try {
  main();
} catch (error) {
  console.error("[release] FAILED");
  console.error(error);
  process.exit(1);
}
