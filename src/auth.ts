// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';

export async function initAuth(): Promise<void> {
  const userContainer = document.getElementById('user-info');
  if (!userContainer) return;

  try {
    const user = await serverAPI.getUser();
    if (user) {
      userContainer.innerHTML = `
        <img src="${user.avatar_url}" alt="${user.login}" class="user-avatar" />
        <span class="user-login">${user.login}</span>
      `;
    } else {
      userContainer.innerHTML = '<span class="user-login">Not authenticated</span>';
    }
  } catch (err) {
    console.error('Failed to get user:', err);
    userContainer.innerHTML = '<span class="user-login">Auth error</span>';
  }
}

export async function loadModels(): Promise<void> {
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  if (!modelSelect) return;

  try {
    const result = await serverAPI.listModels();
    if (result.ok && result.models.length > 0) {
      modelSelect.innerHTML = '';
      for (const model of result.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name || model.id;
        modelSelect.appendChild(option);
      }
      // Select default model
      const defaultModel = 'claude-opus-4.6-1m';
      if (result.models.some((m) => m.id === defaultModel)) {
        modelSelect.value = defaultModel;
      }
    } else {
      modelSelect.innerHTML = '<option value="">Models unavailable</option>';
    }
  } catch (err) {
    console.error('Failed to load models:', err);
    modelSelect.innerHTML = '<option value="">Failed to load models</option>';
  }
}
