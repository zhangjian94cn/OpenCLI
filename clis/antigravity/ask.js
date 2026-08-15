import { cli, Strategy } from '@jackwener/opencli/registry';
import { askAntigravity } from './utils.js';

export const askCommand = cli({
  site: 'antigravity',
  name: 'ask',
  access: 'write',
  description: 'Run a one-shot Antigravity task: optional new conversation, model switch, send, and wait',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'message', help: 'Message text to send', required: true, positional: true },
    { name: 'model', valueRequired: true, help: 'Optional target model before sending' },
    { name: 'new-conversation', type: 'boolean', default: false, help: 'Start a new conversation before sending' },
    { name: 'wait', type: 'boolean', default: false, help: 'Wait for the reply before returning' },
    { name: 'timeout', type: 'int', default: 120, help: 'Maximum seconds to wait for a reply' },
    { name: 'read-last', type: 'int', default: 5, help: 'Number of recent messages to return when waiting' },
  ],
  columns: ['ok', 'action', 'reply', 'error'],
  func: async (page, kwargs) => askAntigravity(page, kwargs),
});
