import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, sendTextMessage } from './macos.js';

export const sendCommand = cli({
  site: SITE,
  name: 'send',
  aliases: ['send-to'],
  access: 'write',
  description: 'Send a text message through the macOS WeChat desktop client',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'recipient', positional: true, required: true, help: 'Contact or group name, e.g. 文件传输助手' },
    { name: 'text', positional: true, required: true, help: 'Message text to send' },
    { name: 'submit-key', default: 'enter', choices: ['enter', 'cmd-enter', 'none'], help: 'Key used to submit after paste' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Select recipient but do not paste or submit the message' },
    { name: 'allow-unverified', type: 'boolean', default: false, help: 'Allow sending to non-self recipients when chat-title verification is unavailable' },
    { name: 'restore-clipboard', type: 'boolean', default: true, help: 'Restore previous text clipboard contents after the command when possible' },
    { name: 'clear-composer', type: 'boolean', default: true, help: 'Replace any existing composer text before pasting the message' },
    { name: 'search-wait', type: 'number', default: 1.2, help: 'Seconds to wait for WeChat search results before pressing Return' },
    { name: 'timeout', type: 'int', default: 20, help: 'Max seconds for the overall command' },
  ],
  columns: ['ok', 'action', 'recipient', 'submitted', 'submit_key', 'message_preview'],
  defaultFormat: 'json',
  func: async (kwargs) => sendTextMessage({
    recipient: kwargs.recipient,
    text: kwargs.text,
    submitKey: kwargs['submit-key'],
    dryRun: kwargs['dry-run'],
    allowUnverified: kwargs['allow-unverified'],
    restoreClipboard: kwargs['restore-clipboard'],
    clearComposer: kwargs['clear-composer'],
    searchWaitSeconds: kwargs['search-wait'],
  }),
});
