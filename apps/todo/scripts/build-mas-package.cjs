#!/usr/bin/env node
/**
 * Build the Mac App Store package of Digital Habits: To-Do.
 *
 *   pnpm --dir apps/todo app:build:mas
 *
 * What comes out: apps/todo/for-distribution/Digital-Habits-To-Do.pkg, which
 * goes to App Store Connect. Nothing here uploads it.
 *
 * This is the script that built versions 2.x, moved here with the app. It is
 * kept as it was where it could be, because each odd step in it is there for
 * a failure that happened:
 *
 * - The App Store does not take an app that uses private API. The app has
 *   `macOSPrivateApi` on, for the look of the focus bar. So the build is made
 *   from a temporary config with it off, and the `macos-private-api` feature
 *   is taken out of Cargo.toml for the time of the build and put back after.
 * - Tauri's own signing pass is turned off. The app is signed here, with the
 *   App Store identity, the sandbox entitlements and the provisioning profile
 *   inside it. App Store Connect refuses a package without that profile.
 * - `productbuild` then signs the installer with the installer identity.
 *
 * The names it needs, from the environment or from apps/todo/.env.local:
 *
 *   APPLE_APP_IDENTITY        "Apple Distribution: <company> (<team>)"
 *   APPLE_INSTALLER_IDENTITY  "3rd Party Mac Developer Installer: <company> (<team>)"
 *   APPLE_PROVISIONING_PROFILE_PATH   optional; else the newest matching
 *                                     profile that Xcode has is used
 *   MAS_BUILD_NUMBER          optional; to send the same version again
 *   KEYCHAIN_PATH, KEYCHAIN_PASSWORD  in CI only
 *
 * With none of them set, both identities are looked for in the keychain.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

// The names above, from .env.local, for a build on a developer's machine. A
// value already in the environment wins, so CI is not changed by a file.
for (const file of ['.env.local', '.env']) {
  const envPath = path.join(repoRoot, file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
const tempTauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.appstore.temp.conf.json');
const masEntitlementsPath = path.join(repoRoot, 'src-tauri', 'entitlements.mas.plist');
const targetTriple = 'universal-apple-darwin';
const skipTauriBuild = process.argv.includes('--skip-tauri-build');
const optional = process.argv.includes('--optional');
const tempMasEntitlementsPath = path.join(repoRoot, 'src-tauri', 'entitlements.mas.temp.plist');

function runOrThrow(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function fail(message) {
  console.error(`\n[build:mas] ${message}\n`);
  process.exit(1);
}

function skip(message) {
  console.warn(`\n[build:mas] ${message}\n`);
  process.exit(0);
}

function makeAppStoreConfig(baseConfig) {
  const config = JSON.parse(JSON.stringify(baseConfig));
  if (!config.app) config.app = {};
  config.app.macOSPrivateApi = false;
  if (!config.bundle) config.bundle = {};
  if (!config.bundle.macOS) config.bundle.macOS = {};
  // Avoid Tauri's default app signing pass (which uses the Developer ID
  // identity from tauri.conf.json and can fail on timestamp requirements).
  // build:mas re-signs the app explicitly with MAS identities later.
  config.bundle.macOS.signingIdentity = null;
  return config;
}

function removePrivateApiFeature(cargoTomlContent) {
  const tauriDepRegex = /(tauri\s*=\s*\{[^}]*features\s*=\s*\[)([^\]]*)(\][^}]*\})/m;
  const match = cargoTomlContent.match(tauriDepRegex);
  if (!match) {
    // No explicit features array on tauri dependency; nothing to strip.
    return cargoTomlContent;
  }

  const features = match[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^"(.*)"$/, '$1'));
  const filtered = features.filter((feature) => feature !== 'macos-private-api');
  const replacementFeatures = filtered.map((feature) => `"${feature}"`).join(', ');
  return cargoTomlContent.replace(tauriDepRegex, `$1${replacementFeatures}$3`);
}

/** The team in `bundle.macOS.signingIdentity`, e.g. "… Ltd (JD647S9RT6)". */
function preferredTeamId() {
  try {
    const config = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
    const identity = config?.bundle?.macOS?.signingIdentity || '';
    const match = String(identity).match(/\(([A-Z0-9]{10})\)\s*$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function detectIdentityFromKeychain(preferredPatterns) {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'basic'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) return null;

  const output = result.stdout || '';
  const all = output.split('\n');
  // A keychain can hold the same kind of identity for two teams. The app is
  // the company's, and the first match was once a personal team's, whose
  // installer identity had no key: productbuild failed after a full build. So
  // the identities of the team named in tauri.conf.json come first.
  const team = preferredTeamId();
  const lines = team
    ? [...all.filter((l) => l.includes(`(${team})`)), ...all.filter((l) => !l.includes(`(${team})`))]
    : all;

  for (const pattern of preferredPatterns) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) return match[0].replace(/^"|"$/g, '');
    }
  }
  return null;
}

