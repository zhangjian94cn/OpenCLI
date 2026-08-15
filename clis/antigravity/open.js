import { cli, Strategy } from '@jackwener/opencli/registry';
import { openAntigravityConversation } from './utils.js';

export const openCommand = cli({
  site: 'antigravity',
  name: 'open',
  access: 'write',
  description: 'Open a visible Antigravity sidebar conversation by id or title',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'target', help: 'Conversation id or visible title text', required: true, positional: true },
  ],
  columns: ['ok', 'id', 'title'],
  func: async (page, kwargs) => openAntigravityConversation(page, kwargs.target),
});
