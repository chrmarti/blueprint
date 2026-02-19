/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface CopilotTokenData {
  token: string;
  expires_at: number;
}

const GH_TOKEN_KEY = 'blueprint-implementer:github-token';
const COPILOT_TOKEN_KEY = 'blueprint-implementer:copilot-token';
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';

let currentUser: GitHubUser | null = null;
let authChangeCallback: (user: GitHubUser | null) => void = () => {};

export function initAuth(opts: { onAuthChange: (user: GitHubUser | null) => void }): void {
  authChangeCallback = opts.onAuthChange;
  const token = getGitHubToken();
  if (token) {
    fetchUser(token)
      .then((user) => {
        currentUser = user;
        authChangeCallback(user);
        // Initialize Copilot SDK with stored token
        if (window.electronAPI) {
          window.electronAPI.copilotInit(token).catch(() => {});
        }
      })
      .catch(() => {
        clearTokens();
        authChangeCallback(null);
      });
  }
}

export function isSignedIn(): boolean {
  return !!getGitHubToken();
}

export function getUser(): GitHubUser | null {
  return currentUser;
}

export function getGitHubToken(): string | null {
  return localStorage.getItem(GH_TOKEN_KEY);
}

function clearTokens(): void {
  localStorage.removeItem(GH_TOKEN_KEY);
  localStorage.removeItem(COPILOT_TOKEN_KEY);
  currentUser = null;
}

export async function startSignIn(
  onStatus: (msg: string) => void,
  onDeviceCode: (code: string, verificationUri: string) => void,
): Promise<void> {
  if (!window.electronAPI) throw new Error('Electron API not available');
  onStatus('Requesting device code...');

  const res = await window.electronAPI.authDeviceCode(
    JSON.stringify({ client_id: CLIENT_ID, scope: '' }),
  );

  if (res.status >= 400) throw new Error('Failed to start device flow');
  const data: DeviceCodeResponse = JSON.parse(res.body);

  onDeviceCode(data.user_code, data.verification_uri);
  onStatus('Waiting for authorization...');

  let interval = data.interval || 5;
  const deadline = Date.now() + data.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);

    const tokenRes = await window.electronAPI.authToken(
      JSON.stringify({
        client_id: CLIENT_ID,
        device_code: data.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    );

    const tokenData = JSON.parse(tokenRes.body);

    if (tokenData.access_token) {
      localStorage.setItem(GH_TOKEN_KEY, tokenData.access_token);
      // Initialize Copilot SDK with the new token
      if (window.electronAPI) {
        await window.electronAPI.copilotInit(tokenData.access_token).catch(() => {});
      }
      onStatus('Fetching user info...');

      try {
        currentUser = await fetchUser(tokenData.access_token);
        authChangeCallback(currentUser);
        onStatus(`Signed in as ${currentUser.login}`);
      } catch {
        authChangeCallback(null);
        onStatus('Signed in');
      }
      return;
    }

    if (tokenData.error === 'authorization_pending') continue;
    if (tokenData.error === 'slow_down') {
      interval += 5;
      continue;
    }
    if (tokenData.error === 'expired_token') throw new Error('Device code expired. Try again.');
    if (tokenData.error === 'access_denied') throw new Error('Access denied by user.');
    throw new Error(tokenData.error_description || tokenData.error || 'Unknown error');
  }

  throw new Error('Device code expired. Try again.');
}

export function signOut(): void {
  clearTokens();
  if (window.electronAPI) {
    window.electronAPI.copilotStop().catch(() => {});
  }
  authChangeCallback(null);
}

export async function getCopilotToken(): Promise<string> {
  const cached = localStorage.getItem(COPILOT_TOKEN_KEY);
  if (cached) {
    try {
      const parsed: CopilotTokenData = JSON.parse(cached);
      if (parsed.expires_at > Date.now() / 1000 + 60) {
        return parsed.token;
      }
    } catch {
      // ignore stale cache
    }
  }

  if (!window.electronAPI) throw new Error('Electron API not available');
  const ghToken = getGitHubToken();
  if (!ghToken) throw new Error('Not signed in to GitHub');

  const res = await window.electronAPI.copilotToken(ghToken);

  if (res.status >= 400) {
    if (res.status === 401) {
      clearTokens();
      authChangeCallback(null);
      throw new Error('GitHub session expired. Please sign in again.');
    }
    throw new Error('Failed to get Copilot token. Ensure you have an active Copilot subscription.');
  }

  const data: CopilotTokenData = JSON.parse(res.body);
  localStorage.setItem(COPILOT_TOKEN_KEY, JSON.stringify(data));
  return data.token;
}

async function fetchUser(token: string): Promise<GitHubUser> {
  if (!window.electronAPI) throw new Error('Electron API not available');
  const res = await window.electronAPI.githubUser(token);
  if (res.status >= 400) throw new Error('Failed to fetch user');
  return JSON.parse(res.body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
