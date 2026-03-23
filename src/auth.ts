// auth.ts - GitHub token management for Blueprint Implementer

let cachedGitHubUser: GitHubUser | null = null;

interface GitHubUser {
  login: string;
  avatar_url: string;
  name?: string;
}

export async function getGitHubUser(): Promise<GitHubUser | null> {
  if (cachedGitHubUser) {
    return cachedGitHubUser;
  }

  const user = await window.electronAPI.getUser();
  if (user) {
    cachedGitHubUser = user;
  }
  return user;
}

export function getCachedUser(): GitHubUser | null {
  return cachedGitHubUser;
}

export function updateUserDisplay(): void {
  const userInfo = document.getElementById('user-info');
  if (!userInfo) return;

  const user = getCachedUser();
  if (user) {
    userInfo.innerHTML = `
      <img class="user-avatar" src="${user.avatar_url}" alt="${user.login}">
      <span class="user-login">${user.login}</span>
    `;
  } else {
    userInfo.innerHTML = '<span class="user-login">Not signed in</span>';
  }
}

export async function initAuth(): Promise<void> {
  await getGitHubUser();
  updateUserDisplay();
}
