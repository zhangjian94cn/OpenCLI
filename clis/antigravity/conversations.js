import { cli, Strategy } from '@jackwener/opencli/registry';
import { listAntigravityConversations } from './utils.js';

export const conversationsCommand = cli({
  site: 'antigravity',
  name: 'conversations',
  aliases: ['list'],
  access: 'read',
  description: 'List visible Antigravity sidebar projects and conversations',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['ok', 'visible_conversation_count', 'project_count'],
  func: async (page) => listAntigravityConversations(page),
});
