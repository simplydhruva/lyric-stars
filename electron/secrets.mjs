// Spotify tokens, encrypted with Electron's safeStorage (Windows DPAPI: only this
// Windows user can decrypt them). Never written in plain text.
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export class SecretStore {
  constructor(dir) {
    this.file = path.join(dir, 'tokens.bin');
    this.value = null; // decrypted JSON string
    this.secure = false;
    this.writing = Promise.resolve();
  }

  // Call once after the app is ready, before the page asks for tokens.
  async load() {
    this.secure = await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
    if (!this.secure) return;
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(fs.readFileSync(this.file));
      this.value = result;
      if (shouldReEncrypt) this.set(result); // Windows rotated the key
    } catch {
      // Missing, or encrypted by another Windows user: treat as logged out.
    }
  }

  get() {
    return this.value;
  }

  set(json) {
    this.value = json ?? null;
    // Writes go in order, so a quick login-then-logout can't leave tokens behind.
    this.writing = this.writing.then(() => this._write(this.value)).catch((e) => console.error('Could not save login', e));
    return this.writing;
  }

  async _write(json) {
    if (json !== this.value) return; // a newer value is queued
    if (json == null) return fs.rmSync(this.file, { force: true });
    // Without encryption the tokens live only in memory for this session.
    if (!this.secure) return;
    const data = await safeStorage.encryptStringAsync(json);
    if (json !== this.value) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, data);
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
