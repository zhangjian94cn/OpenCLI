import { cli, Strategy } from '@jackwener/opencli/registry';
import { stopAntigravityGeneration } from './utils.js';

export const stopCommand = cli({
  site: 'antigravity',
  name: 'stop',
  access: 'write',
  description: 'Stop the current Antigravity generation if a stop button is visible',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['ok', 'stopped', 'error'],
  func: async (page) => stopAntigravityGeneration(page),
});
