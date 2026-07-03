/**
 * fetch_url 工具 — GET 任意 URL，返回 readable 文本
 *
 * 用于验证模型提到的链接是否真的存在以及其大致内容。
 * HTML 用最小化 strip 转纯文本（不引第三方依赖）；返回前 maxBytes 字节。
 */

import { ToolDefinition, ToolHandler } from './types';

export const fetchUrlToolDef: ToolDefinition = {
  name: 'fetch_url',
  description:
    '抓取一个 URL 的内容并返回可读文本。当 search 结果引用了某个链接、或你想验证模型自己回忆出的某个 URL 是否真实存在时使用。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的 URL（http/https）' },
    },
    required: ['url'],
  },
};

function stripHtml(html: string): string {
  // 干掉 script/style 和它们的内容
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // 块级标签换行
  s = s.replace(/<(p|div|br|h[1-6]|li|tr|td|th)[^>]*>/gi, '\n');
  // 删剩余标签
  s = s.replace(/<[^>]+>/g, '');
  // 解码常见实体
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // 规整空白
  return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

export interface FetchUrlOptions {
  maxBytes?: number;     // 默认 4096
  timeoutMs?: number;    // 默认 10s
}

export function makeFetchUrlHandler(opts: FetchUrlOptions = {}): ToolHandler {
  const maxBytes = opts.maxBytes ?? 4096;
  const timeoutMs = opts.timeoutMs ?? 10000;

  return async (rawArgs, ctx) => {
    const args = rawArgs as { url?: string };
    const url = (args?.url ?? '').trim();
    if (!url) return { id: '', ok: false, error: 'url is required' };
    if (!/^https?:\/\//i.test(url)) {
      return { id: '', ok: false, error: 'only http/https URLs are accepted' };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`fetch timeout ${timeoutMs}ms`)), timeoutMs);
    const abortFromParent = () => ctrl.abort(ctx.signal!.reason);
    if (ctx.signal) ctx.signal.addEventListener('abort', abortFromParent, { once: true });

    try {
      const response = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        return { id: '', ok: false, error: `HTTP ${response.status} ${response.statusText}` };
      }
      // 简单二进制保护
      if (!/text|html|json|xml/i.test(contentType)) {
        return { id: '', ok: false, error: `non-text content-type: ${contentType}` };
      }
      const raw = await response.text();
      const text = /html/i.test(contentType) ? stripHtml(raw) : raw;
      const trimmed = text.length > maxBytes ? text.slice(0, maxBytes) + '\n…[truncated]' : text;
      return {
        id: '',
        ok: true,
        content: `URL: ${url}\nContent-Type: ${contentType}\n\n${trimmed}`,
      };
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