function autoDetectInstallerIdentity() {
  return detectIdentityFromKeychain([
    /"3rd Party Mac Developer Installer:[^"]+"/i,
    /"Developer ID Installer:[^"]+"/i
  ]);
}

function autoDetectAppIdentity() {
  return detectIdentityFromKeychain([
    /"Apple Distribution:[^"]+"/i,
    /"3rd Party Mac Developer Application:[^"]+"/i,
    /"Developer ID Application:[^"]+"/i
  ]);
}

function getTeamIdFromIdentity(identity) {
  if (!identity) return null;
  const match = identity.match(/\(([A-Z0-9]+)\)\s*$/);
  return match ? match[1] : null;
}

/** Trim secrets that often pick up a trailing newline or quotes from the GitHub UI. */
function trimIdentity(value) {
  return (value || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

/**
 * Prefer the SHA-1 hash from `security find-identity` when available — more
 * reliable in CI than the human-readable name (and avoids subtle whitespace
 * mismatches). Falls back to the original name string.
 */
function resolveCodesigningIdentity(preferredName, keychainPath) {
  const name = trimIdentity(preferredName);
  if (!name) return name;
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  if (keychainPath) args.push(keychainPath);
  const result = spawnSync('security', args, { cwd: repoRoot, encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const lines = output.split('\n');
  for (const line of lines) {
    if (!line.includes(name)) continue;
    const hashMatch = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"/);
    if (hashMatch) {
      console.log(`[build:mas] Resolved codesigning identity to hash ${hashMatch[1]}`);
      return hashMatch[1];
    }
  }
  return name;
}

function resolveInstallerIdentity(preferredName, keychainPath) {
  const name = trimIdentity(preferredName);
  if (!name) return name;
  const args = ['find-identity', '-v'];
  if (keychainPath) args.push(keychainPath);
  const result = spawnSync('security', args, { cwd: repoRoot, encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  for (const line of output.split('\n')) {
    if (!line.includes(name)) continue;
    const hashMatch = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"/);
    if (hashMatch) {
      console.log(`[build:mas] Resolved installer identity to hash ${hashMatch[1]}`);
      return hashMatch[1];
    }
  }
  return name;
}

/** Re-unlock the ephemeral CI keychain immediately before codesign/productbuild. */
function ensureCiKeychainReady() {
  const keychainPath = (process.env.KEYCHAIN_PATH || '').trim();
  const keychainPassword = process.env.KEYCHAIN_PASSWORD || '';
  if (!keychainPath) return null;
  if (!fs.existsSync(keychainPath)) {
    throw new Error(`KEYCHAIN_PATH does not exist: ${keychainPath}`);
  }
  if (keychainPassword) {
    runOrThrow('security', ['unlock-keychain', '-p', keychainPassword, keychainPath]);
    runOrThrow('security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      keychainPassword,
      keychainPath
    ]);
  }
  // Keep CI keychain first; retain any other user keychains for intermediates.
  const listed = spawnSync('security', ['list-keychains', '-d', 'user'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const others = (listed.stdout || '')
    .split('\n')
    .map((l) => l.trim().replace(/^"|"$/g, ''))
    .filter((l) => l && l !== keychainPath);
  runOrThrow('security', ['list-keychains', '-d', 'user', '-s', keychainPath, ...others]);
  runOrThrow('security', ['default-keychain', '-s', keychainPath]);
  console.log(`[build:mas] Using CI keychain: ${keychainPath}`);
  return keychainPath;
}

function codesignArgs(identity, entitlementsPath, targetPath, keychainPath) {
  const args = ['--force', '--sign', identity];
  if (keychainPath) args.push('--keychain', keychainPath);
  if (entitlementsPath) args.push('--entitlements', entitlementsPath);
  args.push('--timestamp=none', targetPath);
  return args;
}

function extractPlistString(xml, key) {
  if (!xml || !key) return null;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<key>\\s*${escapedKey}\\s*<\\/key>\\s*<string>\\s*([^<]+?)\\s*<\\/string>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

function decodeProvisioningProfile(profilePath) {
  const decoded = spawnSync('security', ['cms', '-D', '-i', profilePath], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (decoded.status !== 0 || !decoded.stdout) return null;
  const xml = decoded.stdout;
  const appIdentifier =
    extractPlistString(xml, 'com.apple.application-identifier') ||
    extractPlistString(xml, 'application-identifier');
  const profileTeamId =
    extractPlistString(xml, 'com.apple.developer.team-identifier') ||
    null;
  const expirationDate = extractPlistString(xml, 'ExpirationDate');
  const name = extractPlistString(xml, 'Name');
  return { appIdentifier, profileTeamId, expirationDate, name };
}

function buildSigningEntitlements(baseEntitlementsPath, outputEntitlementsPath, appIdentifier, teamId) {
  let xml = fs.readFileSync(baseEntitlementsPath, 'utf8');
  const closeDict = '</dict>';
  const idx = xml.lastIndexOf(closeDict);
  if (idx === -1) {
    throw new Error(`Invalid entitlements plist (missing </dict>): ${baseEntitlementsPath}`);
  }

  const extra = [
    '  <key>com.apple.application-identifier</key>',
    `  <string>${appIdentifier}</string>`,
    '  <key>com.apple.developer.team-identifier</key>',
    `  <string>${teamId}</string>`
  ].join('\n');

  xml = `${xml.slice(0, idx)}${extra}\n${xml.slice(idx)}`;
  fs.writeFileSync(outputEntitlementsPath, xml);
}

function resolveProvisioningProfilePath(bundleIdentifier, teamId) {
  const explicitProfilePath =
    process.env.APPLE_PROVISIONING_PROFILE_PATH ||
    process.env.APPLE_PROVISIONING_PROFILE ||
    null;

  if (explicitProfilePath) {
    const absolute = path.isAbsolute(explicitProfilePath)
      ? explicitProfilePath
      : path.resolve(repoRoot, explicitProfilePath);
    if (!fs.existsSync(absolute)) {
      fail(`Provisioning profile not found at explicit path: ${absolute}`);
    }
    return absolute;
  }

  const profileDirs = [
    path.join(process.env.HOME || '', 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles'),
    path.join(process.env.HOME || '', 'Library', 'MobileDevice', 'Provisioning Profiles')
  ];

  const expectedAppId = teamId ? `${teamId}.${bundleIdentifier}` : null;
  const candidates = [];

  for (const dir of profileDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.endsWith('.mobileprovision') && !fileName.endsWith('.provisionprofile')) continue;
      const profilePath = path.join(dir, fileName);
      const details = decodeProvisioningProfile(profilePath);
      if (!details || !details.appIdentifier) continue;
      const appId = details.appIdentifier;
      const strictMatch = expectedAppId && appId === expectedAppId;
      const looseMatch = appId.endsWith(`.${bundleIdentifier}`);
      if (strictMatch || looseMatch) {
        const expirationValue = details.expirationDate ? Date.parse(details.expirationDate) : 0;
        candidates.push({ profilePath, appId, expirationValue, name: details.name || fileName });
      }
    }
  }

  if (candidates.length === 0) {
    const expectation = expectedAppId || `*.${bundleIdentifier}`;
    fail(
      'No matching macOS provisioning profile was found.\n' +
      `Expected profile app identifier like: ${expectation}\n` +
      'Install/download the macOS App Store provisioning profile in Xcode, or set APPLE_PROVISIONING_PROFILE_PATH.'
    );
  }

  candidates.sort((a, b) => (b.expirationValue || 0) - (a.expirationValue || 0));
  const best = candidates[0];
  console.log(`[build:mas] Using provisioning profile: ${best.name} (${best.appId})`);
  return best.profilePath;
}

if (process.platform !== 'darwin') {
  if (optional) skip('Skipping .pkg generation because host OS is not macOS.');
  fail('build:mas must be run on macOS.');
}

if (!fs.existsSync(tauriConfigPath)) {
  if (optional) skip(`Skipping .pkg generation because config is missing: ${tauriConfigPath}`);
  fail(`Missing Tauri config: ${tauriConfigPath}`);
}
if (!fs.existsSync(cargoTomlPath)) {
  if (optional) skip(`Skipping .pkg generation because Cargo.toml is missing: ${cargoTomlPath}`);
  fail(`Missing Cargo.toml: ${cargoTomlPath}`);
}

const installerIdentityRaw =
  process.env.APPLE_INSTALLER_IDENTITY ||
  (process.env.APPLE_IDENTITY && /installer/i.test(process.env.APPLE_IDENTITY) ? process.env.APPLE_IDENTITY : null) ||
  autoDetectInstallerIdentity();
const installerIdentityName = trimIdentity(installerIdentityRaw);
if (!installerIdentityName) {
  if (optional) {
    skip(
      'Skipping .pkg generation because APPLE_INSTALLER_IDENTITY is not set.\n' +
      'Set it to your "3rd Party Mac Developer Installer" identity for Transporter uploads.'
    );
  }
  fail(
    'Missing installer signing identity.\n' +
    'Example:\n' +
    '  APPLE_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Your Company (TEAMID)" pnpm --dir apps/todo app:build:mas'
  );
}

console.log(`[build:mas] Using installer identity: ${installerIdentityName}`);

const appIdentityRaw =
  process.env.APPLE_APP_IDENTITY ||
  process.env.APPLE_DISTRIBUTION_IDENTITY ||
  autoDetectAppIdentity() ||
  (process.env.APPLE_IDENTITY && process.env.APPLE_IDENTITY.includes(':') ? process.env.APPLE_IDENTITY : null);
const appIdentityName = trimIdentity(appIdentityRaw);
if (!appIdentityName) {
  fail(
    'Missing app signing identity.\n' +
    'Set APPLE_APP_IDENTITY (or APPLE_DISTRIBUTION_IDENTITY), e.g.:\n' +
    '  APPLE_APP_IDENTITY="Apple Distribution: Your Company (TEAMID)" pnpm --dir apps/todo app:build:mas'
  );
}
console.log(`[build:mas] Using app identity: ${appIdentityName}`);
const teamId = getTeamIdFromIdentity(appIdentityName);

if (!fs.existsSync(masEntitlementsPath)) {
  fail(`Missing MAS entitlement file. Expected:\n  - ${masEntitlementsPath}`);
}

const originalTauriConfigRaw = fs.readFileSync(tauriConfigPath, 'utf8');
const originalCargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
const tauriConfig = JSON.parse(originalTauriConfigRaw);
const needsAppStoreOverride = !!tauriConfig?.app?.macOSPrivateApi;

if (skipTauriBuild && needsAppStoreOverride) {
  if (optional) {
    skip(
      'Skipping .pkg generation because existing build artifacts were created with macOSPrivateApi enabled.\n' +
      'Run build:mas without --skip-tauri-build to rebuild in App-Store-safe mode.'
    );
  }
  fail(
    'Cannot use --skip-tauri-build while macOSPrivateApi is enabled.\n' +
    'Run build:mas (without skip) to rebuild in App-Store-safe mode.'
  );
}

let exitCode = 0;
try {
  const buildConfigPath = tempTauriConfigPath;
  const appStoreConfig = makeAppStoreConfig(tauriConfig);
  fs.writeFileSync(buildConfigPath, JSON.stringify(appStoreConfig, null, 2));

  // Remove private API cargo feature for App Store build only.
  fs.writeFileSync(cargoTomlPath, removePrivateApiFeature(originalCargoToml));

  // 1) Build app bundle with Tauri (or reuse if caller already built with App Store-safe config).
  if (!skipTauriBuild) {
    runOrThrow(
      'pnpm',
      ['exec', 'tauri', 'build', '--target', targetTriple, '--bundles', 'app', '--config', buildConfigPath],
      {
        env: {
          ...process.env,
          APP_STORE: '1',
          CI: 'true',
          npm_config_ci: 'false',
          NPM_CONFIG_CI: 'false'
        }
      }
    );
  }

  // 2) Locate generated .app.
  const productName = appStoreConfig.productName || 'Digital Habits To-Do';
  const appBundlePath = path.join(
    repoRoot,
    'src-tauri',
    'target',
    targetTriple,
    'release',
    'bundle',
    'macos',
    `${productName}.app`
  );
  if (!fs.existsSync(appBundlePath)) {
    throw new Error(`Could not find app bundle at: ${appBundlePath}`);
  }

  // 3) Embed provisioning profile so App Store Connect can validate TestFlight eligibility.
  const bundleIdentifier = appStoreConfig.identifier;
  if (!bundleIdentifier) {
    throw new Error('Missing bundle identifier in Tauri config (`identifier`).');
  }
  const provisioningProfilePath = resolveProvisioningProfilePath(bundleIdentifier, teamId);
  const profileDetails = decodeProvisioningProfile(provisioningProfilePath);
  if (!profileDetails || !profileDetails.appIdentifier) {
    throw new Error('Failed to decode provisioning profile app identifier.');
  }
  const resolvedTeamId = profileDetails.profileTeamId || teamId;
  if (!resolvedTeamId) {
    throw new Error('Failed to resolve team identifier from app identity/provisioning profile.');
  }

  // Ensure signed entitlements include application/team identifier values from profile.
  buildSigningEntitlements(
    masEntitlementsPath,
    tempMasEntitlementsPath,
    profileDetails.appIdentifier,
    resolvedTeamId
  );

  const embeddedProvisioningProfilePath = path.join(appBundlePath, 'Contents', 'embedded.provisionprofile');
  fs.copyFileSync(provisioningProfilePath, embeddedProvisioningProfilePath);

  // Optional CFBundleVersion override (re-upload same marketing version to ASC).
  const masBuildNumber = (process.env.MAS_BUILD_NUMBER || process.env.APPLE_MAS_BUILD_NUMBER || '').trim();
  if (masBuildNumber) {
    const infoPlistPath = path.join(appBundlePath, 'Contents', 'Info.plist');
    runOrThrow('/usr/libexec/PlistBuddy', [
      '-c',
      `Set :CFBundleVersion ${masBuildNumber}`,
      infoPlistPath
    ]);
    console.log(`[build:mas] Stamped CFBundleVersion=${masBuildNumber}`);
  }

  // 4) Re-select the CI keychain (long Rust builds can drop it from the
  // search list) and sign executable payloads required by Transporter.
  const keychainPath = ensureCiKeychainReady();
  const appIdentity = resolveCodesigningIdentity(appIdentityName, keychainPath);
  const installerIdentity = resolveInstallerIdentity(installerIdentityName, keychainPath);

  runOrThrow('codesign', codesignArgs(appIdentity, tempMasEntitlementsPath, appBundlePath, keychainPath));

  // 5) Build MAS upload package (.pkg) for Transporter.
  const outputDir = path.join(repoRoot, 'for-distribution');
  fs.mkdirSync(outputDir, { recursive: true });
  const pkgPath = path.join(outputDir, 'Digital-Habits-To-Do.pkg');
  if (fs.existsSync(pkgPath)) fs.rmSync(pkgPath, { force: true });

  // productbuild has no portable --keychain flag; keychain was set as default above.
  const productbuildArgs = [
    '--component',
    appBundlePath,
    '/Applications',
    '--sign',
    installerIdentity,
    pkgPath
  ];
  runOrThrow('productbuild', productbuildArgs);

  console.log(`\n[build:mas] Done. Transporter package:\n${pkgPath}\n`);
} catch (err) {
  console.error(`\n[build:mas] ${err.message}\n`);
  exitCode = 1;
} finally {
  try {
    fs.writeFileSync(cargoTomlPath, originalCargoToml);
  } catch (restoreErr) {
    console.warn(`[build:mas] Warning: failed to restore Cargo.toml: ${restoreErr.message}`);
    exitCode = 1;
  }
  try {
    if (fs.existsSync(tempTauriConfigPath)) fs.rmSync(tempTauriConfigPath, { force: true });
  } catch (cleanupErr) {
    console.warn(`[build:mas] Warning: failed to remove temp config: ${cleanupErr.message}`);
    exitCode = 1;
  }
  try {
    if (fs.existsSync(tempMasEntitlementsPath)) fs.rmSync(tempMasEntitlementsPath, { force: true });
  } catch (cleanupErr) {
    console.warn(`[build:mas] Warning: failed to remove temp entitlements: ${cleanupErr.message}`);
    exitCode = 1;
  }
}

process.exit(exitCode);
