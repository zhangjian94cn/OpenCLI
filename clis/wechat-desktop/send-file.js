import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, sendFileMessage } from './macos.js';

export const sendFileCommand = cli({
  site: SITE,
  name: 'send-file',
  access: 'write',
  description: 'Send a local file through the macOS WeChat desktop client',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'recipient', positional: true, required: true, help: 'Contact or group name, e.g. 文件传输助手' },
    { name: 'file', positional: true, required: true, help: 'Path to the local file to send' },
    { name: 'submit-key', default: 'enter', choices: ['enter', 'cmd-enter', 'none'], help: 'Key used to submit after paste' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Select recipient but do not paste or submit the file' },
    { name: 'allow-unverified', type: 'boolean', default: false, help: 'Allow sending to non-self recipients when chat-title verification is unavailable' },
    { name: 'clear-composer', type: 'boolean', default: true, help: 'Replace any existing composer text before pasting the file' },
    { name: 'search-wait', type: 'number', default: 1.2, help: 'Seconds to wait for WeChat search results before pressing Return' },
    { name: 'timeout', type: 'int', default: 20, help: 'Max seconds for the overall command' },
  ],
  columns: ['ok', 'action', 'recipient', 'file', 'submitted', 'submit_key'],
  defaultFormat: 'json',
  func: async (kwargs) => sendFileMessage({
    recipient: kwargs.recipient,
    file: kwargs.file,
    submitKey: kwargs['submit-key'],
    dryRun: kwargs['dry-run'],
    allowUnverified: kwargs['allow-unverified'],
    clearComposer: kwargs['clear-composer'],
    searchWaitSeconds: kwargs['search-wait'],
  }),
});
