'use strict';
// Passwords (e.g. a supplier's B2B login) are never stored as plain text.
// Windows: protected by Windows itself for the logged-in user (DPAPI) — only that user on that PC can read them.
// Elsewhere: AES-256-GCM with a key kept in the program's settings folder.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./store');

function ps(script, input) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    input, encoding: 'utf8', windowsHide: true, timeout: 20000, env: Object.assign({}, process.env),
  }).trim();
}
function keyFile() { return path.join(store.appConfigDir(), 'secret.key'); }
function localKey() {
  try { return Buffer.from(fs.readFileSync(keyFile(), 'utf8').trim(), 'base64'); } catch (_) {
    const k = crypto.randomBytes(32);
    fs.mkdirSync(store.appConfigDir(), { recursive: true });
    fs.writeFileSync(keyFile(), k.toString('base64'), { mode: 0o600 });
    return k;
  }
}

function protect(text) {
  if (!text) return '';
  return require('./security').wrap(protectWin(text));
}
function protectWin(text) {
  if (process.platform === 'win32') {
    try {
      const out = ps("Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($t), $null, 'CurrentUser'))", String(text));
      if (out) return 'dpapi:' + out;
    } catch (_) { /* fall back to the local key */ }
  }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', localKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'aes:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function reveal(blob) {
  if (!blob) return '';
  const s = String(require('./security').unwrap(String(blob)));
  if (s.startsWith('dpapi:')) {
    return ps("Add-Type -AssemblyName System.Security; $b=[Console]::In.ReadToEnd().Trim(); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b), $null, 'CurrentUser'))", s.slice(6));
  }
  if (s.startsWith('aes:')) {
    const raw = Buffer.from(s.slice(4), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', localKey(), raw.slice(0, 12));
    d.setAuthTag(raw.slice(12, 28));
    return Buffer.concat([d.update(raw.slice(28)), d.final()]).toString('utf8');
  }
  return '';
}

module.exports = { protect, reveal };
