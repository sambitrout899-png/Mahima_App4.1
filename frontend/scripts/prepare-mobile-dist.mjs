import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptsDir, "..");
const excludedMobileAssets = [
  path.join(frontendDir, "dist", "media", "mahima-platform-tour.mp4"),
];

for (const assetPath of excludedMobileAssets) {
  await rm(assetPath, { force: true });
  console.log(`[mobile-build] Excluded ${path.relative(frontendDir, assetPath)} from the native bundle.`);
}
