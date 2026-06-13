import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

const TOKEN_PATH = path.join(app.getPath('userData'), 'github-token.enc');

export async function saveToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; cannot store GitHub token.');
  }
  const encrypted = safeStorage.encryptString(token);
  await fs.writeFile(TOKEN_PATH, encrypted);
}

export async function loadToken(): Promise<string | null> {
  try {
    const buf = await fs.readFile(TOKEN_PATH);
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  await fs.rm(TOKEN_PATH, { force: true });
}
