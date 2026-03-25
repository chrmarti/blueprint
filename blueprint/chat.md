## Chat Panel

The chat panel provides a conversational interface for iterating on the blueprint with the Copilot SDK agent.

### Requirements

- The Chat panel is a tab in the right panel, alongside the Output tab. Chat appears to the left of Output.
- The panel displays the conversation history from the current session as a scrollable message list.
- Messages are visually distinguished by role: user messages are right-aligned, assistant messages are left-aligned.
- Assistant messages render markdown (using `marked`) with syntax-highlighted code blocks.
- An input field at the bottom of the panel with a **Send** button. Pressing Enter also sends the message (Shift+Enter for newlines).
- While the agent is responding, the input field is disabled and a streaming indicator is shown.
- The agent's response streams in token-by-token, appending to the current assistant message as it arrives.

### Copilot SDK Integration

- Uses the same shared `copilot-agent.ts` module and Copilot SDK infrastructure as the Output panel, but with a distinct system prompt.
- The system prompt focuses on **updating the blueprint**: the agent's role is to help the user refine, restructure, and extend the markdown blueprint. It should not modify implementation files unless the user explicitly asks for it.
- The agent has access to the same file tools as the implementation agent, so it can read and write files in the workspace — primarily `blueprint.md` and files under `/blueprint`.
- The conversation context includes the current contents of `blueprint.md` so the agent can reason about the existing blueprint.
- Each chat session maintains its own conversation history (list of user/assistant message pairs) for multi-turn context.
- The file tree auto-refreshes when the agent signals `files_changed`.
