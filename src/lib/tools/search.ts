/**
 * Web 搜索工具 — 透传到本地 SearXNG (默认 :28080)
 *
 * 默认调用 Bing 引擎（中国内地能用），用户可在配置里覆盖。
 * 模型看到的是 top-N {title, snippet, url}，每条限长以避免 prompt 爆炸。
 */

import { ToolDefinition, ToolHandler } from './types';

export const searchToolDef: ToolDefinition = {
  name: 'search',
  description:
    '通过 SearXNG 搜索互联网。当回答中涉及最近事件、具体数字、未确证的事实、引用、人物、产品名、版本号等不能从训练数据中可靠获得的内容时，必须先调用此工具。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词。简洁、关键词式，不要写完整句子。',
      },
      num_results: {
        type: 'integer',
        description: '返回结果数量，默认 5，最大 10',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
  },
};

export interface SearchOptions {
  baseUrl: string;            // 例：http://127.0.0.1:28080
  engines?: string;           // 默认 bing
  timeoutMs?: number;
}

interface RawResult {
  title?: string;
  url?: string;
  content?: string;
}

export function makeSearchHandler(opts: SearchOptions): ToolHandler {
  const { baseUrl, engines = 'bing', timeoutMs = 12000 } = opts;
  const root = baseUrl.replace(/\/+$/, '');

  return async (rawArgs, ctx) => {
    const args = rawArgs as { query?: string; num_results?: number };
    const query = (args?.query ?? '').trim();
    if (!query) return { id: '', ok: false, error: 'query is required' };

    const num = Math.min(10, Math.max(1, args.num_results ?? 5));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`search timeout ${timeoutMs}ms`)), timeoutMs);
    const abortFromParent = () => ctrl.abort(ctx.signal!.reason);
    if (ctx.signal) ctx.signal.addEventListener('abort', abortFromParent, { once: true });

    const url = `${root}/search?q=${encodeURIComponent(query)}&format=json&engines=${encodeURIComponent(engines)}`;

    try {
      const response = await fetch(url, { method: 'GET', signal: ctrl.signal });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          id: '',
          ok: false,
          error: `SearXNG HTTP ${response.status} — ${body.slice(0, 200)}`,
        };
      }
      const data = (await response.json()) as { results?: RawResult[]; unresponsive_engines?: unknown[] };
      const results = (data.results ?? [])
        .slice(0, num)
        .map((r, i) => {
          const t = (r.title ?? '').slice(0, 200);
          const c = (r.content ?? '').slice(0, 400);
          return `[${i + 1}] ${t}\n  ${r.url ?? ''}\n  ${c}`;
        })
        .join('\n\n');

      const note =
        results.length === 0
          ? `No results for "${query}". Engines tried: ${engines}.`
          : results;
      return { id: '', ok: true, content: note };
    } catch (err) {
      return {
        id: '',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
      if (ctx.signal) ctx.signal.removeEventListener('abort', abortFromParent);
    }
  };
}
