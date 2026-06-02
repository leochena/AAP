/**
 * Local repository audit tools.
 *
 * The model never receives raw filesystem access. It can only request bounded
 * snippets from explicitly configured repository roots, with common secret and
 * generated-file paths blocked.
 */

import { spawn } from 'node:child_process';
import {
  Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

export interface LocalRepoOptions {
  roots: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxReadBytes?: number;
  maxSearchResults?: number;
  allowCommands?: boolean;
  allowedCommands?: string[];
  commandTimeoutMs?: number;
}

interface NormalizedOptions {
  roots: string[];
  maxFiles: number;
  maxFileBytes: number;
  maxReadBytes: number;
  maxSearchResults: number;
  allowCommands: boolean;
  allowedCommands: string[];
  commandTimeoutMs: number;
}

interface RootSelection {
  root: string;
  label: string;
}

const DEFAULTS = {
  maxFiles: 200,
  maxFileBytes: 256 * 1024,
  maxReadBytes: 16 * 1024,
  maxSearchResults: 40,
  commandTimeoutMs: 30000,
};

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'assets',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.venv',
  'venv',
  'env',
  '.env',
  '.tox',
  '__pypackages__',
  'site-packages',
  '.ipynb_checkpoints',
  'target',
  'bin',
  'obj',
]);

const SENSITIVE_FILE_NAMES = [
  '.env',
  '.env.local',
  '.env.production',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'credentials.json',
  'service-account.json',
];

const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.pfx',
  '.p12',
  '.crt',
  '.cer',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.7z',
  '.gz',
  '.tar',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
  '.jar',
  '.pyc',
  '.wasm',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
]);

export const repoListFilesToolDef: ToolDefinition = {
  name: 'repo_list_files',
  description:
    '列出本地仓库白名单 root 内的文件。只能看到配置允许的仓库；不要声称分析了未列出的文件。',
  parameters: {
    type: 'object',
    properties: {
      root: {
        type: 'string',
        description: '可选。root-1、root-2 或已配置 root 的绝对路径；不填则使用 root-1。',
      },
      pattern: {
        type: 'string',
        description: '可选。简单通配符，如 src/**/*.ts 或 *.md。',
      },
      max_results: {
        type: 'number',
        description: '可选。返回文件数量上限。',
      },
    },
  },
};

export const repoSearchToolDef: ToolDefinition = {
  name: 'repo_search',
  description:
    '在本地仓库白名单 root 内搜索文本，返回文件、行号和片段。用于定位代码证据，不能搜索未配置 root。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要搜索的文本或正则。' },
      root: { type: 'string', description: '可选 root 选择器；不填用 root-1。' },
      pattern: { type: 'string', description: '可选文件通配符，如 src/**/*.ts。' },
      regex: { type: 'boolean', description: 'query 是否按正则处理，默认 false。' },
      case_sensitive: { type: 'boolean', description: '是否大小写敏感，默认 false。' },
      max_results: { type: 'number', description: '可选。返回匹配数量上限。' },
    },
    required: ['query'],
  },
};

export const repoReadFileToolDef: ToolDefinition = {
  name: 'repo_read_file',
  description:
    '读取本地仓库白名单 root 内的单个文本文件片段。必须给出路径；返回有行号的有限片段。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '仓库内相对路径，或配置 root 内的绝对路径。' },
      root: { type: 'string', description: '可选 root 选择器；不填用 root-1。' },
      start_line: { type: 'number', description: '起始行，默认 1。' },
      line_count: { type: 'number', description: '读取行数，默认 120，最大 240。' },
    },
    required: ['path'],
  },
};

export const repoRunCommandToolDef: ToolDefinition = {
  name: 'repo_run_command',
  description:
    '在本地仓库 root 内运行预先允许的验证命令，例如 npm test。只有配置 allowCommands=true 且命令完全匹配 allowlist 时才会执行。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '必须完全匹配配置中的 allowedCommands。' },
      root: { type: 'string', description: '可选 root 选择器；不填用 root-1。' },
    },
    required: ['command'],
  },
};

