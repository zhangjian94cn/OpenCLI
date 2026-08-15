---
name: antigravity
description: How to automate Antigravity using OpenCLI
---

# Antigravity Automation Skill

This skill allows AI agents to control the [Antigravity](https://github.com/chengazhen/Antigravity) desktop app (and any Electron app with CDP enabled) programmatically via OpenCLI. 

## Requirements
opencli automatically detects, launches (with `--remote-debugging-port=9234`), and connects to Antigravity.
If Antigravity is already running without CDP, opencli will prompt to restart it.

If the endpoint exposes multiple inspectable targets, set:
\`\`\`bash
export OPENCLI_CDP_TARGET="antigravity"
\`\`\`

## High-Level Capabilities
1. **One-shot tasks (`opencli antigravity ask <message>`)**: Optionally start a new conversation, switch model, send, wait, and return the reply in one command.
2. **State (`opencli antigravity state`)**: Read current URL, title, conversation id, model, generation state, composer state, and recent messages.
3. **Conversations (`opencli antigravity conversations`)**: List visible sidebar projects and conversations without dumping raw DOM to the model.
4. **Models (`opencli antigravity models`)**: List visible model options and the current selected model.
5. **Open Conversation (`opencli antigravity open <id-or-title>`)**: Open a visible sidebar conversation.
6. **Wait/Stop (`opencli antigravity wait` / `opencli antigravity stop`)**: Wait for generation to finish or stop the current generation.
7. **Send/Read/Extract (`send`, `read`, `extract-code`)**: Script message IO and code-block extraction.
8. **Switch/New (`model`, `new`)**: Switch active model or start a fresh conversation.

## Examples for Automated Workflows

### Generating and Saving Code
\`\`\`bash
opencli antigravity send "Write a python script to fetch HN top stories"
# wait ~10-15 seconds for output to render
opencli antigravity extract-code > hn_fetcher.py
\`\`\`

### One-shot Remote Control
\`\`\`bash
opencli antigravity ask "Hello" \
  --new-conversation true \
  --model "Gemini 3.5 Flash Medium" \
  --wait true \
  --format json
\`\`\`

### Inspecting Current UI State
\`\`\`bash
opencli antigravity state --format json
opencli antigravity conversations --format json
opencli antigravity models --format json
\`\`\`

### Reading Real-time Logs
Agents can run long-running streaming watch instances:
\`\`\`bash
opencli antigravity watch
\`\`\`
