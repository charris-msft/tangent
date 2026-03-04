// scripts/patch-electron-icon.js
// Patches the local electron.exe icon and metadata to use the Tangent branding.
// Run after npm install: node scripts/patch-electron-icon.js

const { execFileSync } = require('child_process')
const { existsSync, copyFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const rcedit = join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe')
const icon = join(root, 'assets', 'tangent.ico')

if (process.platform !== 'win32') {
  console.log('[patch-electron-icon] Skipping — not Windows')
  process.exit(0)
}

if (!existsSync(electronExe)) {
  console.log('[patch-electron-icon] electron.exe not found, skipping')
  process.exit(0)
}

if (!existsSync(rcedit)) {
  console.log('[patch-electron-icon] rcedit not found, skipping')
  process.exit(0)
}

try {
  execFileSync(rcedit, [
    electronExe,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', 'Tangent',
    '--set-version-string', 'FileDescription', 'Tangent'
  ], { stdio: 'inherit' })
  console.log('[patch-electron-icon] Patched electron.exe with Tangent icon')
} catch (err) {
  console.warn('[patch-electron-icon] Failed (electron may be running):', err.message)
  console.warn('[patch-electron-icon] Close Tangent and run: node scripts/patch-electron-icon.js')
}