export function localRepoToolDefs(includeRunCommand = true): ToolDefinition[] {
  return [
    repoListFilesToolDef,
    repoSearchToolDef,
    repoReadFileToolDef,
    ...(includeRunCommand ? [repoRunCommandToolDef] : []),
  ];
}

export function makeRepoListFilesHandler(options: LocalRepoOptions): ToolHandler {
  const opts = normalizeOptions(options);
  return async rawArgs => {
    const args = asRecord(rawArgs);
    const selected = selectRoot(opts, stringArg(args.root));
    if ('error' in selected) return fail(selected.error);
    const pattern = stringArg(args.pattern);
    const maxResults = clampInt(numberArg(args.max_results), 1, opts.maxFiles, opts.maxFiles);
    const matcher = pattern ? wildcardMatcher(pattern) : undefined;
    const files = listFiles(selected.root, opts, matcher).slice(0, maxResults);
    const truncated = files.length >= maxResults ? '\n...[truncated]' : '';
    const lines = files.map(file => {
      const stat = statSync(join(selected.root, file));
      return `- ${toPosix(file)} (${formatBytes(stat.size)})`;
    });
    return ok([
      `Root: ${selected.label}`,
      `Files returned: ${files.length}`,
      ...lines,
      truncated,
    ].filter(Boolean).join('\n'));
  };
}

export function makeRepoSearchHandler(options: LocalRepoOptions): ToolHandler {
  const opts = normalizeOptions(options);
  return async rawArgs => {
    const args = asRecord(rawArgs);
    const query = stringArg(args.query).trim();
    if (!query) return fail('query is required');
    const selected = selectRoot(opts, stringArg(args.root));
    if ('error' in selected) return fail(selected.error);
    const maxResults = clampInt(numberArg(args.max_results), 1, opts.maxSearchResults, opts.maxSearchResults);
    const matcher = stringArg(args.pattern) ? wildcardMatcher(stringArg(args.pattern)) : undefined;
    const queryMatcher = makeQueryMatcher(query, booleanArg(args.regex), booleanArg(args.case_sensitive));
    if ('error' in queryMatcher) return fail(queryMatcher.error);

    const matches: string[] = [];
    for (const relPath of listFiles(selected.root, opts, matcher)) {
      if (matches.length >= maxResults) break;
      const absPath = join(selected.root, relPath);
      if (!safeTextFile(absPath, relPath, opts)) continue;
      const lines = readFileSync(absPath, 'utf-8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!queryMatcher.test(lines[i])) continue;
        matches.push(`${toPosix(relPath)}:${i + 1}: ${redactSecrets(truncateOneLine(lines[i], 220))}`);
        if (matches.length >= maxResults) break;
      }
    }

    return ok([
      `Root: ${selected.label}`,
      `Query: ${redactSecrets(query)}`,
      `Matches returned: ${matches.length}`,
      ...matches,
      matches.length >= maxResults ? '...[truncated]' : '',
    ].filter(Boolean).join('\n'));
  };
}

export function makeRepoReadFileHandler(options: LocalRepoOptions): ToolHandler {
  const opts = normalizeOptions(options);
  return async rawArgs => {
    const args = asRecord(rawArgs);
    const path = stringArg(args.path).trim();
    if (!path) return fail('path is required');
    const selected = selectRoot(opts, stringArg(args.root));
    if ('error' in selected) return fail(selected.error);
    const target = resolveTarget(selected.root, path);
    if ('error' in target) return fail(target.error);
    const relPath = relative(selected.root, target.path);
    if (isIgnoredPath(relPath)) return fail(`path is blocked by local-repo policy: ${toPosix(relPath)}`);
    if (!safeTextFile(target.path, relPath, opts)) {
      return fail(`file is missing, too large, binary, or blocked: ${toPosix(relPath)}`);
    }

    const startLine = clampInt(numberArg(args.start_line), 1, Number.MAX_SAFE_INTEGER, 1);
    const lineCount = clampInt(numberArg(args.line_count), 1, 240, 120);
    const lines = readFileSync(target.path, 'utf-8').split(/\r?\n/);
    const startIndex = Math.min(startLine - 1, lines.length);
    const selectedLines = lines.slice(startIndex, startIndex + lineCount);
    let body = selectedLines
      .map((line, index) => `${String(startIndex + index + 1).padStart(5)} | ${line}`)
      .join('\n');
    body = redactSecrets(body);
    const truncatedByBytes = body.length > opts.maxReadBytes;
    if (truncatedByBytes) {
      body = `${body.slice(0, opts.maxReadBytes)}\n...[truncated by maxReadBytes]`;
    }
    const moreLines = startIndex + selectedLines.length < lines.length;

    return ok([
      `Root: ${selected.label}`,
      `File: ${toPosix(relPath)}`,
      `Lines: ${startIndex + 1}-${startIndex + selectedLines.length} of ${lines.length}`,
      body,
      moreLines ? '...[more lines available]' : '',
    ].filter(Boolean).join('\n'));
  };
}

