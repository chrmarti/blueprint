// Auth module - GitHub authentication and user display

let currentUser: { login: string; avatar_url: string } | null = null;

export async function initAuth(): Promise<void> {
  try {
    currentUser = await window.electronAPI.getUser();
    updateUserDisplay();
  } catch (error) {
    console.error('Failed to initialize auth:', error);
    currentUser = null;
    updateUserDisplay();
  }
}

export function getCurrentUser(): { login: string; avatar_url: string } | null {
  return currentUser;
}

export function isAuthenticated(): boolean {
  return currentUser !== null;
}

function updateUserDisplay(): void {
  const userDisplay = document.getElementById('user-display');
  if (!userDisplay) return;

  if (currentUser) {
    userDisplay.innerHTML = `
      <img src="${currentUser.avatar_url}" alt="${currentUser.login}" class="user-avatar" />
      <span class="user-login">${currentUser.login}</span>
    `;
    userDisplay.classList.remove('not-signed-in');
  } else {
    userDisplay.innerHTML = `<span class="user-login">Not signed in</span>`;
    userDisplay.classList.add('not-signed-in');
  }
}

export async function refreshAuth(): Promise<void> {
  await initAuth();
}
