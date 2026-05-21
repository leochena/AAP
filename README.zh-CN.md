<div align="center">

<img src="assets/aap-hero.svg" alt="AI Adversarial Protocol" width="100%">

# 🥊 AI Adversarial Protocol

**Multiple LLMs answer the same question, audit each other, ground claims in tools, and only keep what survives scrutiny.**

让多个 LLM 围绕同一个问题独立作答 → 互相挑刺 → 调用外部工具求证 → 错的主动认错 → 投票收敛 — 比单模型答案更接近"真"。

[![CI](https://github.com/laochendeai/ai-adversarial-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/laochendeai/ai-adversarial-protocol/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ai-adversarial-protocol.svg)](https://www.npmjs.com/package/ai-adversarial-protocol)
[![npm downloads](https://img.shields.io/npm/dm/ai-adversarial-protocol.svg)](https://www.npmjs.com/package/ai-adversarial-protocol)
[![GitHub release](https://img.shields.io/github/v/release/laochendeai/ai-adversarial-protocol.svg)](https://github.com/laochendeai/ai-adversarial-protocol/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-43853d.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/laochendeai/ai-adversarial-protocol?style=social)](https://github.com/laochendeai/ai-adversarial-protocol/stargazers)

[English](README.md) · **简体中文**

[`npm install -g ai-adversarial-protocol`](https://www.npmjs.com/package/ai-adversarial-protocol) · [快速开始](#-quick-start) · [FAQ](docs/FAQ.zh-CN.md) · [路线图](docs/ROADMAP.zh-CN.md) · [支持](SUPPORT.md) · [贡献](CONTRIBUTING.zh-CN.md)

</div>

---

## 项目定位

**AAP（AI Adversarial Protocol）** 是一个 Node.js CLI + HTTP Server，让你把任意数量、任意服务商的 LLM 编入一个**对抗式协作流水线**：

```
                  ┌──── Phase 1: Generating ────┐
                  │  N 个模型并行独立作答         │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──── Phase 2: Tool Grounding (可选) ─┐
                  │  search / fetch_url / exec_python    │
                  │  错了的模型 concede() 主动退出       │
                  └──────────────┬───────────────────────┘
                                 ▼
                  ┌──── Phase 3: Auto-Challenge ────┐
                  │  每个模型审计其他模型的输出      │
                  │  标注事实错误/逻辑漏洞/遗漏      │
                  └──────────────┬───────────────────┘
                                 ▼
                  ┌──── Phase 4: Voting ────────────┐
                  │  多模式投票（majority/weighted/   │
                  │  consensus/unanimous）           │
                  │  共识不足 → 标"需人工"，不强造结果 │
                  └──────────────────────────────────┘
                                 │
                                 ▼
                  Multi-round（默认 2 轮）：第二轮 prompt
                  含上一轮回答 + 挑刺，让模型修正
```

**为什么要做对抗：** 单 LLM 的 RLHF 偏置会让它对自己不知道的事情自信地编造。多 LLM 投票天然放大同向偏置（训练数据重叠 → 错得一致 → 多数票通过）。引入**外部工具接地** + **主动认错** + **同行 audit** 是把"求真"放在"听起来完整"之上的工程化路径。

## 为什么是 AAP

| 方案 | 常见问题 | AAP 的处理方式 |
|---|---|---|
| 单模型 | 回答很快，但自信幻觉难发现 | 把每个回答都当成需要被挑战的 claim |
| 朴素多模型投票 | 训练数据重叠会导致一起错、一起投 | 要求互相挑刺、证据来源和明确的"需人工审查"状态 |
| 只靠工具的 agent | 工具有帮助，但模型仍可能夸大证据 | 显示真实 tool calls，让同行审计，并允许 `concede()` |
| AAP | 生成、接地、挑战、修正、投票 | 宁可承认不确定，也不制造假 winner |

---

## ✨ Features

### 多模型对抗
- 任意服务商混搭：OpenAI / Anthropic / Ollama 协议都支持，OpenAI 兼容代理（如 SiliconFlow、各种本地多模型网关）也走得通
- **多轮对抗**：默认 2 轮，每轮看到上一轮的回答 + 挑刺，逐步收敛
- **加权投票**：每个模型可设权重；模式可选 majority / weighted / consensus / unanimous

### 求真接地（Tier 3）
- **工具调用** 由模型自主发起：
  - `search` — 通过本地 SearXNG 搜索互联网
  - `fetch_url` — 抓取 URL 验证内容
  - `exec_python` — 沙箱执行（一次性 Docker，`--network none`，stdlib only）
  - `concede` — **主动认错退出**：模型见到证据后承认错误、可选 defer to 同行
- **Capability probe**：自动探测每个模型对 tool-calling 的真实支持，结果缓存 24h；不可靠的模型在工具运行时被自动剔除
- **当前日期注入**：每个 prompt 自动带 system 消息告知"今天是 X 年 X 月 X 日"，避免模型把训练截止时间当成"现在"
- **求真 > 收敛**：投票若不达共识，输出"需人工审查"而非强造 winner

### 可观察性
- **TUI**（基于 ink）实时显示：
  - 每个模型的流式输出 + token 计数
  - 互相挑刺（类型/严重性/置信度/原文片段/理由）
  - 工具调用面板（哪个模型调了什么、ok/失败、结果预览）
  - Concession 高亮区块
  - 投票分布
  - 多轮进度
- **审计评分**：每个模型的累计 reliability score（A+ ~ D），持久化在 `~/.aap/audit-metrics.json`

### 部署灵活
- 单一进程同时跑 TUI + HTTP Server
- HTTP 接口兼容 OpenAI `/v1/chat/completions` 和 Anthropic `/v1/messages`
- 可作为 Claude Code / Cursor / 自研 agent 的"上游"——所有外部请求自动走对抗，TUI 实时可见

---

## 🚀 Quick Start

### 1. 安装

从 npm 安装：

```bash
npm install -g ai-adversarial-protocol
aap --help
```

或从源码安装：

```bash
git clone git@github.com:laochendeai/ai-adversarial-protocol.git
cd ai-adversarial-protocol
npm install
npm run build
npm link               # 全局可用 aap 命令（可选）
```

不 link 的源码运行方式：`npm run dev`。

### 2. 配置模型（**交互式，最简单**）

```bash
aap config add
```

会顺序问你：endpoint base URL → 协议 → API key → 自动调上游 `/v1/models` 列出可用模型 → 多选添加。一次可加多个 endpoint。

也支持脚本式：

```bash
aap config add deepseek-v3 \
  --protocol openai \
  --base-url https://api.example.com/v1 \
  --api-key sk-... \
  --model deepseek-ai/DeepSeek-V3.2
```

或纯发现（不写入）：

```bash
aap config discover --base-url https://api.example.com/v1 --protocol openai --api-key sk-...
```

### 3. （可选）启用工具求真模式

```bash
# 部署本地 SearXNG（搜索后端）
bash scripts/start-searxng.sh

# 探测每个模型的 tool-calling 支持
aap probe

# 看探测结果 + 工具配置
aap tools list

# 编辑 ~/.aap/config.json，把 adversarial.tools.enabled 改 true
```

### 4. 启动

```bash
aap                      # TUI + Server 一起跑
aap --no-tui             # 只 Server（headless 部署）
aap --no-server          # 只 TUI
aap --port 9000          # 改端口
```

---

## 🖥 TUI 操作

| 键 | 动作 |
|---|---|
| `n` | 新建对抗（先选模型，再输入问题） |
| `a` | 添加模型（直接调出发现界面） |
| `↑` / `↓` | 在 run 列表里切换 |
| `q` / `Ctrl+C` | 退出 |

`n` 弹窗里：空格切换模型勾选，Enter 确认 → 输入问题 → Enter 触发。

按 `n` 提交后会先跑 **preflight**（去重 endpoint、ping `/v1/models` 验证模型可用性）。失败时给三选项：drop 失败的、放弃、强制继续。

---

## 🌐 HTTP API

服务默认监听 `http://127.0.0.1:28788`。`model` 字段决定行为：

| `model` 值 | 行为 |
|---|---|
| `adversarial:all` | 调用所有 enabled 模型，并行返回 |
| `adversarial:vote` | 全部模型 + 投票，主响应是获胜方答案 |
| `adversarial:debate` | 全部模型 + 挑刺，主响应是合并的多模型输出 |
| `adversarial:m1,m2,m3` | 指定参与的模型 id |
| `qwen-235b` | 直接透传，不做对抗 |

### OpenAI 兼容

```bash
curl -X POST http://127.0.0.1:28788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "adversarial:vote",
    "messages": [{"role":"user","content":"用一句话解释熵"}]
  }'
```

响应是标准 OpenAI Chat Completion 格式，多了一个 `x_adversarial` 扩展字段（含 responses / challenges / voting / 工具调用日志）。

流式：加 `"stream": true`，按标准 OpenAI SSE 输出，每个模型用 `## modelId` markdown header 分隔；最后一个 chunk 携带 `x_adversarial`，再发 `data: [DONE]`。

### Anthropic 兼容

```bash
curl -X POST http://127.0.0.1:28788/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "adversarial:debate",
    "max_tokens": 1024,
    "messages": [{"role":"user","content":"1+1=?"}]
  }'
```

返回标准 Anthropic Message 格式（`type: "message"`, `content: [{type:"text",...}]`），同样带 `x_adversarial`。流式遵循 Anthropic 的 `message_start` / `content_block_delta` / `message_delta` / `message_stop` 协议。

### 接入 Claude Code

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:28788
export ANTHROPIC_AUTH_TOKEN=any
claude
```

或在 `~/.claude/settings.json` 里写死。Claude Code 的每次请求会被多模型对抗后再返回，TUI 可以同步看到。

---

## 🧰 命令参考

```
aap                              # 默认：TUI + Server
aap --no-tui|--no-server         # 单独模式
aap --port <n> | --host <addr>

aap config init                  # 初始化配置
aap config list                  # 列出所有模型
aap config add [<id>]            # 添加（带 id = 脚本式；不带 id = 交互式）
aap config discover --...        # 探活 endpoint，列出可用模型
aap config remove <id>           # 删除
aap config enable|disable <id>   # 启停
aap config path                  # 打印 config.json 路径

aap probe [ids...] [--all]       # 探测 tool-calling 能力
aap tools list                   # 显示工具配置 + 模型能力状态
```

---

## 📁 持久化

`~/.aap/`：
- `config.json` — 模型 + 服务器配置
- `audit-metrics.json` — 每个模型的累计 reliability score
- `capabilities.json` — tool-calling 能力探测缓存（TTL 24h）

---

## 🏗 架构

```
┌─────────────────── aap 进程 ───────────────────┐
│                                                │
│   TUI (ink)          HTTP Server (Hono)        │
│      ↑                    ↑                    │
│      └────── EngineHub ───┘  ← 全局事件总线     │
│                  ↓                              │
│        AdversarialEngine (per-run)              │
│           ↓        ↓        ↓                  │
│      ToolRegistry  ModelClient  ConcessionTracker
│           ↓             ↓                       │
│      [search, fetch, exec, concede]            │
│                         ↓                       │
│           OpenAI / Anthropic / Ollama          │
└────────────────────────────────────────────────┘
```

详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 🛠 开发

```bash
npm run dev              # tsx src/cli.ts（直接跑源码）
npm run build            # tsup 打包到 dist/cli.js
npm run type-check       # tsc --noEmit
npm test                 # vitest --run
npm run test:watch       # vitest 监视模式
```

构建产物：单一 ~150 KB ESM 文件 + sourcemap，运行时只依赖 `react/ink/ink-*`（external）。

测试规则：见 [TESTING.md](TESTING.md)。
项目协作约定：见 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📦 发布

本包已发布到 npm：[`ai-adversarial-protocol`](https://www.npmjs.com/package/ai-adversarial-protocol)。

安装：

```bash
npm install -g ai-adversarial-protocol
```

发布流程使用 npm Trusted Publishing (OIDC)，不使用 `NPM_TOKEN`。

npm package settings 中需要这样配置：

- Provider: GitHub Actions
- Organization/user: `laochendeai`
- Repository: `ai-adversarial-protocol`
- Workflow filename: `release.yml`
- Environment: 留空
- Publishing access: `Require two-factor authentication and disallow tokens (recommended)`

在 `main` 上提升版本号后，推送 `v*` tag 即可发布：

```bash
git tag v0.1.2
git push origin v0.1.2
```

Release workflow 会依次执行 type-check、tests、build，然后执行 `npm publish --access public`。

---

## 🗺 Roadmap

详见 [docs/ROADMAP.zh-CN.md](docs/ROADMAP.zh-CN.md)，包括当前计划、适合新贡献者的方向和明确的非目标。

---

## 📜 License

[MIT](LICENSE) © 2026

---

<div align="center">

**做这个项目的初衷：让"多模型协作"从直觉式的"听起来更稳妥"变成可验证的"求真工程"。**

If you find this useful, a ⭐ on GitHub helps a lot.

</div>
