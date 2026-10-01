# build-tenant-app

Builds a distinctly-branded Android APK for one tenant (own icon, own app
name, own `applicationId`) and publishes it to that tenant's own download
page (`/#/t/{slug}/app-downloads`). Run manually on a dev machine that has
the Android SDK + JDK already set up for this repo (i.e. anyone who can
already run `npm run android:debug` in `frontend/`).

## One-time setup

```
cd frontend
npm install
```

This pulls in `@capacitor/assets`, the icon/splash generator the script uses.

## Usage

```
node tools/build-tenant-app/build-tenant-app.mjs --slug grace-community --admin-token <jwt>
```

The token must belong to an admin of that tenant, or a root-tenant admin.
You can also set `MAHIMA_ADMIN_TOKEN` in the environment instead of passing
`--admin-token` every time.

Options:

| Flag | Default | Notes |
| --- | --- | --- |
| `--slug` | (required) | Tenant slug, as used in `/t/{slug}` URLs |
| `--admin-token` | `$MAHIMA_ADMIN_TOKEN` | Bearer token for an admin of this tenant (or root) |
| `--api-base` | `$MAHIMA_API_BASE` or `https://beta.mahimaministries.in/api` | Backend API base URL |
| `--version` | `1.0.0` | App version name shown to users |
| `--build` | current Unix timestamp | Build/versionCode - must increase on every rebuild of the same tenant |
| `--min-supported-version` | same as `--version` | |
| `--release-notes` | (empty) | |
| `--force-upgrade` | off | Marks this release as required |
| `--out <path>` | (none) | Also copy the built APK to this exact path - used by the server-orchestrated "Generate APK" flow to stage the file for a later, separate Publish step |
| `--skip-upload` | off | Skip the `POST .../android` upload (step 9) entirely - the build is produced and optionally copied via `--out`, nothing is published |
| `--tenant-name`, `--logo-url`, `--primary-color` | (none) | When all three are given, skips the `GET /api/tenants/{slug}/branding` fetch and uses these directly instead - lets a caller that already resolved these values (e.g. the backend's `TenantAppBuildWorker`) skip minting/passing an admin token just to re-fetch what it already knows. `--admin-token` becomes optional when these three are supplied together with `--skip-upload`. |

The script also prints `PROGRESS:<Stage>` lines to stdout at each step
transition (`FetchingBranding`, `DownloadingLogo`, `GeneratingIcons`,
`BuildingWebBundle`, `AssemblingApk`, `Ready`) - harmless extra output for
manual runs, and how `TenantAppBuildWorker` (backend) drives the staged
progress bar shown in the tenant admin UI.

## What it does

1. Fetches the tenant's name/logo/primary color from
   `GET /api/tenants/{slug}/branding` (admin-only; requires the tenant to
   already have a logo set in their branding settings).
2. Downloads the logo and regenerates the Android adaptive icon set
   (`frontend/android/app/src/main/res/mipmap-*`) from it via
   `@capacitor/assets`.
3. Writes `frontend/public/tenant-provision.json` with this tenant's slug
   and name, so the installed app can identify itself on first launch
   (see `frontend/src/utils/tenantProvision.js`) without a network call.
4. Runs `npm run mobile:sync` (Vite build in mobile mode + `cap sync
   android`), then `gradlew assembleRelease` in `frontend/android` with
   `-PtenantApplicationId`, `-PtenantAppName`, `-PtenantVersionName`,
   `-PtenantVersionCode` overriding the defaults in `app/build.gradle`.
   Uses the existing release keystore (`keystore.properties` /
   `MAHIMA_ANDROID_*` env vars) - every tenant's APK is signed the same way.
5. Uploads the resulting APK to `POST /api/app-releases/{slug}/android`.
6. Restores `res/mipmap-*` and `tenant-provision.json` to their defaults,
   whether the build succeeded or failed, so the working tree is always
   left clean and normal (non-tenant) builds are unaffected.

## Prerequisites / known gaps

- **The tenant needs a logo already uploaded** in their branding settings
  (Tenant admin -> Landing Page Editor -> Brand tab) before you can build
  their app - the script refuses to run without one.
- **Push notifications need a one-time Firebase step per non-root tenant.** The
  `mahima-root` build keeps the canonical `com.mahimaministries.app` package
  already present in `google-services.json`. Each other
  tenant gets its own `applicationId`
  (`com.mahimaministries.app.{slug_with_underscores}`), but
  `frontend/android/app/google-services.json` only has a Firebase client
  entry for the default `com.mahimaministries.app`. The build will still
  succeed and produce an installable APK without this, but that tenant's
  app won't receive push notifications until you register
  `com.mahimaministries.app.{slug_with_underscores}` as an Android app in the Firebase
  console (project `mahima-ministry`) and the resulting client entry is
  added to `google-services.json`.
- **Logo aspect ratio**: best results with a roughly square logo.
  `@capacitor/assets` will crop/fit non-square source images into the
  Android adaptive icon safe zone.
- **`@capacitor/assets` CLI flags**: the script stages the downloaded icon in
  Capacitor Assets' conventional `frontend/assets` directory and invokes
  `--android --iconBackgroundColor <hex> --iconBackgroundColorDark <hex>`. If
  a future `@capacitor/assets` upgrade changes its CLI, check `npx
  @capacitor/assets generate --help` and adjust the `run(...)` call in
  `build-tenant-app.mjs` accordingly.
- This script does not trigger itself automatically - there's no "generate
  app" button in the tenant admin UI yet. Run it by hand whenever a
  tenant's branding changes enough to warrant a rebuild, or when onboarding
  a new tenant who wants their own app.
