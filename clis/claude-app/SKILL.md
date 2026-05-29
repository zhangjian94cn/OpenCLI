---
name: claude-app
description: Control the Claude desktop App through OpenCLI/CDP. Use `opencli claude` for claude.ai through Chrome Browser Bridge; use `opencli claude-app` only for `/Applications/Claude.app`.
---

# Claude App OpenCLI Adapter

`claude-app` is a desktop adapter for `/Applications/Claude.app` (`com.anthropic.claudefordesktop`).

It is intentionally separate from `claude`:

- `opencli claude ...` controls claude.ai through Chrome Browser Bridge and Cookie Strategy.
- `opencli claude-app ...` controls the Claude desktop App through Electron/CDP.

Before using it, Claude App must expose a CDP endpoint. Either set:

```bash
OPENCLI_CDP_ENDPOINT=http://127.0.0.1:<port>
```

or manually start Claude App with a remote debugging port. The built-in
`claude-app` Electron registry entry does not auto-restart a running Claude App.

Core commands:

```bash
opencli claude-app status --format json
opencli claude-app projects --format json
opencli claude-app project "My Project" --format json
opencli claude-app history --format json
opencli claude-app detail <conversation-id> --format json
opencli claude-app new --format json
opencli claude-app new --project "My Project" --format json
opencli claude-app send "Hello" --format json
opencli claude-app ask "Hello" --project "My Project" --new true --format json
opencli claude-app read --format json
```
