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

const manifestV2 = loadJson("manifest_v2.json");
const manifestV3 = loadJson("manifest_v3.json");

const errors = [];
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

if (!SEMVER_RE.test(String(manifestV2.version || "")) || !SEMVER_RE.test(String(manifestV3.version || ""))) {
  errors.push("Both manifests must use a semver version string (x.y.z).");
}

for (const [name, manifest] of [
  ["MV2", manifestV2],
  ["MV3", manifestV3],
]) {
  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push(`${name} must declare a non-empty "name".`);
  }
  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push(`${name} must declare a non-empty "description".`);
  }
}

const requiredV2Permissions = ["tabs", "storage", "search", "<all_urls>"];
if (!hasAll(manifestV2.permissions || [], requiredV2Permissions)) {
  errors.push("MV2 is missing required permissions for runtime features.");
}

const geckoSettings = manifestV2.browser_specific_settings?.gecko;
if (!geckoSettings?.id || typeof geckoSettings.id !== "string") {
  errors.push("MV2 must declare browser_specific_settings.gecko.id for AMO signing.");
}

const requiredDataCollection = geckoSettings?.data_collection_permissions?.required;
if (!Array.isArray(requiredDataCollection) || requiredDataCollection.length === 0) {
  errors.push("MV2 must declare gecko.data_collection_permissions.required for AMO submissions.");
} else if (!requiredDataCollection.includes("none")) {
  errors.push("MV2 data_collection_permissions.required must include \"none\" for no external data collection.");
}

const requiredV3Permissions = ["scripting", "tabs", "storage", "search", "tabGroups"];
if (!hasAll(manifestV3.permissions || [], requiredV3Permissions)) {
  errors.push("MV3 is missing required permissions for runtime features.");
}

if (!hasAll(manifestV3.host_permissions || [], ["<all_urls>"])) {
  errors.push("MV3 host_permissions must include <all_urls> for content script coverage.");
}

const suggestedCount = countSuggestedCommands(manifestV3.commands);
if (suggestedCount !== 0) {
  errors.push(`MV3 should not declare keyboard shortcuts for the TabWheel pivot (found ${suggestedCount}).`);
}

if (manifestV2.commands || manifestV3.commands) {
  errors.push("TabWheel manifests must not declare legacy commands.");
}

if (manifestV2.options_ui?.page !== "optionsPage/optionsPage.html") {
  errors.push('MV2 options_ui.page must be "optionsPage/optionsPage.html".');
}
if (manifestV3.options_ui?.page !== "optionsPage/optionsPage.html") {
  errors.push('MV3 options_ui.page must be "optionsPage/optionsPage.html".');
}

const v2Popup = manifestV2.browser_action?.default_popup;
const v3Popup = manifestV3.action?.default_popup;
if (v2Popup !== "toolbarPopup/toolbarPopup.html" || v3Popup !== "toolbarPopup/toolbarPopup.html") {
  errors.push('Both manifests must use "toolbarPopup/toolbarPopup.html" as default popup.');
}

for (const [name, manifest] of [
  ["MV2", manifestV2],
  ["MV3", manifestV3],
]) {
  const contentScript = manifest.content_scripts?.[0];
  if (contentScript?.run_at !== "document_start") {
    errors.push(`${name} content script must run at document_start to claim page gestures early.`);
  }
  if (contentScript?.all_frames !== true) {
    errors.push(`${name} content script must run in all frames for editable iframe reliability.`);
  }
  if (contentScript?.match_about_blank !== true) {
    errors.push(`${name} content script must match about:blank child frames where supported.`);
  }
}

for (const [name, manifest] of [
  ["MV2", manifestV2],
  ["MV3", manifestV3],
]) {
  const icons = manifest.icons || {};
  for (const size of ["48", "96", "128"]) {
    if (!icons[size]) {
      errors.push(`${name} icons must include size ${size}.`);
    }
  }
}

const requiredSourceFiles = [
  "src/entryPoints/contentScript/contentScript.ts",
  "src/entryPoints/backgroundRuntime/background.ts",
  "src/entryPoints/optionsPage/optionsPage.html",
  "src/entryPoints/optionsPage/optionsPage.css",
  "src/entryPoints/toolbarPopup/toolbarPopup.html",
  "src/entryPoints/toolbarPopup/toolbarPopup.css",
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
console.log(`- MV2 permissions: ${(manifestV2.permissions || []).length}`);
console.log(`- MV3 permissions: ${(manifestV3.permissions || []).length}`);
console.log(`- MV3 suggested shortcuts: ${suggestedCount}`);
