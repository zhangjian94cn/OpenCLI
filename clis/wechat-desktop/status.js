import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, getAppStatus } from './macos.js';

export const statusCommand = cli({
  site: SITE,
  name: 'status',
  access: 'read',
  description: 'Check macOS WeChat desktop automation readiness',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['platform', 'app', 'app_running', 'process_running', 'frontmost', 'driver'],
  defaultFormat: 'json',
  func: async () => [getAppStatus()],
});
