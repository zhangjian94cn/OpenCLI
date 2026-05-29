import { cli, Strategy } from '@jackwener/opencli/registry';
import { waitForAntigravityIdle } from './utils.js';

export const waitCommand = cli({
  site: 'antigravity',
  name: 'wait',
  access: 'read',
  description: 'Wait for Antigravity generation to finish and return the latest reply',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'timeout', type: 'int', default: 120, help: 'Maximum seconds to wait' },
    { name: 'read-last', type: 'int', default: 5, help: 'Number of recent messages to return' },
  ],
  columns: ['ok', 'is_generating', 'message_count', 'reply'],
  func: async (page, kwargs) => waitForAntigravityIdle(page, {
    timeout: kwargs.timeout,
    readLast: kwargs['read-last'],
  }),
});
