#!/usr/bin/env node
/**
 * Bump version, build for iOS, then submit to TestFlight.
 * Run: node scripts/release-ios.js
 */

const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
}

run('node scripts/bump-version.js');
run('node scripts/prebuild-ios.js');
run('eas submit --platform ios --latest');
