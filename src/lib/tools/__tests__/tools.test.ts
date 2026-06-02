import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSearchHandler } from '../search';
import { makeFetchUrlHandler } from '../fetch';
import { makeConcedeHandler, InMemoryConcessionTracker } from '../concede';
import {
  makeRepoListFilesHandler,
  makeRepoReadFileHandler,
  makeRepoSearchHandler,
} from '../local-repo';

const ctx = { modelId: 'm', runId: 'r' } as const;

describe('search tool', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it('hits SearXNG /search?format=json with engines param', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ results: [
        { title: 'T1', url: 'http://x/1', content: 'snip1' },
        { title: 'T2', url: 'http://x/2', content: 'snip2' },
      ] }), { status: 200 })
    );
    globalThis.fetch = fetchFn as any;

    const handler = makeSearchHandler({ baseUrl: 'http://localhost:28080' });
    const result = await handler({ query: 'rust ownership', num_results: 2 }, ctx);

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/search?');
    expect(calledUrl).toContain('format=json');
    expect(calledUrl).toContain('engines=bing');
    if (result.ok) {
      expect(result.content).toContain('[1] T1');
      expect(result.content).toContain('http://x/1');
      expect(result.content).toContain('[2] T2');
    }
  });

  it('rejects empty query', async () => {
    globalThis.fetch = vi.fn() as any;
    const handler = makeSearchHandler({ baseUrl: 'http://localhost:28080' });
    const result = await handler({ query: '   ' }, ctx);
    expect(result.ok).toBe(false);
  });

  it('handles SearXNG error response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as any;
    const handler = makeSearchHandler({ baseUrl: 'http://localhost:28080' });
    const result = await handler({ query: 'x' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/HTTP 429/);
  });

  it('reports empty result set explicitly', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    ) as any;
    const handler = makeSearchHandler({ baseUrl: 'http://localhost:28080' });
    const result = await handler({ query: 'nonsensequerythatreturnsnothing' }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toMatch(/No results/);
  });
});

describe('fetch_url tool', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it('strips HTML and returns readable text', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('<html><body><h1>Title</h1><p>Hello <b>world</b></p><script>x()</script></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    ) as any;
    const handler = makeFetchUrlHandler();
    const result = await handler({ url: 'http://example.com' }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Title');
      expect(result.content).toContain('Hello world');
      expect(result.content).not.toContain('<script>');
      expect(result.content).not.toContain('x()');
    }
  });

  it('rejects non-http URLs', async () => {
    const handler = makeFetchUrlHandler();
    const result = await handler({ url: 'file:///etc/passwd' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/http\/https/);
  });

  it('rejects binary content-type', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    ) as any;
    const handler = makeFetchUrlHandler();
    const result = await handler({ url: 'http://example.com/x.bin' }, ctx);
    expect(result.ok).toBe(false);
  });

  it('truncates content at maxBytes', async () => {
    const big = 'A'.repeat(20000);
    globalThis.fetch = vi.fn(async () =>
      new Response(big, { status: 200, headers: { 'content-type': 'text/plain' } })
    ) as any;
    const handler = makeFetchUrlHandler({ maxBytes: 100 });
    const result = await handler({ url: 'http://example.com' }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('[truncated]');
      expect(result.content.length).toBeLessThan(500);
    }
  });
});

