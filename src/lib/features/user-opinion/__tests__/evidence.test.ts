import { describe, expect, it } from 'vitest';
import { verifyEvidenceUrl, verifyEvidenceUrls } from '../evidence';

describe('user evidence verification', () => {
  it('fetches text evidence and extracts title and preview', async () => {
    const result = await verifyEvidenceUrl('https://example.com/a', {
      fetcher: async () =>
        new Response('<html><title>Evidence A</title><p>France won its group.</p></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    });

    expect(result).toMatchObject({
      url: 'https://example.com/a',
      status: 'fetched',
      ok: true,
      statusCode: 200,
      title: 'Evidence A',
    });
    expect(result.preview).toContain('France won its group');
  });

  it('marks 404 links as failed', async () => {
    const result = await verifyEvidenceUrl('https://example.com/missing', {
      fetcher: async () =>
        new Response('missing', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'text/plain' },
        }),
    });

    expect(result.status).toBe('failed');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 404');
  });

  it('skips non-http URLs and deduplicates inputs', async () => {
    const results = await verifyEvidenceUrls(['ftp://example.com/a', 'ftp://example.com/a']);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'skipped', ok: false });
  });
});
