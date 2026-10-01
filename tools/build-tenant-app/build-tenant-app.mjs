#!/usr/bin/env node
// Builds a distinctly-branded Android APK for one tenant: fetches that tenant's
// name/logo from the API, regenerates the Capacitor Android app's icon set from
// the logo, bakes the tenant's slug into the bundled web assets so the installed
// app knows which church it belongs to, builds + signs the APK with a per-tenant
// applicationId, uploads it to that tenant's release channel, then restores the
// repo to its default ("Mahima Ministries") branding. See README.md in this
// folder for full usage and prerequisites (Firebase push notifications).
import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const frontendDir = path.join(repoRoot, "frontend");
const androidDir = path.join(frontendDir, "android");
const resDir = path.join(androidDir, "app", "src", "main", "res");
const provisionFilePath = path.join(frontendDir, "public", "tenant-provision.json");

function parseArgs(argv) {
  const args = { apiBase: process.env.MAHIMA_API_BASE || "https://beta.mahimaministries.in/api" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--slug") args.slug = argv[++i];
    else if (arg === "--admin-token") args.adminToken = argv[++i];
    else if (arg === "--api-base") args.apiBase = argv[++i];
    else if (arg === "--version") args.version = argv[++i];
    else if (arg === "--build") args.build = argv[++i];
    else if (arg === "--min-supported-version") args.minSupportedVersion = argv[++i];
    else if (arg === "--release-notes") args.releaseNotes = argv[++i];
    else if (arg === "--force-upgrade") args.forceUpgrade = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--skip-upload") args.skipUpload = true;
    else if (arg === "--tenant-name") args.tenantNameArg = argv[++i];
    else if (arg === "--logo-url") args.logoUrlArg = argv[++i];
    else if (arg === "--primary-color") args.primaryColorArg = argv[++i];
  }
  args.adminToken = args.adminToken || process.env.MAHIMA_ADMIN_TOKEN;
  return args;
}

// Throws rather than exiting directly, so callers inside main()'s try/finally
// still run the res/ + tenant-provision.json restore before the process exits.
function fail(message) {
  throw new Error(message);
}

const isWindows = process.platform === "win32";

// npm/npx/gradlew.bat are .cmd/.bat files, which Node can only launch via a
// shell on Windows. shell:true does not quote array args for us, so - since
// some values here (the tenant's display name) come from an admin-editable DB
// field - we quote defensively rather than trust it's shell-metacharacter-free.
function quoteForWindowsShell(value) {
  const str = String(value);
  return /[\s"]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function run(command, cmdArgs, cwd) {
  console.log(`\n[build-tenant-app] $ ${command} ${cmdArgs.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSync(
    command,
    isWindows ? cmdArgs.map(quoteForWindowsShell) : cmdArgs,
    { cwd, stdio: "inherit", shell: isWindows }
  );
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${cmdArgs.join(" ")}`);
  }
}

function sanitizeAppName(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N} .'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSlug(slug) {
  return String(slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function resolveLogoUrl(apiBase, logoUrl) {
  const value = String(logoUrl || "").trim();
  if (!value) return "";
  if (/^(https?:|data:)/i.test(value)) return value;
  const apiOrigin = apiBase.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
  return `${apiOrigin}${value.startsWith("/") ? "" : "/"}${value}`;
}

async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) fail(`GET ${url} failed (${res.status}): ${await res.text().catch(() => "")}`);
  return res.json();
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) fail(`Could not download ${url} (${res.status})`);
  await pipeline(res.body, createWriteStream(destPath));
}