export function makeRepoRunCommandHandler(options: LocalRepoOptions): ToolHandler {
  const opts = normalizeOptions(options);
  return async rawArgs => {
    if (!opts.allowCommands) return fail('repo_run_command disabled: localRepo.allowCommands=false');
    const args = asRecord(rawArgs);
    const command = stringArg(args.command).trim();
    if (!command) return fail('command is required');
    if (!opts.allowedCommands.includes(command)) {
      return fail(`command is not allowlisted: ${command}`);
    }
    const selected = selectRoot(opts, stringArg(args.root));
    if ('error' in selected) return fail(selected.error);
    const argv = splitCommand(command);
    if (argv.length === 0) return fail('command parse failed');
    const executable = process.platform === 'win32' && ['npm', 'npx', 'pnpm', 'yarn'].includes(argv[0])
      ? `${argv[0]}.cmd`
      : argv[0];

    return await new Promise<ToolResult>(resolveResult => {
      const child = spawn(executable, argv.slice(1), {
        cwd: selected.root,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, opts.commandTimeoutMs);

      child.stdout.on('data', chunk => { stdout = capOutput(stdout + chunk.toString(), opts.maxReadBytes); });
      child.stderr.on('data', chunk => { stderr = capOutput(stderr + chunk.toString(), Math.floor(opts.maxReadBytes / 2)); });
      child.on('error', err => {
        clearTimeout(timer);
        resolveResult(fail(`spawn failed: ${err.message}`));
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (killed) {
          resolveResult(fail(`command killed after timeout ${opts.commandTimeoutMs}ms`));
          return;
        }
        const content = [
          `Root: ${selected.label}`,
          `Command: ${command}`,
          `Exit code: ${code}`,
          stdout ? `--- stdout ---\n${redactSecrets(stdout)}` : '',
          stderr ? `--- stderr ---\n${redactSecrets(stderr)}` : '',
        ].filter(Boolean).join('\n');
        resolveResult(code === 0 ? ok(content) : fail(content));
      });
    });
  };
}

function normalizeOptions(options: LocalRepoOptions): NormalizedOptions {
  return {
    roots: unique(options.roots.map(root => resolve(root))),
    maxFiles: options.maxFiles ?? DEFAULTS.maxFiles,
    maxFileBytes: options.maxFileBytes ?? DEFAULTS.maxFileBytes,
    maxReadBytes: options.maxReadBytes ?? DEFAULTS.maxReadBytes,
    maxSearchResults: options.maxSearchResults ?? DEFAULTS.maxSearchResults,
    allowCommands: options.allowCommands ?? false,
    allowedCommands: options.allowedCommands ?? [],
    commandTimeoutMs: options.commandTimeoutMs ?? DEFAULTS.commandTimeoutMs,
  };
}

function selectRoot(opts: NormalizedOptions, requested: string): RootSelection | { error: string } {
  const roots = opts.roots.filter(root => existsSync(root) && statSync(root).isDirectory());
  if (roots.length === 0) return { error: 'no localRepo.roots configured or roots do not exist' };
  if (!requested.trim()) return { root: roots[0], label: 'root-1' };

  const trimmed = requested.trim();
  const rootMatch = /^root-(\d+)$/i.exec(trimmed);
  const numeric = rootMatch ? Number(rootMatch[1]) : Number(trimmed);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= roots.length) {
    return { root: roots[numeric - 1], label: `root-${numeric}` };
  }

  const resolved = resolve(trimmed);
  const index = roots.findIndex(root => samePath(root, resolved));
  if (index >= 0) return { root: roots[index], label: `root-${index + 1}` };
  return { error: `root is not configured: ${trimmed}` };
}