describe('concede tool', () => {
  it('records concession in tracker', async () => {
    const tracker = new InMemoryConcessionTracker();
    const handler = makeConcedeHandler(tracker);
    const result = await handler(
      { reason: 'search showed I was wrong about the date', defer_to: 'qwen-235b' },
      { modelId: 'glm-4.7', runId: 'r1' }
    );
    expect(result.ok).toBe(true);
    expect(tracker.isWithdrawn('glm-4.7')).toBe(true);
    expect(tracker.isWithdrawn('qwen-235b')).toBe(false);
    expect(tracker.list()).toHaveLength(1);
    expect(tracker.list()[0].deferTo).toBe('qwen-235b');
  });

  it('rejects empty reason', async () => {
    const tracker = new InMemoryConcessionTracker();
    const handler = makeConcedeHandler(tracker);
    const result = await handler({ reason: '   ' }, { modelId: 'm', runId: 'r' });
    expect(result.ok).toBe(false);
    expect(tracker.list()).toHaveLength(0);
  });

  it('first concession sticks (subsequent calls ignored)', async () => {
    const tracker = new InMemoryConcessionTracker();
    const handler = makeConcedeHandler(tracker);
    await handler({ reason: 'first' }, { modelId: 'm', runId: 'r' });
    await handler({ reason: 'second' }, { modelId: 'm', runId: 'r' });
    expect(tracker.list()).toHaveLength(1);
    expect(tracker.list()[0].reason).toBe('first');
  });
});

describe('local repo audit tools', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeRepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'aap-local-repo-'));
    const fakeSecret = ['sk', 'thisShouldBeRedacted1234567890'].join('-');
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '.venv', 'Lib', 'site-packages'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), `export const token = "${fakeSecret}";\nexport function run() { return 1; }\n`);
    writeFileSync(join(root, 'dist', 'bundle.js'), 'generated bug marker\n');
    writeFileSync(join(root, '.git', 'config'), 'secret git marker\n');
    writeFileSync(join(root, 'assets', 'demo.txt'), 'asset marker\n');
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'dependency marker\n');
    writeFileSync(join(root, '.venv', 'Lib', 'site-packages', 'pkg.py'), 'python env marker\n');
    writeFileSync(join(root, '.env'), 'API_KEY=secret\n');
    return root;
  }

  it('lists only allowed repository files and excludes bulky or sensitive directories', async () => {
    const root = makeRepo();
    const handler = makeRepoListFilesHandler({ roots: [root], maxFiles: 50 });
    const result = await handler({}, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('src/app.ts');
      expect(result.content).not.toContain('dist/bundle.js');
      expect(result.content).not.toContain('.git/config');
      expect(result.content).not.toContain('assets/demo.txt');
      expect(result.content).not.toContain('node_modules');
      expect(result.content).not.toContain('.venv');
      expect(result.content).not.toContain('.env');
    }
  });

  it('searches only allowed text files and redacts secret-shaped values', async () => {
    const root = makeRepo();
    const handler = makeRepoSearchHandler({ roots: [root], maxSearchResults: 20 });
    const fakeQuery = ['sk', 'thisShouldBeRedacted'].join('-');
    const fakeSecret = ['sk', 'thisShouldBeRedacted1234567890'].join('-');
    const result = await handler({ query: fakeQuery, max_results: 5 }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('src/app.ts:1');
      expect(result.content).toContain('[REDACTED]');
      expect(result.content).not.toContain(fakeQuery);
      expect(result.content).not.toContain(fakeSecret);
    }
  });

  it('rejects path escapes and blocked generated directories', async () => {
    const root = makeRepo();
    const handler = makeRepoReadFileHandler({ roots: [root] });
    const outside = await handler({ path: '../outside.txt' }, ctx);
    const dist = await handler({ path: 'dist/bundle.js' }, ctx);

    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.error).toMatch(/escapes/);
    expect(dist.ok).toBe(false);
    if (!dist.ok) expect(dist.error).toMatch(/blocked|too large|binary|missing/);
  });

  it('reads bounded line-numbered snippets from allowed files', async () => {
    const root = makeRepo();
    const handler = makeRepoReadFileHandler({ roots: [root], maxReadBytes: 200 });
    const result = await handler({ path: 'src/app.ts', start_line: 2, line_count: 1 }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('File: src/app.ts');
      expect(result.content).toContain('2 | export function run()');
      expect(result.content).not.toContain('1 |');
    }
  });
});
