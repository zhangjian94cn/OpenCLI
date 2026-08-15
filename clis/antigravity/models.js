import { cli, Strategy } from '@jackwener/opencli/registry';
import { listAntigravityModels } from './utils.js';

export const modelsCommand = cli({
  site: 'antigravity',
  name: 'models',
  access: 'read',
  description: 'List visible Antigravity model options and the current model',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['ok', 'currentModel', 'availableModels'],
  func: async (page) => listAntigravityModels(page),
});