function resolveTarget(root: string, requestedPath: string): { path: string } | { error: string } {
  const target = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath);
  if (!isInside(root, target)) {
    return { error: `path escapes configured root: ${requestedPath}` };
  }
  if (!existsSync(target)) return { error: `path does not exist: ${requestedPath}` };
  return { path: target };
}

function listFiles(
  root: string,
  opts: NormalizedOptions,
  matcher?: (path: string) => boolean
): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (out.length >= opts.maxFiles) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= opts.maxFiles) break;
      const absPath = join(dir, entry.name);
      const relPath = relative(root, absPath);
      if (isIgnoredPath(relPath)) continue;
      if (entry.isDirectory()) {
        visit(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (matcher && !matcher(toPosix(relPath))) continue;
      out.push(relPath);
    }
  };
  visit(root);
  return out;
}

function safeTextFile(absPath: string, relPath: string, opts: NormalizedOptions): boolean {
  if (!existsSync(absPath)) return false;
  if (isIgnoredPath(relPath)) return false;
  const stat = statSync(absPath);
  if (!stat.isFile() || stat.size > opts.maxFileBytes) return false;
  const ext = extname(absPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext) || SENSITIVE_EXTENSIONS.has(ext)) return false;
  const probe = readFileSync(absPath);
  return !probe.includes(0);
}

function isIgnoredPath(relPath: string): boolean {
  const posix = toPosix(relPath);
  const parts = posix.split('/').filter(Boolean);
  if (parts.some(part => IGNORED_DIRS.has(part))) return true;
  const base = basename(posix).toLowerCase();
  if (SENSITIVE_FILE_NAMES.includes(base)) return true;
  if (/^\.env(\.|$)/i.test(base)) return true;
  if (/secret|credential|private[-_]?key/i.test(base)) return true;
  const ext = extname(base).toLowerCase();
  return SENSITIVE_EXTENSIONS.has(ext);
}

function wildcardMatcher(pattern: string): (path: string) => boolean {
  const normalized = toPosix(pattern.trim());
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return path => regex.test(toPosix(path));
}

function makeQueryMatcher(
  query: string,
  regexMode: boolean,
  caseSensitive: boolean
): { test: (line: string) => boolean } | { error: string } {
  if (!regexMode) {
    const needle = caseSensitive ? query : query.toLowerCase();
    return { test: line => (caseSensitive ? line : line.toLowerCase()).includes(needle) };
  }
  try {
    const regex = new RegExp(query, caseSensitive ? '' : 'i');
    return { test: line => regex.test(line) };
  } catch (err) {
    return { error: `invalid regex: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]')
    .replace(/ghp_[A-Za-z0-9_]{12,}/g, 'ghp_[REDACTED]')
    .replace(/gitee_[A-Za-z0-9_]{12,}/g, 'gitee_[REDACTED]')
    .replace(/AIza[0-9A-Za-z_-]{12,}/g, 'AIza[REDACTED]')
    .replace(
      /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
      '$1=[REDACTED]'
    );
}

function capOutput(value: string, maxBytes: number): string {
  return value.length > maxBytes ? `${value.slice(0, maxBytes)}\n...[truncated]` : value;
}

function truncateOneLine(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 3)}...` : oneLine;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function samePath(a: string, b: string): boolean {
  const left = process.platform === 'win32' ? a.toLowerCase() : a;
  const right = process.platform === 'win32' ? b.toLowerCase() : b;
  return left === right;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function toPosix(value: string): string {
  return value.split(sep).join('/');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanArg(value: unknown): boolean {
  return value === true;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function ok(content: string) {
  return { id: '', ok: true as const, content };
}

function fail(error: string) {
  return { id: '', ok: false as const, error };
}
