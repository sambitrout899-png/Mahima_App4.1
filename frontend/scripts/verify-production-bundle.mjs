import { readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const appSource = await readFile(new URL("src/App.jsx", projectRoot), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(`Production bundle verification failed: ${message}`);
}

function routeWindow(path) {
  const marker = `path="${path}"`;
  const start = appSource.indexOf(marker);
  assert(start >= 0, `missing ${path} route`);
  return appSource.slice(start, start + 700);
}

assert(
  appSource.includes('import TeamsPage from "./features/teams/TeamsPage"'),
  "App.jsx must use the current Teams implementation"
);
assert(
  appSource.includes('import TasksPage from "./features/tasks/Page"'),
  "App.jsx must use the Tasks implementation"
);
assert(routeWindow("teams").includes("<TeamsPage />"), "Teams route is mapped to the wrong page");
assert(routeWindow("tasks").includes("<TasksPage />"), "Tasks route is mapped to the wrong page");

// Namespace imports can otherwise become `(void 0)()` when a deployment omits
// an API export. Check the paired marketing sources before accepting a build.
const marketingPage = await readFile(new URL("src/features/admin/DigitalMarketingPage.jsx", projectRoot), "utf8");
const marketingApi = await readFile(new URL("src/api/marketingAutomationApi.js", projectRoot), "utf8");
const marketingExports = new Set([...marketingApi.matchAll(/export\s+(?:const|(?:async\s+)?function)\s+(\w+)/g)].map(x => x[1]));
for (const [, method] of marketingPage.matchAll(/\bmarketing\.(\w+)\s*\(/g)) {
  assert(marketingExports.has(method), `marketingAutomationApi.js is missing ${method}; deploy the paired marketing sources together`);
}

const distRoot = new URL("dist/", projectRoot);
const indexHtml = await readFile(new URL("index.html", distRoot), "utf8");
const jsAssets = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)]
  .map((match) => match[1].split("?")[0]);
assert(jsAssets.length > 0, "dist/index.html does not reference a JavaScript entry asset");

const bundleParts = await Promise.all(
  jsAssets.map(async (assetPath) => {
    const relativePath = assetPath.replace(/^\/+/, "");
    return {
      assetPath,
      content: await readFile(new URL(relativePath, distRoot), "utf8"),
    };
  })
);
const bundle = bundleParts.map((asset) => asset.content).join("\n");
const entryNames = bundleParts.map((asset) => asset.assetPath).join(", ");

assert(bundle.includes("Stay on top of what matters"), "Tasks page is missing from the production bundle");
assert(bundle.includes("Manage ministry teams and their members."), "current Teams page is missing from the production bundle");
assert(!bundle.includes("Diagnostics Log"), `legacy Teams diagnostics page is present in the active entry: ${entryNames}`);
assert(!bundle.includes("GET /api/teams failed"), `legacy Teams API caller is present in the active entry: ${entryNames}`);
assert(!bundle.includes("/api/api/teams"), `duplicate Teams API path is present in the active entry: ${entryNames}`);

console.log(`Production bundle verified (${entryNames}).`);
