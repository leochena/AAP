/**
 * aap CLI 入口
 *
 * 默认行为：同时启动 TUI + HTTP Server
 * 子命令：
 *   aap                — 启动 TUI + Server（默认）
 *   aap --no-tui       — 仅 server（headless）
 *   aap --no-server    — 仅 TUI
 *   aap config <op>    — 配置管理
 */

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import packageJson from '../package.json';
import { loadConfig, saveConfig, addModel, removeModel, updateModel, DEFAULT_STORAGE_DIR } from '@/config/loader';
import { ModelConfig, ModelProtocol } from '@/lib/types';
import { EngineHub } from '@/engine/EngineHub';
import { startServer } from '@/server/index';
import { App } from '@/tui/App';
import { listOpenAIModels, listOllamaModels } from '@/lib/clients/discovery';
import { probeToolCalling } from '@/engine/capability-probe';
import { setCapability, loadCapabilityCache } from '@/engine/capability-cache';

const program = new Command();
program
  .name('aap')
  .description('AI Adversarial Protocol — multi-model adversarial CLI/server')
  .version(packageJson.version);

program
  .option('--no-tui', '不启动交互式 TUI')
  .option('--no-server', '不启动 HTTP server')
  .option('-p, --port <port>', 'HTTP server 端口', v => parseInt(v, 10))
  .option('-h, --host <host>', 'HTTP server 监听地址')
  .action(async opts => {
    await runDefault(opts);
  });

// ===== config 子命令 =====
const configCmd = program.command('config').description('管理 ~/.aap/config.json');

configCmd
  .command('list')
  .description('列出所有模型配置')
  .action(() => {
    const cfg = loadConfig();
    if (cfg.models.length === 0) {
      console.log('(无模型配置，使用 aap config add 添加)');
      return;
    }
    console.log(`存储目录: ${cfg.storageDir}`);
    console.log(`服务器: ${cfg.server.host}:${cfg.server.port}`);
    console.log(`模型 (${cfg.models.length}):`);
    for (const m of cfg.models) {
      const flag = m.enabled ? '✓' : '✗';
      console.log(
        `  ${flag} ${m.id.padEnd(20)} ${m.protocol.padEnd(10)} ${m.model.padEnd(30)} ${m.baseUrl}`
      );
    }
  });

