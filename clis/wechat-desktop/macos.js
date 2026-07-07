import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, CommandExecutionError, ConfigError, getErrorMessage } from '@jackwener/opencli/errors';

export const SITE = 'wechat-desktop';
export const DOMAIN = 'localhost';
export const DEFAULT_APP_NAME = 'WeChat';
export const SAFE_SELF_RECIPIENTS = new Set([
  '文件传输助手',
  'File Transfer',
  'File Transfer Assistant',
]);

function assertMacOS() {
  if (process.platform !== 'darwin') {
    throw new ConfigError('wechat-desktop macOS driver requires macOS');
  }
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: options.encoding ?? 'utf8',
      input: options.input,
      stdio: options.stdio,
      timeout: options.timeoutMs ?? 15000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
    });
  } catch (err) {
    const stderr = err?.stderr?.toString?.().trim();
    const detail = stderr || getErrorMessage(err);
    throw new CommandExecutionError(`${command} ${args.join(' ')} failed: ${detail}`);
  }
}

export function runOsa(script, options = {}) {
  assertMacOS();
  return run('/usr/bin/osascript', ['-e', script], options).trim();
}

function parseNumberList(raw, expected, label) {
  const values = String(raw)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
  if (values.length !== expected) {
    throw new CommandExecutionError(`Could not read WeChat ${label}: ${raw}`);
  }
  return values;
}

export function getMainWindowFrame() {
  const raw = runOsa(`tell application "System Events" to tell process "${DEFAULT_APP_NAME}" to get {position, size} of window "微信"`);
  const [x, y, width, height] = parseNumberList(raw, 4, 'window frame');
  return { x, y, width, height };
}

export function closeChatSearchWindowIfOpen() {
  runOsa(`
tell application "System Events"
  tell process "${DEFAULT_APP_NAME}"
    if exists window "搜索聊天记录" then
      click button 1 of window "搜索聊天记录"
      delay 0.3
    end if
  end tell
end tell`, { timeoutMs: 10000 });
}

export function isChatSearchWindowOpen() {
  return boolFromOsa(runOsa(`
tell application "System Events"
  tell process "${DEFAULT_APP_NAME}"
    return exists window "搜索聊天记录"
  end tell
end tell`, { timeoutMs: 10000 }));
}

function swiftNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new ArgumentError(`Invalid coordinate: ${value}`);
  return num.toFixed(1);
}

export function clickScreenPoint(x, y) {
  assertMacOS();
  const code = `import CoreGraphics; import Foundation
let point = CGPoint(x: ${swiftNumber(x)}, y: ${swiftNumber(y)})
let source = CGEventSource(stateID: .hidSystemState)
CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(80000)
CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)`;
  run('/usr/bin/swift', ['-e', code], { timeoutMs: 10000, maxBuffer: 1024 * 1024 });
}

export function clickWindowPoint(frame, offsetX, offsetY) {
  clickScreenPoint(frame.x + Number(offsetX), frame.y + Number(offsetY));
}

export function clickComposer(frame) {
  clickScreenPoint(frame.x + Math.round(frame.width * 0.58), frame.y + frame.height - 80);
}

export async function sleep(seconds) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(seconds) || 0) * 1000));
}

export function getClipboardText() {
  assertMacOS();
  try {
    return {
      ok: true,
      text: execFileSync('/usr/bin/pbpaste', {
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 10 * 1024 * 1024,
      }),
    };
  } catch {
    return { ok: false, text: '' };
  }
}

