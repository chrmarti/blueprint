// Chat module - chat panel for conversational blueprint editing

import { marked } from 'marked';
import { refreshFileTree, getCurrentFolder } from './files.js';
import { loadSettings } from './storage.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

let conversationHistory: ChatMessage[] = [];
let isResponding = false;
let currentResponse = '';

export function initChatPanel(): void {
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('chat-send-btn');

  // Handle send button
  sendBtn?.addEventListener('click', () => {
    sendMessage();
  });

  // Handle Enter key (Shift+Enter for newlines)
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Set up event handlers
  window.electronAPI.onChatChunk((chunk) => {
    currentResponse += chunk;
    updateCurrentAssistantMessage();
  });

  window.electronAPI.onChatEvent((event) => {
    handleChatEvent(event);
  });
}

async function sendMessage(): Promise<void> {
  if (isResponding) return;

  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  const message = input?.value.trim();
  if (!message) return;

  const folder = getCurrentFolder();
  if (!folder) {
    alert('No folder open');
    return;
  }

  // Check authentication
  const user = await window.electronAPI.getUser();
  if (!user) {
    alert('Not signed in');
    return;
  }

  // Add user message to history and UI
  conversationHistory.push({ role: 'user', content: message });
  appendMessageToUI('user', message);

  // Clear input
  input.value = '';
  
  // Disable input while responding
  setResponding(true);
  currentResponse = '';

  // Add placeholder for assistant response
  appendMessageToUI('assistant', '...');

  const settings = loadSettings();

  // Get blueprint content for context
  let blueprintContent = '';
  try {
    blueprintContent = await window.electronAPI.readFile(`${folder}/blueprint.md`);
  } catch {
    // Blueprint not found, continue without it
  }

  const systemPrompt = blueprintContent 
    ? `Current blueprint.md content:\n\`\`\`markdown\n${blueprintContent}\n\`\`\`\n\n`
    : '';

  try {
    const result = await window.electronAPI.chat({
      model: settings.model,
      systemPrompt,
      userPrompt: message,
      conversationHistory: conversationHistory.slice(0, -1), // Exclude the current user message (already in history)
    });

    if (result.ok) {
      // Add assistant response to history
      conversationHistory.push({ role: 'assistant', content: currentResponse });
    } else {
      // Show error in place of response
      currentResponse = `Error: ${result.error}`;
      updateCurrentAssistantMessage();
    }
  } catch (error) {
    currentResponse = `Error: ${error instanceof Error ? error.message : String(error)}`;
    updateCurrentAssistantMessage();
  } finally {
    setResponding(false);
  }
}

function handleChatEvent(event: { type: string; data?: Record<string, unknown> }): void {
  switch (event.type) {
    case 'files_changed':
      refreshFileTree();
      break;
    case 'error':
      currentResponse += `\n\nError: ${event.data?.message}`;
      updateCurrentAssistantMessage();
      break;
    case 'done':
      // Response complete
      break;
  }
}

function appendMessageToUI(role: 'user' | 'assistant', content: string): void {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${role}`;
  messageEl.dataset.role = role;

  if (role === 'assistant') {
    messageEl.innerHTML = renderMarkdown(content);
  } else {
    messageEl.textContent = content;
  }

  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateCurrentAssistantMessage(): void {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  // Find the last assistant message
  const messages = messagesContainer.querySelectorAll('.chat-message.assistant');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage) {
    lastMessage.innerHTML = renderMarkdown(currentResponse || '...');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function renderMarkdown(content: string): string {
  try {
    return marked.parse(content, { async: false }) as string;
  } catch {
    return content;
  }
}

function setResponding(responding: boolean): void {
  isResponding = responding;
  
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('chat-send-btn');
  const indicator = document.getElementById('chat-indicator');

  if (input) {
    input.disabled = responding;
  }
  if (sendBtn) {
    (sendBtn as HTMLButtonElement).disabled = responding;
  }
  if (indicator) {
    indicator.style.display = responding ? 'block' : 'none';
  }
}

export function clearChat(): void {
  conversationHistory = [];
  currentResponse = '';
  
  const messagesContainer = document.getElementById('chat-messages');
  if (messagesContainer) {
    messagesContainer.innerHTML = '';
  }
}
