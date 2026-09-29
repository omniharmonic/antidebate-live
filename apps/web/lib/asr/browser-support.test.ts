import { describe, expect, it } from 'vitest';
import { browserSupport } from './browser-support';

const chrome = (v: number) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;

describe('browserSupport', () => {
  it('accepts desktop Chrome and Edge at 120 or later', () => {
    expect(browserSupport(chrome(120))).toBe(true);
    expect(browserSupport(chrome(141))).toBe(true);
    expect(browserSupport(`${chrome(130)} Edg/130.0.0.0`)).toBe(true);
  });
  it('rejects older Chrome', () => {
    expect(browserSupport(chrome(119))).toBe(false);
  });
  it('rejects Safari and Firefox', () => {
    expect(browserSupport('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15')).toBe(false);
    expect(browserSupport('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0')).toBe(false);
  });
  it('rejects mobile browsers, including Chrome on Android and iOS', () => {
    expect(browserSupport('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36')).toBe(false);
    expect(browserSupport('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});
