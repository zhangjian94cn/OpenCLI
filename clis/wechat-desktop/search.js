import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, selectRecipient } from './macos.js';

export const searchCommand = cli({
  site: SITE,
  name: 'search',
  aliases: ['select'],
  access: 'write',
  description: 'Select a WeChat desktop chat by searching its contact or group name',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'recipient', positional: true, required: true, help: 'Contact or group name to select, e.g. 文件传输助手' },
    { name: 'search-wait', type: 'number', default: 1.2, help: 'Seconds to wait for WeChat search results before pressing Return' },
  ],
  columns: ['action', 'recipient', 'selected', 'verification'],
  defaultFormat: 'json',
  func: async (kwargs) => [await selectRecipient(kwargs.recipient, { searchWaitSeconds: kwargs['search-wait'] })],
});
