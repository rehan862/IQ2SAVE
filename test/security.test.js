import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalUrl, isPrivateAddress, parseUrl } from '../server/utils/url.js';
import { containedPath, sanitizeFilename, sanitizeWithExtension } from '../server/utils/filename.js';

describe('isPrivateAddress', () => {
  // Every range here must stay blocked. A signed/unsigned mix-up in the mask
  // arithmetic previously let everything above 127.255.255.255 through, so the
  // high ranges are covered deliberately.
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.168.0.1',
    '192.168.1.1',
    '192.168.255.255',
    '198.18.0.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:169.254.169.254',
  ];

  for (const ip of blocked) {
    it(`blocks ${ip}`, () => assert.equal(isPrivateAddress(ip), true));
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1', '2606:4700::1111'];

  for (const ip of allowed) {
    it(`allows ${ip}`, () => assert.equal(isPrivateAddress(ip), false));
  }

  it('treats unparsable input as private', () => {
    assert.equal(isPrivateAddress('not-an-ip'), true);
    assert.equal(isPrivateAddress(''), true);
  });
});

describe('parseUrl', () => {
  it('accepts http and https', () => {
    assert.equal(parseUrl('https://example.com/a.mp4').protocol, 'https:');
    assert.equal(parseUrl('http://example.com/a.mp4').protocol, 'http:');
  });

  it('adds a scheme to a bare host', () => {
    assert.equal(parseUrl('example.com/video.mp4').href, 'https://example.com/video.mp4');
  });

  it('rejects non-web schemes', () => {
    for (const input of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'data:text/html,x']) {
      assert.throws(() => parseUrl(input), /valid supported URL/);
    }
  });

  it('rejects embedded credentials', () => {
    assert.throws(() => parseUrl('https://user:pass@example.com/x.mp4'), /valid supported URL/);
  });

  it('rejects empty and non-string input', () => {
    for (const input of ['', '   ', null, undefined, 42, {}]) {
      assert.throws(() => parseUrl(input));
    }
  });

  it('rejects an over-long URL', () => {
    assert.throws(() => parseUrl(`https://example.com/${'a'.repeat(4000)}`), /too long/);
  });
});

describe('canonicalUrl', () => {
  it('drops tracking parameters and fragments', () => {
    const url = parseUrl('https://youtu.be/abc?si=xyz&utm_source=x&t=30#frag');
    const result = canonicalUrl(url);
    assert.ok(!result.includes('si='));
    assert.ok(!result.includes('utm_source'));
    assert.ok(!result.includes('#'));
    assert.ok(result.includes('t=30'));
  });
});

describe('sanitizeFilename', () => {
  it('strips path separators', () => {
    assert.equal(sanitizeFilename('../../etc/passwd'), 'etc-passwd');
    assert.equal(sanitizeFilename('a/b\\c'), 'a-b-c');
  });

  it('never returns a leading dash, which a shell tool would read as a flag', () => {
    assert.ok(!sanitizeFilename('--exec=rm -rf').startsWith('-'));
  });

  it('falls back for empty or dot-only names', () => {
    assert.equal(sanitizeFilename('...'), 'download');
    assert.equal(sanitizeFilename(''), 'download');
    assert.equal(sanitizeFilename(null), 'download');
  });

  it('removes control characters', () => {
    assert.equal(sanitizeFilename('bad\u0000name\u001f'), 'badname');
  });

  it('keeps unicode titles usable', () => {
    assert.ok(sanitizeFilename('हिंदी वीडियो').length > 0);
  });

  it('truncates long names', () => {
    assert.ok(sanitizeFilename('x'.repeat(500)).length <= 120);
  });
});

describe('sanitizeWithExtension', () => {
  it('appends only an alphanumeric extension', () => {
    assert.equal(sanitizeWithExtension('clip', 'mp4'), 'clip.mp4');
    assert.equal(sanitizeWithExtension('clip', '.MP4'), 'clip.mp4');
    assert.equal(sanitizeWithExtension('clip', '../sh'), 'clip.sh');
  });
});

describe('containedPath', () => {
  it('accepts paths inside the root', () => {
    assert.equal(containedPath('/a/b', 'c.mp4'), '/a/b/c.mp4');
    assert.equal(containedPath('/a/b', '/a/b/c.mp4'), '/a/b/c.mp4');
  });

  it('rejects traversal out of the root', () => {
    assert.equal(containedPath('/a/b', '../c.mp4'), null);
    assert.equal(containedPath('/a/b', '/etc/passwd'), null);
  });

  it('rejects a sibling directory sharing a name prefix', () => {
    assert.equal(containedPath('/a/downloads', '/a/downloads-evil/x'), null);
  });
});
