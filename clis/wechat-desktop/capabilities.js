import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, SAFE_SELF_RECIPIENTS } from './macos.js';

export const capabilitiesCommand = cli({
  site: SITE,
  name: 'capabilities',
  access: 'read',
  description: 'List implemented wechat-desktop driver capabilities and safety constraints',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['platform', 'driver', 'capability', 'status', 'notes'],
  defaultFormat: 'json',
  func: async () => [
    { platform: 'macos', driver: 'macos-accessibility', capability: 'status', status: 'implemented', notes: 'Read-only app/process/frontmost check' },
    { platform: 'macos', driver: 'macos-accessibility', capability: 'search/select', status: 'implemented', notes: 'Uses WeChat search via window-relative clicks and clipboard input' },
    { platform: 'macos', driver: 'macos-accessibility', capability: 'send text', status: 'implemented', notes: `Guarded by default to self recipients: ${[...SAFE_SELF_RECIPIENTS].join(', ')}` },
    { platform: 'macos', driver: 'macos-accessibility', capability: 'send file', status: 'implemented', notes: 'Uses macOS file clipboard; verify per WeChat version' },
    { platform: 'macos', driver: 'macos-accessibility', capability: 'contacts/groups enumeration', status: 'not implemented', notes: 'macOS WeChat does not expose stable structured Accessibility metadata here' },
    { platform: 'windows', driver: 'windows-uiautomation', capability: 'easyChat-style driver', status: 'planned', notes: 'Command layer is shaped to accept a future Windows UI Automation driver' },
  ],
});
