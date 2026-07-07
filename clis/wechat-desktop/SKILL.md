---
name: wechat-desktop
description: Automate the native WeChat desktop client through OpenCLI. On macOS this uses Accessibility, keyboard shortcuts, and the clipboard; it is not a CDP adapter.
---

# WeChat Desktop OpenCLI Adapter

`wechat-desktop` provides OpenCLI commands for native WeChat desktop automation.

This adapter is intentionally **not** a browser/CDP adapter. macOS WeChat does
not expose stable DOM/CDP state, so commands use `Strategy.PUBLIC` with
`browser: false`.

## macOS Commands

```bash
opencli wechat-desktop status --format json
opencli wechat-desktop search "文件传输助手" --format json
opencli wechat-desktop send "文件传输助手" "hello" --format json
opencli wechat-desktop send-file "文件传输助手" ./example.txt --format json
opencli wechat-desktop bulk-send --contacts contacts.txt --message message.txt --dry-run true --format json
```

## Safety

`send` and `send-file` default to guarded behavior: self-chat recipients such as
`文件传输助手` are allowed, while other recipients require `--allow-unverified true`.
This is because macOS WeChat exposes limited Accessibility metadata and the
adapter cannot reliably assert the selected chat title across WeChat versions.

Use `--dry-run true` to select the recipient without pasting or submitting a
message.
