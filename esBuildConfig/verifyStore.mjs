import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function readText(pathFromRoot) {
  return readFileSync(resolve(root, pathFromRoot), "utf8");
}

function readJson(pathFromRoot) {
  return JSON.parse(readText(pathFromRoot));
}

const errors = [];

const manifest = readJson("esBuildConfig/manifest.json");
const packageJson = readJson("package.json");

const store = readText("STORE.md");
const privacy = readText("PRIVACY.md");

const extensionNamesMatch = store.match(/## Extension Names\s+([\s\S]*?)\n## /);
if (!extensionNamesMatch) {
  errors.push("STORE.md must include an '## Extension Names' section.");
} else {
  const extensionNames = extensionNamesMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!extensionNames.some((line) => line.includes(`Chrome: ${manifest.name}`))) {
    errors.push(`STORE.md Chrome name must match the manifest (${manifest.name}).`);
  }
}

let summaryLine = "";
const summaryMatch = store.match(/## Summary \(short[^\n]*\)\s+([\s\S]*?)\n## /);
if (!summaryMatch) {
  errors.push("STORE.md must include the short summary section.");
} else {
  summaryLine = summaryMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  if (!summaryLine) {
    errors.push("STORE.md short summary cannot be empty.");
  } else if (summaryLine.length > 132) {
    errors.push(`STORE.md short summary must be <=132 chars (found ${summaryLine.length}).`);
  }
}
if (summaryLine && manifest.description !== summaryLine) {
  errors.push("The manifest description must match the STORE.md short summary.");
}
if (packageJson.description !== manifest.description) {
  errors.push("package.json description must match the manifest description.");
}

const requiredPermissionDocs = ["tabs", "storage", "scripting", "tabGroups", "<all_urls>"];
for (const permission of requiredPermissionDocs) {
  if (!store.includes(permission)) {
    errors.push(`STORE.md must document permission: ${permission}`);
  }
  if (!privacy.includes(permission)) {
    errors.push(`PRIVACY.md must document permission: ${permission}`);
  }
}

if (!store.includes("No data is sent to TabWheel")) {
  errors.push("STORE.md must state that no data is sent to TabWheel or developer-owned services.");
}
if (!store.includes("Works on Google Chrome")) {
  errors.push("STORE.md must state Chrome support.");
}
if (!privacy.includes("does not collect, transmit, or share")) {
  errors.push("PRIVACY.md summary must explicitly state no data collection/transmission.");
}
const retiredPermissionStatement = "does not request `history` or `bookmarks` permissions";
if (!store.includes(retiredPermissionStatement)) {
  errors.push("STORE.md must state that history/bookmarks permissions are not requested.");
}
if (!privacy.includes(retiredPermissionStatement)) {
  errors.push("PRIVACY.md must state that history/bookmarks permissions are not requested.");
}

if (errors.length > 0) {
  console.error("[verify:store] FAILED");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("[verify:store] OK");
console.log(`- Chrome name: ${manifest.name}`);
console.log(`- Description length: ${manifest.description.length}`);
console.log(`- Checked permissions docs: ${requiredPermissionDocs.length}`);
