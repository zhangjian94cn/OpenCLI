import { cli, Strategy } from '@jackwener/opencli/registry';
import { getAntigravityPageState } from './utils.js';

export const stateCommand = cli({
  site: 'antigravity',
  name: 'state',
  access: 'read',
  description: 'Read compact Antigravity page, model, composer, and generation state',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'last', type: 'int', default: 5, help: 'Number of recent messages to include' },
  ],
  columns: ['ok', 'title', 'conversation_id', 'model', 'is_generating', 'message_count'],
  func: async (page, kwargs) => getAntigravityPageState(page, { last: kwargs.last }),
});
