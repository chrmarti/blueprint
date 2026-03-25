### Settings

Accessible via gear icon in the toolbar:

- GitHub account sign-in / sign-out.
- Theme toggle (light / dark).
- Font size adjustment for the editor.
- Model selection dropdown, dynamically populated via the SDK's `listModels()` (default: `claude-opus-4.6-1m`). When the model list is not yet available (e.g., user not signed in, or network issues), the dropdown should indicate this state to the user rather than appearing empty.
- Max token limit is auto-filled from the selected model's `capabilities.limits.max_output_tokens` metadata.
- Temperature slider (default: 0) for controlling output determinism.
- Export full project state (markdown + implemented output + settings) as a JSON bundle.
- Import project state from a JSON bundle.

#### Verification

The settings modal can be dismissed with Esc or a click on its close toolbar button.
