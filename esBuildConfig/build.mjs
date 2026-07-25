import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const watching = process.argv.includes("--watch");

const targetIdx = process.argv.indexOf("--target");
const target = targetIdx !== -1 ? process.argv[targetIdx + 1] : "firefox";
if (!["firefox", "chrome"].includes(target)) {
  console.error(`[build] Unknown target "${target}". Use "firefox" or "chrome".`);
  process.exit(1);
}

const manifestFile = target === "chrome" ? "manifest_v3.json" : "manifest_v2.json";
const targetBrand = "Scroll Wheel Tab Switcher";
console.log(`[build] Target: ${target} (${manifestFile}, ${targetBrand})`);

// Extension entry points run as standalone scripts, so keep bundles as IIFEs
// instead of relying on module loading in content/background contexts.
const shared = {
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: false,
  sourcemap: false,
};

const entryPoints = [
  { in: resolve(root, "src/entryPoints/backgroundRuntime/background.ts"), out: "background" },
  { in: resolve(root, "src/entryPoints/contentScript/contentScript.ts"), out: "contentScript" },
  { in: resolve(root, "src/entryPoints/toolbarPopup/toolbarPopup.ts"), out: "toolbarPopup/toolbarPopup" },
  { in: resolve(root, "src/entryPoints/optionsPage/optionsPage.ts"), out: "optionsPage/optionsPage" },
  { in: resolve(root, "src/entryPoints/onboarding/onboarding.ts"), out: "onboarding/onboarding" },
];

// Manifests are target-specific, but HTML/CSS templates are shared and get the
// browser-facing name substituted during the copy.
const staticFiles = [
  { from: resolve(__dirname, manifestFile), to: "manifest.json" },
  { from: resolve(root, "src/entryPoints/toolbarPopup/toolbarPopup.html"), to: "toolbarPopup/toolbarPopup.html", branded: true },
  { from: resolve(root, "src/entryPoints/toolbarPopup/toolbarPopup.css"), to: "toolbarPopup/toolbarPopup.css", branded: true },
  { from: resolve(root, "src/entryPoints/optionsPage/optionsPage.html"), to: "optionsPage/optionsPage.html", branded: true },
  { from: resolve(root, "src/entryPoints/optionsPage/optionsPage.css"), to: "optionsPage/optionsPage.css", branded: true },
  { from: resolve(root, "src/entryPoints/onboarding/onboarding.html"), to: "onboarding/onboarding.html", branded: true },
  { from: resolve(root, "src/entryPoints/onboarding/onboarding.css"), to: "onboarding/onboarding.css", branded: true },
  { from: resolve(root, "src/icons/icon-16.png"), to: "icons/icon-16.png" },
  { from: resolve(root, "src/icons/icon-32.png"), to: "icons/icon-32.png" },
  { from: resolve(root, "src/icons/icon-48.png"), to: "icons/icon-48.png" },
  { from: resolve(root, "src/icons/icon-96.png"), to: "icons/icon-96.png" },
  { from: resolve(root, "src/icons/icon-128.png"), to: "icons/icon-128.png" },
];

function copyStatic() {
  for (const { from, to, branded } of staticFiles) {
    const dest = resolve(dist, to);
    mkdirSync(dirname(dest), { recursive: true });
    if (branded) {
      const source = readFileSync(from, "utf8");
      writeFileSync(dest, source.replaceAll("__EXTENSION_NAME__", targetBrand));
      continue;
    }
    cpSync(from, dest);
  }
  console.log("[build] Static assets copied");
}

async function main() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  copyStatic();

  const buildOptions = {
    ...shared,
    entryPoints: entryPoints.map((e) => ({
      in: e.in,
      out: e.out,
    })),
    outdir: dist,
    loader: { ".css": "text" },
  };

  if (watching) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log("[build] Watching for changes...");
  } else {
    await build(buildOptions);
    console.log("[build] Done");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
