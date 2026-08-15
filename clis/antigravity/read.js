import { cli, Strategy } from '@jackwener/opencli/registry';
import { getAntigravityConversationSnapshot } from './utils.js';

export const readCommand = cli({
  site: 'antigravity',
  name: 'read',
  access: 'read',
  description: 'Read the latest chat messages from Antigravity AI',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'last', type: 'int', default: 5, help: 'Number of recent messages to read from the current Antigravity conversation' },
  ],
  columns: ['ok', 'message_count'],
  func: async (page, kwargs) => {
    const snapshot = await getAntigravityConversationSnapshot(page, { last: kwargs.last });
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    return {
      ok: true,
      message_count: snapshot.messageCount || messages.length,
      messages,
      content: messages.map((message) => message.content).filter(Boolean).join('\n\n---\n\n'),
    };
  },
});
