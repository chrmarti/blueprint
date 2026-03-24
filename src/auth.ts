// auth.ts — GitHub token resolution and user info

import { execFile } from 'child_process';

export function resolveGitHubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) {
    return Promise.resolve(process.env.GITHUB_TOKEN);
  }

  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
}

export async function fetchGitHubUser(token: string): Promise<GitHubUser | null> {
  const { default: https } = await import('https');

  return new Promise((resolve) => {
    const req = https.request(
      'https://api.github.com/user',
      {
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'blueprint-implementer',
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          try {
            const user = JSON.parse(body);
            if (user.login) {
              resolve({ login: user.login, avatar_url: user.avatar_url });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}
