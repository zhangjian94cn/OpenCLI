import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { isSafeSelfRecipient, normalizeSubmitKey } from './macos.js';
import './bulk-send.js';
import './capabilities.js';
import './search.js';
import './send-file.js';
import './send.js';
import './status.js';

describe('wechat-desktop command registration', () => {
  it('registers macOS desktop commands as non-browser public commands', () => {
    const expectedAccess = {
      'bulk-send': 'write',
      capabilities: 'read',
      search: 'write',
      'send-file': 'write',
      send: 'write',
      status: 'read',
    };

    for (const [name, access] of Object.entries(expectedAccess)) {
      const cmd = getRegistry().get(`wechat-desktop/${name}`);
      expect(cmd, `wechat-desktop/${name}`).toBeDefined();
      expect(cmd.site).toBe('wechat-desktop');
      expect(cmd.domain).toBe('localhost');
      expect(cmd.strategy).toBe('public');
      expect(cmd.browser).toBe(false);
      expect(cmd.access).toBe(access);
    }
  });

  it('keeps recipient write guard focused on self-chat defaults', () => {
    expect(isSafeSelfRecipient('文件传输助手')).toBe(true);
    expect(isSafeSelfRecipient('File Transfer Assistant')).toBe(true);
    expect(isSafeSelfRecipient('普通联系人')).toBe(false);
  });

  it('normalizes supported submit keys', () => {
    expect(normalizeSubmitKey('enter')).toBe('enter');
    expect(normalizeSubmitKey('cmd-enter')).toBe('cmd-enter');
    expect(normalizeSubmitKey('none')).toBe('none');
    expect(() => normalizeSubmitKey('space')).toThrow();
  });
});
