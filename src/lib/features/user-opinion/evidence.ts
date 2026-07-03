import { EvidenceFetchResult } from '@/lib/types';

export interface EvidenceVerifierOptions {
  maxBytes?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

export async function verifyEvidenceUrls(
  urls: string[],
  opts: EvidenceVerifierOptions = {}
): Promise<EvidenceFetchResult[]> {
  const uniqueUrls = [...new Set(urls.map(u => u.trim()).filter(Boolean))];
  return Promise.all(uniqueUrls.map(url => verifyEvidenceUrl(url, opts)));
}

export async function verifyEvidenceUrl(
  url: string,
  opts: EvidenceVerifierOptions = {}
): Promise<EvidenceFetchResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { url, status: 'skipped', ok: false, error: 'only http/https URLs are accepted' };
  }

  const maxBytes = opts.maxBytes ?? 4096;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const fetcher = opts.fetcher ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`fetch timeout ${timeoutMs}ms`)), timeoutMs);
  const abortFromParent = () => ctrl.abort(opts.signal!.reason);
  if (opts.signal?.aborted) {
    abortFromParent();
  } else if (opts.signal) {
    opts.signal.addEventListener('abort', abortFromParent, { once: true });
  }

  try {
    const response = await fetcher(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      return {
        url,
        status: 'failed',
        ok: false,
        statusCode: response.status,
        contentType,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }
    if (!/text|html|json|xml/i.test(contentType)) {
      return {
        url,
        status: 'failed',
        ok: false,
        statusCode: response.status,
        contentType,
        error: `non-text content-type: ${contentType}`,
      };
    }

    const raw = await response.text();
    const text = /html/i.test(contentType) ? stripHtml(raw) : raw;
    return {
      url,
      status: 'fetched',
      ok: true,
      statusCode: response.status,
      contentType,
      title: extractTitle(raw),
      preview: text.slice(0, maxBytes),
    };
  } catch (err) {
    return {
      url,
      status: 'failed',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', abortFromParent);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(p|div|br|h[1-6]|li|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractTitle(raw: string): string | undefined {
  const match = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
}
