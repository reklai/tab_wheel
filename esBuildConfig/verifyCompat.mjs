import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJson(file) {
  return JSON.parse(readFileSync(resolve(__dirname, file), "utf8"));
}

function fileExists(pathFromRoot) {
  return existsSync(resolve(root, pathFromRoot));
}

function hasAll(actual, required) {
  return required.every((item) => actual.includes(item));
}

function countSuggestedCommands(commands) {
  return Object.values(commands || {}).filter((command) => command?.suggested_key).length;
}

const manifest = loadJson("manifest.json");

const errors = [];
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

if (manifest.manifest_version !== 3) {
  errors.push("The manifest must be Manifest V3.");
}
if (!SEMVER_RE.test(String(manifest.version || ""))) {
  errors.push("The manifest must use a semver version string (x.y.z).");
}
if (!manifest.name || typeof manifest.name !== "string") {
  errors.push('The manifest must declare a non-empty "name".');
}
if (!manifest.description || typeof manifest.description !== "string") {
  errors.push('The manifest must declare a non-empty "description".');
}

const requiredPermissions = ["scripting", "tabs", "storage", "tabGroups"];
if (!hasAll(manifest.permissions || [], requiredPermissions)) {
  errors.push("The manifest is missing required permissions for runtime features.");
}

if (!hasAll(manifest.host_permissions || [], ["<all_urls>"])) {
  errors.push("host_permissions must include <all_urls> for content script coverage.");
}

const suggestedCount = countSuggestedCommands(manifest.commands);
if (manifest.commands) {
  errors.push("The manifest must not declare legacy commands or keyboard shortcuts.");
}

if (manifest.options_ui?.page !== "optionsPage/optionsPage.html") {
  errors.push('options_ui.page must be "optionsPage/optionsPage.html".');
}

if (manifest.action?.default_popup !== "toolbarPopup/toolbarPopup.html") {
  errors.push('action.default_popup must be "toolbarPopup/toolbarPopup.html".');
}

const contentScript = manifest.content_scripts?.[0];
if (contentScript?.run_at !== "document_start") {
  errors.push("The content script must run at document_start to claim page gestures early.");
}
if (contentScript?.all_frames !== true) {
  errors.push("The content script must run in all frames for editable iframe reliability.");
}
if (contentScript?.match_about_blank !== true) {
  errors.push("The content script must match about:blank child frames.");
}

const icons = manifest.icons || {};
for (const size of ["48", "96", "128"]) {
  if (!icons[size]) {
    errors.push(`Manifest icons must include size ${size}.`);
  }
}

const requiredSourceFiles = [
  "src/entryPoints/contentScript/contentScript.ts",
  "src/entryPoints/backgroundRuntime/background.ts",
  "src/entryPoints/optionsPage/optionsPage.html",
  "src/entryPoints/optionsPage/optionsPage.css",
  "src/entryPoints/toolbarPopup/toolbarPopup.html",
  "src/entryPoints/toolbarPopup/toolbarPopup.css",
  "src/entryPoints/onboarding/onboarding.html",
  "src/entryPoints/onboarding/onboarding.css",
  "src/icons/icon-48.png",
  "src/icons/icon-96.png",
  "src/icons/icon-128.png",
];
for (const requiredFile of requiredSourceFiles) {
  if (!fileExists(requiredFile)) {
    errors.push(`Missing required source asset: ${requiredFile}`);
  }
}

if (errors.length > 0) {
  console.error("[verify:compat] FAILED");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("[verify:compat] OK");
console.log(`- Permissions: ${(manifest.permissions || []).length}`);
console.log(`- Suggested shortcuts: ${suggestedCount}`);
