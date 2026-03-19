#!/usr/bin/env node
/**
 * Push to Render, build iOS & Android, then submit to stores.
 * Run from Ploop/: node scripts/release-all.js [commit-message]
 *
 * 1. Git push → triggers Render auto-deploy
 * 2. EAS build (iOS + Android) → production profiles
 * 3. EAS submit → TestFlight + Play Store (internal)
 */

const { execSync } = require('child_process');
const path = require('path');

const ploopRoot = path.join(__dirname, '..');
const mobileRoot = path.join(ploopRoot, 'mobile');

function run(cmd, opts = {}) {
  const { cwd = ploopRoot, ...rest } = opts;
  console.log(`\n$ ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd, ...rest });
}

function getGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      cwd: ploopRoot,
    }).trim();
  } catch {
    return null;
  }
}

console.log('=== Ploop Release: Render + iOS + Android ===\n');

const gitRoot = getGitRoot();
if (gitRoot) {
  console.log('1. Pushing to origin (triggers Render deploy)...');
  run('git add -A', { cwd: gitRoot });
  try {
    const msg = process.argv[2] || 'Release: cold start, load bar, Gmail sign-in fixes';
    run(`git commit -m "${msg}"`, { cwd: gitRoot });
    run('git push origin main', { cwd: gitRoot });
  } catch (e) {
    if (e.status === 1) {
      console.log('(No changes to commit, or push skipped)');
    } else throw e;
  }
} else {
  console.log('1. Skipping git push (not a git repo)');
}

console.log('\n2. Building iOS + Android (EAS production)...');
run('eas build --profile production --platform all', { cwd: mobileRoot });

console.log('\n3. Submitting to TestFlight and Play Store...');
run('eas submit --platform ios --latest', { cwd: mobileRoot });
run('eas submit --platform android --latest', { cwd: mobileRoot });

console.log('\n=== Done ===');
console.log('- Render: https://dashboard.render.com → ploop-api');
console.log('- iOS: App Store Connect → TestFlight');
console.log('- Android: Play Console → internal track');
