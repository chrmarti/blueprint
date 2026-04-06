// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { serverAPI } from './api-client.js';
import { refreshFileTree } from './files.js';
import { marked } from 'marked';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

let chatConnection: ReturnType<typeof serverAPI.connectChat> | null = null;
let messages: ChatMessage[] = [];
let isStreaming = false;
let currentAssistantMessage = '';

export function initChat(): void {
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('chat-send-btn');
  
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }

  // Connect to chat WebSocket
  connectChat();
}

function connectChat(): void {
  chatConnection = serverAPI.connectChat();
  
  chatConnection.onChunk((content) => {
    if (!isStreaming) {
      isStreaming = true;
      currentAssistantMessage = '';
      // Add a new assistant message placeholder
      messages.push({ role: 'assistant', content: '' });
    }
    currentAssistantMessage += content;
    // Update the last assistant message
    messages[messages.length - 1].content = currentAssistantMessage;
    renderMessages();
  });
  
  chatConnection.onEvent((data) => {
    const event = data as { type: string; [key: string]: unknown };
    if (event.type === 'files_changed') {
      refreshFileTree();
    }
  });
  
  chatConnection.onDone(() => {
    isStreaming = false;
    enableInput();
    renderMessages();
  });
}

function sendMessage(): void {
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  if (!input || !chatConnection) return;
  
  const content = input.value.trim();
  if (!content) return;
  
  // Add user message
  messages.push({ role: 'user', content });
  renderMessages();
  
  // Clear input
  input.value = '';
  
  // Disable input while streaming
  disableInput();
  
  // Send to server
  chatConnection.send(content);
}

function renderMessages(): void {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  container.innerHTML = '';
  
  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = `chat-message ${msg.role}`;
    
    if (msg.role === 'assistant') {
      // Render markdown for assistant messages
      div.innerHTML = marked(msg.content) as string;
    } else {
      div.textContent = msg.content;
    }
    
    container.appendChild(div);
  }
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function disableInput(): void {
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
  const indicator = document.getElementById('chat-streaming-indicator');
  
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (indicator) indicator.style.display = 'block';
}

function enableInput(): void {
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
  const indicator = document.getElementById('chat-streaming-indicator');
  
  if (input) {
    input.disabled = false;
    input.focus();
  }
  if (sendBtn) sendBtn.disabled = false;
  if (indicator) indicator.style.display = 'none';
}
