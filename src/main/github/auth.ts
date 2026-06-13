import { saveToken } from './token-store';

// Set to the Client ID of the registered GitHub OAuth App (device flow enabled).
export const GITHUB_CLIENT_ID = 'REPLACE_WITH_OAUTH_APP_CLIENT_ID';
const SCOPE = 'repo';

export interface DeviceCode {
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
}

export async function startDeviceFlow(): Promise<DeviceCode> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`GitHub device code request failed (${res.status})`);
  return (await res.json()) as DeviceCode;
}

// Polls until the user authorises, then persists the token. Resolves with true on success.
export async function pollForToken(deviceCode: string, intervalSec: number, expiresInSec: number): Promise<boolean> {
  const deadline = Date.now() + expiresInSec * 1000;
  let interval = intervalSec;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string; interval?: number };
    if (data.access_token) {
      await saveToken(data.access_token);
      return true;
    }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval += 5; continue; }
    if (data.error === 'expired_token' || data.error === 'access_denied') return false;
  }
  return false;
}
