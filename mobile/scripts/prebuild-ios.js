#!/usr/bin/env node
/**
 * Temporarily moves ios/ aside so EAS runs prebuild and uses app.json version/buildNumber.
 * Runs eas build, then restores ios/ when done.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const iosDir = path.join(root, 'ios');
const iosBackup = path.join(root, 'ios.easbuild.bak');

const restore = () => {
  if (fs.existsSync(iosBackup)) {
    fs.renameSync(iosBackup, iosDir);
    console.log('Restored ios/');
  }
};

const run = async () => {
  if (fs.existsSync(iosDir)) {
    fs.renameSync(iosDir, iosBackup);
    console.log('Moved ios/ aside so EAS will run prebuild (uses app.json version)');
  }

  const eas = spawn('eas', ['build', '--profile', 'production', '--platform', 'ios'], {
    stdio: 'inherit',
    shell: true,
    cwd: root,
  });

  eas.on('close', (code) => {
    restore();
    process.exit(code);
  });

  eas.on('error', (err) => {
    console.error('Failed to run eas build:', err);
    restore();
    process.exit(1);
  });
};

run();
