#!/usr/bin/env node
/**
 * Bumps version (patch) and build number for each release.
 * Run before: eas build --profile production --platform ios
 *
 * Usage: npm run version:bump
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJsonPath = path.join(root, 'app.json');
const packageJsonPath = path.join(root, 'package.json');
const pbxprojPath = path.join(root, 'ios/Ploop.xcodeproj/project.pbxproj');

// Read current values
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const currentVersion = appJson.expo.version;
const currentBuild = parseInt(appJson.expo.ios?.buildNumber || '1', 10);

// Bump patch version: 1.0.0 -> 1.0.1
const [major, minor, patch] = currentVersion.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
const newBuild = (currentBuild + 1).toString();

console.log(`Bumping: ${currentVersion} (${currentBuild}) -> ${newVersion} (${newBuild})`);

// Update app.json (source of truth for EAS prebuild)
appJson.expo.version = newVersion;
appJson.expo.ios = appJson.expo.ios || {};
appJson.expo.ios.buildNumber = newBuild;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// Update project.pbxproj if it exists (for local Xcode builds; EAS prebuild uses app.json)
if (fs.existsSync(pbxprojPath)) {
  let pbxproj = fs.readFileSync(pbxprojPath, 'utf8');
  pbxproj = pbxproj.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${newVersion};`);
  pbxproj = pbxproj.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${newBuild};`);
  fs.writeFileSync(pbxprojPath, pbxproj);
}

console.log(`✓ Updated to ${newVersion} (build ${newBuild})`);
