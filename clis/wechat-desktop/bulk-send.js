import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, parseLinesFile, sendTextMessage, sleep } from './macos.js';

export const bulkSendCommand = cli({
  site: SITE,
  name: 'bulk-send',
  access: 'write',
  description: 'Send one text message to each recipient listed in a UTF-8 text file',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'contacts', required: true, help: 'UTF-8 file with one contact or group name per non-empty line' },
    { name: 'message', required: true, help: 'UTF-8 file whose contents are sent as the text message' },
    { name: 'interval', type: 'number', default: 3, help: 'Seconds to wait between recipients' },
    { name: 'submit-key', default: 'enter', choices: ['enter', 'cmd-enter', 'none'], help: 'Key used to submit after paste' },
    { name: 'dry-run', type: 'boolean', default: true, help: 'Select recipients but do not paste or submit messages unless false' },
    { name: 'allow-unverified', type: 'boolean', default: false, help: 'Allow sending to non-self recipients when chat-title verification is unavailable' },
    { name: 'restore-clipboard', type: 'boolean', default: true, help: 'Restore previous text clipboard contents after each send when possible' },
    { name: 'clear-composer', type: 'boolean', default: true, help: 'Replace any existing composer text before pasting each message' },
    { name: 'search-wait', type: 'number', default: 1.2, help: 'Seconds to wait for WeChat search results before pressing Return' },
    { name: 'timeout', type: 'int', default: 300, help: 'Max seconds for the overall command' },
  ],
  columns: ['ok', 'action', 'recipient', 'submitted', 'submit_key'],
  defaultFormat: 'json',
  func: async (kwargs) => {
    const contacts = parseLinesFile(kwargs.contacts, 'contacts');
    const message = parseLinesFile(kwargs.message, 'message').lines.join('\n');
    const results = [];
    for (let index = 0; index < contacts.lines.length; index += 1) {
      const [result] = await sendTextMessage({
        recipient: contacts.lines[index],
        text: message,
        submitKey: kwargs['submit-key'],
        dryRun: kwargs['dry-run'],
        allowUnverified: kwargs['allow-unverified'],
        restoreClipboard: kwargs['restore-clipboard'],
        clearComposer: kwargs['clear-composer'],
        searchWaitSeconds: kwargs['search-wait'],
      });
      results.push({ ...result, index: index + 1, contacts_file: contacts.path });
      if (index < contacts.lines.length - 1) await sleep(kwargs.interval);
    }
    return results;
  },
});
