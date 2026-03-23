/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface CopilotTokenData {
  token: string;
  expires_at: number;
}

const COPILOT_TOKEN_KEY = 'blueprint-implementer:copilot-token';

let currentUser: GitHubUser | null = null;
let authChangeCallback: (user: GitHubUser | null) => void = () => {};

export function initAuth(opts: { onAuthChange: (user: GitHubUser | null) => void }): void {
  authChangeCallback = opts.onAuthChange;
  if (!window.electronAPI) return;
  window.electronAPI.getAuthUser().then((user) => {
    currentUser = user;
    authChangeCallback(user);
  }).catch(() => {
    authChangeCallback(null);
  });
}

export function isSignedIn(): boolean {
  return currentUser !== null;
}

export function getUser(): GitHubUser | null {
  return currentUser;
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

  const res = await window.electronAPI.copilotToken();

  if (res.status >= 400) {
    throw new Error('Failed to get Copilot token. Ensure you have an active Copilot subscription.');
  }

  const data: CopilotTokenData = JSON.parse(res.body);
  localStorage.setItem(COPILOT_TOKEN_KEY, JSON.stringify(data));
  return data.token;
}