configCmd
  .command('add [id]')
  .description('添加模型配置（不传 id 进入交互模式）')
  .option('--protocol <protocol>', 'openai | anthropic | ollama')
  .option('--base-url <url>', 'API base URL')
  .option('--api-key <key>', 'API key (ollama 可省略)')
  .option('--model <model>', '上游模型名')
  .option('--weight <number>', '投票权重 (默认 1.0)', v => parseFloat(v))
  .option('--disabled', '添加但不启用')
  .action(async (id: string | undefined, opts) => {
    const hasFlags = opts.protocol || opts.baseUrl || opts.model;
    if (!id && !hasFlags) {
      await interactiveAdd();
      return;
    }
    if (!id) {
      console.error('错误：使用 flag 模式时必须提供 <id>');
      process.exit(1);
    }
    if (!opts.protocol || !opts.baseUrl || !opts.model) {
      console.error('错误：flag 模式需要 --protocol、--base-url、--model');
      process.exit(1);
    }
    const protocol = opts.protocol as ModelProtocol;
    if (!['openai', 'anthropic', 'ollama'].includes(protocol)) {
      console.error(`Invalid protocol: ${protocol}`);
      process.exit(1);
    }
    const cfg = loadConfig();
    const model: ModelConfig = {
      id,
      protocol,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey ?? '',
      model: opts.model,
      weight: opts.weight ?? 1.0,
      enabled: !opts.disabled,
    };
    try {
      const next = addModel(cfg, model);
      saveConfig(next);
      console.log(`✓ 已添加模型: ${id}`);
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

configCmd
  .command('discover')
  .description('从 endpoint 拉取可用模型列表（仅打印，不写入配置）')
  .requiredOption('--protocol <protocol>', 'openai | ollama')
  .requiredOption('--base-url <url>', 'API base URL')
  .option('--api-key <key>', 'API key（openai 协议必填）')
  .action(async opts => {
    const protocol = opts.protocol as ModelProtocol;
    try {
      let ids: string[];
      if (protocol === 'openai') {
        if (!opts.apiKey) {
          console.error('--api-key required for openai protocol');
          process.exit(1);
        }
        const list = await listOpenAIModels({
          baseUrl: opts.baseUrl,
          apiKey: opts.apiKey,
          timeoutMs: 10000,
        });
        ids = list.map(m => m.id);
      } else if (protocol === 'ollama') {
        const list = await listOllamaModels({ baseUrl: opts.baseUrl, timeoutMs: 10000 });
        ids = list.map(m => m.id);
      } else {
        console.error(`协议 ${protocol} 不支持发现（Anthropic 没有公开 list 接口）`);
        process.exit(1);
      }
      for (const id of ids) console.log(id);
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

configCmd
  .command('remove <id>')
  .description('删除模型配置')
  .action((id: string) => {
    const cfg = loadConfig();
    if (!cfg.models.some(m => m.id === id)) {
      console.error(`Model ${id} not found`);
      process.exit(1);
    }
    saveConfig(removeModel(cfg, id));
    console.log(`✓ 已删除: ${id}`);
  });

configCmd
  .command('enable <id>')
  .description('启用模型')
  .action((id: string) => {
    const cfg = loadConfig();
    saveConfig(updateModel(cfg, id, { enabled: true }));
    console.log(`✓ 已启用: ${id}`);
  });

configCmd
  .command('disable <id>')
  .description('禁用模型')
  .action((id: string) => {
    const cfg = loadConfig();
    saveConfig(updateModel(cfg, id, { enabled: false }));
    console.log(`✓ 已禁用: ${id}`);
  });

configCmd
  .command('path')
  .description('显示配置文件路径')
  .action(() => {
    console.log(`${DEFAULT_STORAGE_DIR}/config.json`);
  });

configCmd
  .command('init')
  .description('初始化配置文件（如果不存在）')
  .action(() => {
    const cfg = loadConfig();
    saveConfig(cfg);
    console.log(`✓ 配置已初始化: ${cfg.storageDir}/config.json`);
  });

// ===== probe / tools 命令（求真模式） =====

program
  .command('probe [ids...]')
  .description('探测每个模型对 tool-calling 的支持（结果缓存到 ~/.aap/capabilities.json）')
  .option('--all', '探测所有 enabled 模型，忽略 ids 参数')
  .action(async (ids: string[], opts: { all?: boolean }) => {
    const cfg = loadConfig();
    const targets = opts.all || ids.length === 0
      ? cfg.models.filter(m => m.enabled)
      : cfg.models.filter(m => ids.includes(m.id));
    if (targets.length === 0) {
      console.error('没有匹配的模型');
      process.exit(1);
    }
    console.log(`将探测 ${targets.length} 个模型的 tool-calling 能力，请稍候…\n`);
    let supported = 0;
    let unsupported = 0;
    for (const m of targets) {
      process.stdout.write(`  ${m.id.padEnd(40)} ... `);
      const result = await probeToolCalling(m);
      setCapability(cfg.storageDir, m.id, result);
      if (result.supported) {
        supported++;
        console.log(`[32m✓ supported[0m  (${result.latencyMs}ms)`);
      } else {
        unsupported++;
        console.log(`[31m✗ no[0m  ${result.reason}`);
      }
    }
    console.log(`\n汇总：${supported} 支持 · ${unsupported} 不支持 · 缓存 ${cfg.adversarial.tools.capabilityCacheHours}h`);
  });

const toolsCmd = program.command('tools').description('查看工具运行时状态');

toolsCmd
  .command('list')
  .description('显示当前 tools 配置 + 各模型 tool-calling 状态')
  .action(() => {
    const cfg = loadConfig();
    const t = cfg.adversarial.tools;
    console.log(`tools.enabled: ${t.enabled ? '[32mtrue[0m' : '[33mfalse[0m'}`);
    console.log(`  searxng:    ${t.searxngUrl}  (engines: ${t.searchEngines})`);
    console.log(`  fetch_url:  ${t.fetchUrl.enabled ? 'on' : 'off'}  (max ${t.fetchUrl.maxBytes}B)`);
    console.log(`  exec_python: ${t.codeExec.enabled ? 'on' : 'off'}  (${t.codeExec.image}, ${t.codeExec.timeoutMs}ms${t.codeExec.wslDistro ? ', wsl='+t.codeExec.wslDistro : ''})`);
    console.log(`  concede:    ${t.concede.enabled ? 'on' : 'off'}`);
    console.log(`  max calls per generation: ${t.maxToolCallsPerGeneration}`);
    console.log();

    const cache = loadCapabilityCache(cfg.storageDir);
    console.log(`模型 tool-calling 状态：`);
    for (const m of cfg.models) {
      const cached = cache.models[m.id];
      let status: string;
      if (m.toolCallingSupport === 'yes') status = '[32m✓ forced-yes[0m';
      else if (m.toolCallingSupport === 'no') status = '[31m✗ forced-no[0m';
      else if (!cached) status = '[90m? not-probed[0m';
      else if (cached.supported) status = '[32m✓ supported[0m';
      else status = `[31m✗ no[0m (${cached.reason.slice(0, 60)})`;
      console.log(`  ${m.id.padEnd(40)} ${status}`);
    }
  });

program.parseAsync().catch(err => {
  console.error(err);
  process.exit(1);
});

async function runDefault(opts: { tui?: boolean; server?: boolean; port?: number; host?: string }) {
  const config = loadConfig();
  if (opts.port) config.server.port = opts.port;
  if (opts.host) config.server.host = opts.host;

  const enableTui = opts.tui !== false;
  const enableServer = opts.server !== false;

  if (!enableTui && !enableServer) {
    console.error('--no-tui 和 --no-server 不能同时指定');
    process.exit(1);
  }

  if (config.models.filter(m => m.enabled).length === 0) {
    console.error('⚠ 没有启用的模型，请先运行: aap config add <id> ...');
    if (!enableTui) {
      // headless 模式直接退出
      process.exit(1);
    }
  }

  const hub = new EngineHub(config);

  let serverUrl: string | undefined;
  let serverHandle: ReturnType<typeof startServer> | undefined;
  if (enableServer) {
    serverHandle = startServer({ hub, port: config.server.port, host: config.server.host });
    serverUrl = serverHandle.url;
    if (!enableTui) {
      console.log(`AAP server listening at ${serverUrl}`);
      console.log('  GET  /v1/models');
      console.log('  POST /v1/chat/completions');
      console.log('  POST /v1/messages');
      console.log('Press Ctrl+C to stop.');
    }
  }

  if (enableTui) {
    const { waitUntilExit } = render(
      React.createElement(App, { hub, serverUrl }),
      { exitOnCtrlC: true }
    );
    await waitUntilExit();
    if (serverHandle) {
      await serverHandle.close();
    }
    process.exit(0);
  } else {
    // headless：保持进程
    process.on('SIGINT', async () => {
      if (serverHandle) await serverHandle.close();
      process.exit(0);
    });
  }
}

// ===== 交互式 config add =====

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function parseSelection(input: string, max: number): number[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === 'all' || trimmed === '*') {
    return Array.from({ length: max }, (_, i) => i);
  }
  const indices = new Set<number>();
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      if (i >= 1 && i <= max) indices.add(i - 1);
    }
  }
  return [...indices].sort((a, b) => a - b);
}

async function interactiveAdd(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    let round = 1;
    while (true) {
      console.log(`\n=== 添加模型（第 ${round} 个 endpoint） ===`);
      await interactiveAddOnce(rl);
      const more = (await rl.question('\n继续添加其他 endpoint? [y/N]: ')).trim().toLowerCase();
      if (more !== 'y' && more !== 'yes') break;
      round++;
    }
  } finally {
    rl.close();
  }
}

async function interactiveAddOnce(
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const baseUrl = (await rl.question('Endpoint Base URL (例: http://192.168.0.122:20128/v1): ')).trim();
  if (!baseUrl) {
    console.error('Base URL 不能为空，跳过本轮');
    return;
  }

  const protoRaw = (await rl.question('协议 [openai/anthropic/ollama] (默认 openai): ')).trim() || 'openai';
  if (!['openai', 'anthropic', 'ollama'].includes(protoRaw)) {
    console.error(`无效协议: ${protoRaw}，跳过本轮`);
    return;
  }
  const protocol = protoRaw as ModelProtocol;

  let apiKey = '';
  if (protocol !== 'ollama') {
    apiKey = (await rl.question('API Key: ')).trim();
    if (!apiKey && protocol === 'openai') {
      console.error('OpenAI 协议需要 API Key，跳过本轮');
      return;
    }
  }

  if (protocol === 'anthropic') {
    const upstream = (await rl.question('上游模型名 (如 claude-3-5-sonnet-20241022): ')).trim();
    if (!upstream) {
      console.error('模型名不能为空，跳过本轮');
      return;
    }
    const cfg = loadConfig();
    const taken = new Set(cfg.models.map(m => m.id));
    const aliasInput = (await rl.question(`别名 (默认 ${sanitizeId(upstream)}): `)).trim();
    const id = uniqueId(aliasInput || sanitizeId(upstream), taken);
    const m: ModelConfig = {
      id, protocol, baseUrl, apiKey, model: upstream, weight: 1, enabled: true,
    };
    saveConfig(addModel(cfg, m));
    console.log(`✓ 已添加: ${id}`);
    return;
  }

  console.log(`\n正在从 ${baseUrl} 拉取模型列表…`);
  let ids: string[];
  try {
    if (protocol === 'openai') {
      const list = await listOpenAIModels({ baseUrl, apiKey, timeoutMs: 15000 });
      ids = list.map(m => m.id);
    } else {
      const list = await listOllamaModels({ baseUrl, timeoutMs: 15000 });
      ids = list.map(m => m.id);
    }
  } catch (err) {
    console.error(`✗ 发现失败: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (ids.length === 0) {
    console.error('endpoint 返回的模型列表为空');
    return;
  }

  console.log(`\n发现 ${ids.length} 个模型：`);
  ids.forEach((id, i) => console.log(`  ${(i + 1).toString().padStart(3, ' ')}. ${id}`));

  const sel = await rl.question(
    '\n选择要添加的编号 (逗号/空格/区间 1-3 / "all"，回车跳过): '
  );
  const indices = parseSelection(sel, ids.length);
  if (indices.length === 0) {
    console.log('未选择任何模型。');
    return;
  }

  const cfg = loadConfig();
  const taken = new Set(cfg.models.map(m => m.id));
  const newModels: ModelConfig[] = indices.map(i => {
    const upstream = ids[i];
    const id = uniqueId(sanitizeId(upstream), taken);
    taken.add(id);
    return {
      id,
      protocol,
      baseUrl,
      apiKey,
      model: upstream,
      weight: 1,
      enabled: true,
    };
  });

  let next = cfg;
  for (const m of newModels) next = addModel(next, m);
  saveConfig(next);

  console.log(`\n✓ 已添加 ${newModels.length} 个模型：`);
  for (const m of newModels) {
    console.log(`  ${m.id.padEnd(30)}  → ${m.model}`);
  }
}
