# Fix "EMFILE: too many open files" Error

This is a common macOS issue when developing with React Native/Expo. The file watcher hits macOS's default limit.

## Quick Fix (Temporary - Current Session)

Run this before starting the app:
```bash
ulimit -n 10240
cd mobile
npm run ios
```

## Permanent Fix (Recommended)

Add to your `~/.zshrc` file:

```bash
# Increase file watcher limit for development
ulimit -n 10240
```

Then reload:
```bash
source ~/.zshrc
```

## Alternative: Use watchman (Better Solution)

Watchman is a file watching service from Facebook that handles this better:

```bash
brew install watchman
```

Then restart your terminal and try again.

## What This Error Means

- macOS limits how many files a process can watch
- React Native/Expo needs to watch many files for hot reload
- The default limit (usually 256) is too low
- Increasing to 10240 solves this


