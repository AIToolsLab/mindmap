import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(projectRoot, "dist");
const productionEnv = loadEnv("production", projectRoot, "VITE_");
const expectedBackendUrl = productionEnv.VITE_BACKEND_URL?.trim() ?? "";
const expectedClientId = productionEnv.VITE_OAUTH_CLIENT_ID?.trim() ?? "";
const searchableExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt"]);

function fail(message) {
  throw new Error(`Pages artifact verification failed: ${message}`);
}

function validateConfiguration() {
  if (!expectedBackendUrl) fail("VITE_BACKEND_URL is missing from .env.production.");
  let parsed;
  try {
    parsed = new URL(expectedBackendUrl);
  } catch {
    fail(`VITE_BACKEND_URL is not a valid absolute URL: ${expectedBackendUrl}`);
  }
  if (parsed.protocol !== "https:") fail(`VITE_BACKEND_URL must use HTTPS, received: ${expectedBackendUrl}`);
  if (!expectedClientId) fail("VITE_OAUTH_CLIENT_ID is missing from .env.production.");
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

validateConfiguration();
const indexPath = join(distRoot, "index.html");
if (!(await stat(indexPath).catch(() => null))?.isFile()) fail("dist/index.html is missing.");
const files = await filesBelow(distRoot);
if (files.length === 0) fail("dist is empty.");
const environmentFiles = files.filter((path) => {
  const name = path.slice(distRoot.length + 1).split(/[\\/]/).at(-1) ?? "";
  return name === ".env" || name.startsWith(".env.");
});
if (environmentFiles.length) fail(`environment files were published: ${environmentFiles.join(", ")}`);

let compiledText = "";
for (const path of files) {
  if (searchableExtensions.has(extname(path).toLowerCase())) compiledText += await readFile(path, "utf8");
}
if (!compiledText.includes(expectedBackendUrl)) fail(`the compiled output does not contain ${expectedBackendUrl}.`);
if (!compiledText.includes(expectedClientId)) fail(`the compiled output does not contain ${expectedClientId}.`);
console.log(`Pages artifact verified for ${expectedBackendUrl} and ${expectedClientId}.`);
