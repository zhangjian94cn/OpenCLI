# WeChat Desktop

**Mode**: Native desktop app · **Platform**: macOS first · **Command**:
`opencli wechat-desktop`

`wechat-desktop` automates the native WeChat desktop client. It is not a
browser/CDP adapter. On macOS it uses Accessibility, keyboard shortcuts, and the
clipboard.

## Commands

| Command | Purpose |
|---|---|
| `opencli wechat-desktop status` | Check app/process/frontmost state |
| `opencli wechat-desktop search "文件传输助手"` | Select a chat by WeChat search |
| `opencli wechat-desktop send "文件传输助手" "message"` | Send text to a selected recipient |
| `opencli wechat-desktop send-file "文件传输助手" ./file.txt` | Send one local file |
| `opencli wechat-desktop bulk-send --contacts contacts.txt --message message.txt` | Send one message to many recipients |
| `opencli wechat-desktop capabilities` | Show implemented and planned driver coverage |

## Safety Guard

macOS WeChat does not expose stable structured Accessibility metadata for the
current chat title. For this reason, write commands allow `文件传输助手` by default
and require `--allow-unverified true` for other recipients.

Always use `--dry-run true` before sending to non-self recipients.