async function copyDir(src, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = normalizeSlug(args.slug);
  if (!slug) fail("Usage: node build-tenant-app.mjs --slug <tenant-slug> [--admin-token <jwt>] [--version 1.0.0]");

  const hasSuppliedBranding = Boolean(args.tenantNameArg && args.logoUrlArg);
  const needsUpload = !args.skipUpload;
  if (!args.adminToken && (!hasSuppliedBranding || needsUpload)) {
    fail("Missing admin token. Pass --admin-token or set MAHIMA_ADMIN_TOKEN (not needed when --tenant-name/--logo-url/--primary-color and --skip-upload are all given).");
  }

  const version = args.version || "1.0.0";
  const build = args.build || String(Math.floor(Date.now() / 1000));
  // The root tenant is the canonical Mahima app already registered in
  // google-services.json. Only separately branded tenant apps receive a
  // tenant-specific application id (and therefore need a Firebase client).
  const applicationIdSuffix = slug.replace(/-/g, "_");
  const applicationId = slug === "mahima-root"
    ? "com.mahimaministries.app"
    : `com.mahimaministries.app.${applicationIdSuffix}`;

  console.log(`[build-tenant-app] Building "${slug}" -> ${applicationId} (v${version} build ${build})`);

  // 1. Resolve tenant branding - either supplied directly (server-orchestrated
  // flow, values already resolved in-process by the caller) or fetched here
  // (manual CLI flow).
  console.log("PROGRESS:FetchingBranding");
  let tenantName, logoUrl, primaryColor;
  if (hasSuppliedBranding) {
    tenantName = sanitizeAppName(args.tenantNameArg) || slug;
    logoUrl = resolveLogoUrl(args.apiBase, args.logoUrlArg);
    primaryColor = args.primaryColorArg || "#0f766e";
  } else {
    const branding = await fetchJson(`${args.apiBase}/tenants/${encodeURIComponent(slug)}/branding`, args.adminToken);
    tenantName = sanitizeAppName(branding.name || branding.Name) || slug;
    logoUrl = resolveLogoUrl(args.apiBase, branding.logoUrl || branding.LogoUrl);
    primaryColor = branding.primaryColor || branding.PrimaryColor || "#0f766e";
  }
  if (!logoUrl) fail(`Tenant "${slug}" has no logo set in TenantBranding - upload one before building its app.`);

  // 2. Download the logo and stage it where @capacitor/assets expects source icons.
  console.log("PROGRESS:DownloadingLogo");
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "mahima-tenant-app-"));
  // @capacitor/assets has changed its custom asset-directory option between
  // releases. Stage the source icon in its stable conventional directory and
  // restore that directory afterward instead of depending on a CLI flag.
  const assetDir = path.join(frontendDir, "assets");
  const assetBackupDir = path.join(workDir, "assets-backup");
  const hadAssetDir = await fs.stat(assetDir).then((entry) => entry.isDirectory()).catch(() => false);
  if (hadAssetDir) await copyDir(assetDir, assetBackupDir);
  else await fs.mkdir(assetDir, { recursive: true });
  const iconPath = path.join(assetDir, "icon.png");
  await downloadFile(logoUrl, iconPath);
  console.log(`[build-tenant-app] Logo downloaded: ${iconPath}`);

  // 3. Back up the entire res/ folder so icon generation can be cleanly undone.
  const resBackupDir = path.join(workDir, "res-backup");
  await copyDir(resDir, resBackupDir);

  // 4. Back up + write tenant-provision.json (bundled into the APK's web assets).
  const provisionBackup = await fs.readFile(provisionFilePath, "utf8").catch(() => null);

  // 4b. .env.mobile hardcodes a static app version (1.0.3) shared by every tenant
  // build; without this override the built web bundle always self-reports 1.0.3,
  // so AppUpdatePrompt.jsx permanently thinks every install is out of date against
  // whatever minSupportedVersion gets published (e.g. "1.10" > "1.0.3"), showing an
  // undismissable forced-update screen. .env.mobile.local has the highest precedence
  // in Vite's env loading order, so this overrides it for just this build.
  const envMobileLocalPath = path.join(frontendDir, ".env.mobile.local");

  let restored = false;
  async function restore() {
    if (restored) return;
    restored = true;
    console.log("[build-tenant-app] Restoring default branding (res/ and tenant-provision.json)...");
    await copyDir(resBackupDir, resDir);
    if (provisionBackup != null) await fs.writeFile(provisionFilePath, provisionBackup, "utf8");
    if (hadAssetDir) await copyDir(assetBackupDir, assetDir);
    else await fs.rm(assetDir, { recursive: true, force: true });
    await fs.rm(envMobileLocalPath, { force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  }

  try {
    await fs.writeFile(
      provisionFilePath,
      JSON.stringify({ tenantSlug: slug, tenantName }, null, 2) + "\n",
      "utf8"
    );

    // 5. Regenerate the Android icon set from the tenant logo.
    console.log("PROGRESS:GeneratingIcons");
    run(
      isWindows ? "npx.cmd" : "npx",
      [
        "@capacitor/assets",
        "generate",
        "--android",
        "--iconBackgroundColor",
        primaryColor,
        "--iconBackgroundColorDark",
        primaryColor,
      ],
      frontendDir
    );

    // 6. Build the web bundle (with tenant-provision.json baked in) and sync Capacitor.
    console.log("PROGRESS:BuildingWebBundle");
    await fs.writeFile(
      envMobileLocalPath,
      `VITE_APP_VERSION=${version}\nVITE_ANDROID_VERSION=${version}\nVITE_IOS_VERSION=${version}\n`,
      "utf8"
    );
    run(isWindows ? "npm.cmd" : "npm", ["run", "mobile:sync"], frontendDir);

    // 7. Assemble the signed release APK with tenant-specific Gradle properties.
    console.log("PROGRESS:AssemblingApk");
    const gradlew = isWindows ? "gradlew.bat" : "./gradlew";
    run(
      gradlew,
      [
        "assembleRelease",
        `-PtenantApplicationId=${applicationId}`,
        `-PtenantAppName=${tenantName}`,
        `-PtenantVersionName=${version}`,
        `-PtenantVersionCode=${build}`,
      ],
      androidDir
    );

    const apkPath = path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
    await fs.access(apkPath).catch(() => fail(`Expected APK not found at ${apkPath}`));

    // 8. Copy the built APK to --out, if given (the server-orchestrated flow
    // stages it here for a later, separate Publish step).
    if (args.out) {
      await fs.mkdir(path.dirname(args.out), { recursive: true });
      await fs.copyFile(apkPath, args.out);
      console.log(`[build-tenant-app] APK staged at: ${args.out}`);
    }

    console.log("PROGRESS:Ready");

    // 9. Upload the APK to the tenant's release channel, unless --skip-upload.
    if (!args.skipUpload) {
      const form = new FormData();
      form.append("file", new Blob([await fs.readFile(apkPath)]), `mahima-app-${slug}.apk`);
      form.append("version", version);
      form.append("build", build);
      form.append("minSupportedVersion", args.minSupportedVersion || version);
      form.append("releaseNotes", args.releaseNotes || "");
      form.append("forceUpgrade", args.forceUpgrade ? "true" : "false");

      const uploadRes = await fetch(`${args.apiBase}/app-releases/${encodeURIComponent(slug)}/android`, {
        method: "POST",
        headers: { Authorization: `Bearer ${args.adminToken}` },
        body: form,
      });
      if (!uploadRes.ok) fail(`Upload failed (${uploadRes.status}): ${await uploadRes.text().catch(() => "")}`);
      const manifest = await uploadRes.json();

      console.log(`\n[build-tenant-app] Done. "${tenantName}" app published:`);
      console.log(`  Download page: ${manifest.downloadPageUrl}`);
      console.log(`  Direct APK:    ${manifest.android?.downloadUrl}\n`);
      console.log(
        "[build-tenant-app] Reminder: if this is the first build for this tenant's applicationId, register it " +
          `(${applicationId}) as an Android app in the Firebase console (project mahima-ministry) and add the ` +
          "resulting client entry to frontend/android/app/google-services.json, or push notifications won't work for it."
      );
    } else {
      console.log(`\n[build-tenant-app] Done. "${tenantName}" app built and staged (upload skipped).\n`);
    }
  } finally {
    await restore();
  }
}

main().catch((err) => {
  console.error(`\n[build-tenant-app] ERROR: ${err?.message || err}\n`);
  process.exit(1);
});
