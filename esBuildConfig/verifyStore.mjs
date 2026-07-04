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

const manifestV2 = readJson("esBuildConfig/manifest_v2.json");
const manifestV3 = readJson("esBuildConfig/manifest_v3.json");

const store = readText("STORE.md");
const privacy = readText("PRIVACY.md");

if (manifestV2.description !== manifestV3.description) {
  errors.push("Manifest descriptions must match between MV2 and MV3.");
}

const extensionNamesMatch = store.match(/## Extension Names\s+([\s\S]*?)\n## /);
if (!extensionNamesMatch) {
  errors.push("STORE.md must include an '## Extension Names' section.");
} else {
  const extensionNames = extensionNamesMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!extensionNames.some((line) => line.includes(`Firefox / Zen: ${manifestV2.name}`))) {
    errors.push(`STORE.md Firefox / Zen name must match MV2 manifest (${manifestV2.name}).`);
  }
  if (!extensionNames.some((line) => line.includes(`Chrome: ${manifestV3.name}`))) {
    errors.push(`STORE.md Chrome name must match MV3 manifest (${manifestV3.name}).`);
  }
}

const summaryMatch = store.match(/## Summary \(short[^\n]*\)\s+([\s\S]*?)\n## /);
if (!summaryMatch) {
  errors.push("STORE.md must include the short summary section.");
} else {
  const summaryLine = summaryMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!summaryLine) {
    errors.push("STORE.md short summary cannot be empty.");
  } else if (summaryLine.length > 132) {
    errors.push(`STORE.md short summary must be <=132 chars (found ${summaryLine.length}).`);
  }
}

const requiredPermissionDocs = ["tabs", "storage", "search", "scripting", "tabGroups", "<all_urls>"];
for (const permission of requiredPermissionDocs) {
  if (!store.includes(permission)) {
    errors.push(`STORE.md must document permission: ${permission}`);
  }
  if (!privacy.includes(permission)) {
    errors.push(`PRIVACY.md must document permission: ${permission}`);
  }
}

if (!store.includes("No data leaves your browser")) {
  errors.push("STORE.md must state local-only data handling.");
}
if (!store.includes("Works on Firefox, Chrome, and Zen Browser")) {
  errors.push("STORE.md must mention Firefox/Chrome/Zen support.");
}
if (!privacy.includes("does not collect, transmit, or share")) {
  errors.push("PRIVACY.md summary must explicitly state no data collection/transmission.");
}

if (errors.length > 0) {
  console.error("[verify:store] FAILED");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("[verify:store] OK");
console.log(`- Firefox/Zen name: ${manifestV2.name}`);
console.log(`- Chrome name: ${manifestV3.name}`);
console.log(`- Description length: ${manifestV2.description.length}`);
console.log(`- Checked permissions docs: ${requiredPermissionDocs.length}`);