export function setClipboardText(text) {
  assertMacOS();
  run('/usr/bin/pbcopy', [], {
    input: String(text),
    timeoutMs: 3000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export function restoreClipboard(snapshot) {
  if (!snapshot?.ok) {
    return { restored: false, reason: 'previous clipboard text unavailable' };
  }
  setClipboardText(snapshot.text);
  return { restored: true };
}

function boolFromOsa(raw) {
  return String(raw).trim().toLowerCase() === 'true';
}

export function getAppStatus() {
  assertMacOS();
  const appRunning = boolFromOsa(runOsa(`application "${DEFAULT_APP_NAME}" is running`));
  const processRunning = boolFromOsa(runOsa(`tell application "System Events" to exists process "${DEFAULT_APP_NAME}"`));
  let frontmost = false;
  let frontmostProcess = '';
  try {
    frontmostProcess = runOsa('tell application "System Events" to get name of first process whose frontmost is true');
    frontmost = frontmostProcess === DEFAULT_APP_NAME;
  } catch {
    // frontmost evidence is helpful but not required for readonly status.
  }

  return {
    platform: 'macos',
    app: DEFAULT_APP_NAME,
    bundle_id: 'com.tencent.xinWeChat',
    app_running: appRunning,
    process_running: processRunning,
    frontmost,
    frontmost_process: frontmostProcess,
    driver: 'macos-accessibility',
    capabilities: [
      'status',
      'search',
      'send',
      'send-file',
      'bulk-send',
    ],
    verification: 'macOS WeChat exposes limited Accessibility metadata; write commands use guarded self-recipient defaults.',
  };
}

export async function activateWeChat(options = {}) {
  assertMacOS();
  const waitSeconds = Number(options.waitSeconds ?? 0.8);
  run('/usr/bin/open', ['-a', DEFAULT_APP_NAME], { timeoutMs: 5000 });
  await sleep(waitSeconds);

  const frontmostProcess = runOsa('tell application "System Events" to get name of first process whose frontmost is true');
  if (frontmostProcess !== DEFAULT_APP_NAME) {
    throw new CommandExecutionError(
      `WeChat did not become frontmost; frontmost process is ${frontmostProcess || 'unknown'}`,
      'Open WeChat manually, unlock the session if needed, then retry.',
    );
  }
  closeChatSearchWindowIfOpen();
  return { app: DEFAULT_APP_NAME, frontmost_process: frontmostProcess };
}

export function normalizeSubmitKey(value) {
  const submitKey = String(value ?? 'enter').trim().toLowerCase();
  if (!['enter', 'cmd-enter', 'none'].includes(submitKey)) {
    throw new ArgumentError('--submit-key must be one of: enter, cmd-enter, none');
  }
  return submitKey;
}

function submitScript(submitKey) {
  if (submitKey === 'none') return '';
  if (submitKey === 'cmd-enter') return 'keystroke return using command down';
  return 'keystroke return';
}

export async function selectRecipient(recipient, options = {}) {
  const target = String(recipient ?? '').trim();
  if (!target) throw new ArgumentError('recipient must not be empty');

  await activateWeChat({ waitSeconds: options.activateWaitSeconds ?? 0.8 });
  const frame = getMainWindowFrame();
  clickWindowPoint(frame, 155, 27);
  await sleep(0.2);
  setClipboardText(target);
  runOsa(`
tell application "System Events"
  if not (exists process "${DEFAULT_APP_NAME}") then error "WeChat process is not running"
  tell process "${DEFAULT_APP_NAME}"
    set frontmost to true
    delay 0.1
    keystroke "a" using command down
    delay 0.05
    keystroke "v" using command down
  end tell
end tell`, { timeoutMs: 10000 });
  await sleep(options.searchWaitSeconds ?? 1.2);

  let selectionMethod = 'search-return';
  if (isSafeSelfRecipient(target)) {
    // In current macOS WeChat, 文件传输助手 appears under the "功能" section.
    // This offset is relative to the main WeChat window and avoids the in-chat
    // Cmd+F path, which searches messages rather than selecting contacts.
    clickWindowPoint(frame, 175, 220);
    selectionMethod = 'search-result-function-click';
  } else {
    runOsa(`
tell application "System Events"
  tell process "${DEFAULT_APP_NAME}"
    set frontmost to true
    keystroke return
  end tell
end tell`, { timeoutMs: 10000 });
  }
  await sleep(0.7);
  if (isChatSearchWindowOpen()) {
    closeChatSearchWindowIfOpen();
    throw new CommandExecutionError(
      'WeChat opened chat-record search instead of selecting the recipient',
      'Retry with 文件传输助手 visible in the search result list, or use --dry-run true and verify the selected chat before sending.',
    );
  }

  return {
    action: 'select-recipient',
    recipient: target,
    selected: true,
    selection_method: selectionMethod,
    verification: 'selection is driven by WeChat search and window-relative clicks; macOS Accessibility does not expose a stable chat-title assertion here',
  };
}

export function isSafeSelfRecipient(recipient) {
  return SAFE_SELF_RECIPIENTS.has(String(recipient ?? '').trim());
}

export function requireRecipientWriteAllowed(recipient, allowUnverified) {
  if (isSafeSelfRecipient(recipient) || allowUnverified === true) return;
  throw new ArgumentError(
    'wechat-desktop send is guarded for unverified recipients',
    'Use 文件传输助手 for safe verification, or pass --allow-unverified true only after manually confirming the target chat.',
  );
}

export async function sendTextMessage({
  recipient,
  text,
  submitKey = 'enter',
  dryRun = false,
  allowUnverified = false,
  restoreClipboard: shouldRestoreClipboard = true,
  clearComposer: shouldClearComposer = true,
  searchWaitSeconds = 1.2,
}) {
  const message = String(text ?? '');
  if (!message.trim()) throw new ArgumentError('text must not be empty');
  const normalizedSubmitKey = normalizeSubmitKey(submitKey);
  requireRecipientWriteAllowed(recipient, allowUnverified);

  const clipboard = getClipboardText();
  const selected = await selectRecipient(recipient, { searchWaitSeconds });

  if (dryRun) {
    const restore = shouldRestoreClipboard ? restoreClipboard(clipboard) : { restored: false, reason: 'disabled' };
    return [{
      ok: true,
      action: 'dry-run',
      recipient: selected.recipient,
      message_preview: message.slice(0, 80),
      submitted: false,
      clipboard_restored: restore.restored,
      clipboard_restore_reason: restore.reason ?? '',
      verification: selected.verification,
    }];
  }

  setClipboardText(message);
  clickComposer(getMainWindowFrame());
  await sleep(0.2);
  const submit = submitScript(normalizedSubmitKey);
  const clearComposerScript = shouldClearComposer
    ? 'keystroke "a" using command down\ndelay 0.05\nkey code 51\ndelay 0.05'
    : '';
  const script = `
tell application "System Events"
  if not (exists process "${DEFAULT_APP_NAME}") then error "WeChat process is not running"
  tell process "${DEFAULT_APP_NAME}"
    set frontmost to true
    delay 0.2
    ${clearComposerScript}
    keystroke "v" using command down
    delay 0.8
    ${submit}
    delay 1.0
  end tell
end tell`;
  runOsa(script, { timeoutMs: 10000 });

  const restore = shouldRestoreClipboard ? restoreClipboard(clipboard) : { restored: false, reason: 'disabled' };
  return [{
    ok: true,
    action: 'send',
    recipient: selected.recipient,
    submitted: normalizedSubmitKey !== 'none',
    submit_key: normalizedSubmitKey,
    clear_composer: shouldClearComposer,
    message_preview: message.slice(0, 80),
    clipboard_restored: restore.restored,
    clipboard_restore_reason: restore.reason ?? '',
    verification: selected.verification,
  }];
}

function osaString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function sendFileMessage({
  recipient,
  file,
  submitKey = 'enter',
  dryRun = false,
  allowUnverified = false,
  clearComposer: shouldClearComposer = true,
  searchWaitSeconds = 1.2,
}) {
  const filePath = path.resolve(String(file ?? ''));
  if (!fs.existsSync(filePath)) throw new ArgumentError(`file not found: ${filePath}`);
  if (!fs.statSync(filePath).isFile()) throw new ArgumentError(`file is not a regular file: ${filePath}`);
  const normalizedSubmitKey = normalizeSubmitKey(submitKey);
  requireRecipientWriteAllowed(recipient, allowUnverified);

  const selected = await selectRecipient(recipient, { searchWaitSeconds });
  if (dryRun) {
    return [{
      ok: true,
      action: 'dry-run-file',
      recipient: selected.recipient,
      file: filePath,
      submitted: false,
      verification: selected.verification,
    }];
  }

  const submit = submitScript(normalizedSubmitKey);
  clickComposer(getMainWindowFrame());
  await sleep(0.2);
  const clearComposerScript = shouldClearComposer
    ? 'keystroke "a" using command down\ndelay 0.05\nkey code 51\ndelay 0.05'
    : '';
  const script = `
set targetFile to POSIX file "${osaString(filePath)}"
set the clipboard to targetFile
tell application "System Events"
  if not (exists process "${DEFAULT_APP_NAME}") then error "WeChat process is not running"
  tell process "${DEFAULT_APP_NAME}"
    set frontmost to true
    delay 0.2
    ${clearComposerScript}
    keystroke "v" using command down
    delay 1.0
    ${submit}
    delay 1.0
  end tell
end tell`;
  runOsa(script, { timeoutMs: 10000 });

  return [{
    ok: true,
    action: 'send-file',
    recipient: selected.recipient,
    file: filePath,
    submitted: normalizedSubmitKey !== 'none',
    submit_key: normalizedSubmitKey,
    clear_composer: shouldClearComposer,
    verification: selected.verification,
  }];
}

export function parseLinesFile(filePath, label) {
  const resolved = path.resolve(String(filePath ?? ''));
  if (!fs.existsSync(resolved)) throw new ArgumentError(`${label} file not found: ${resolved}`);
  const content = fs.readFileSync(resolved, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length === 0) throw new ArgumentError(`${label} file has no non-empty lines: ${resolved}`);
  return { path: resolved, lines };
}
