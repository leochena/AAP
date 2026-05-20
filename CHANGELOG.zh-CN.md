# 变更日志

> [English](CHANGELOG.md) · **简体中文**

本文件记录项目的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [未发布]

### 计划中
- Anthropic / Ollama tool-calling 协议适配
- 挑刺阶段也允许调用工具，让 challenger 给出证据
- 独立 judge 模型，避免参与模型自评偏差
- 多轮对抗的收敛检测
- voting 阶段引入 Bayesian aggregation / log-pooling

---

## [0.1.0] — 2026-05-02

第一个功能完整版本：多模型对抗协议 + 工具接地求真。

### 新增

#### Tier 3 — 工具接地求真
- **工具运行时** (`src/lib/tools/`)：类型化 registry + dispatcher，支持生成过程中调用工具。
  - `search` — SearXNG 搜索后端。
  - `fetch_url` — URL 抓取，HTML 转文本并限制输出长度。
  - `exec_python` — 沙箱 Python 执行（`docker --network none`，仅标准库）。
  - `concede` — 引擎拦截的主动认错退出机制；模型可以承认错误并退出本轮，也可以 `defer_to` 另一个模型。
- **OpenAI tool-calling 适配器** (`src/lib/clients/openai-tool-loop.ts`)：流式解析 + 工具分派循环，直到 `finish_reason=stop` 或达到最大迭代次数。
- **能力探测 + 缓存** (`src/engine/capability-probe.ts`, `capability-cache.ts`)：检测每个模型是否可靠支持 tool-calling，缓存到 `~/.aap/capabilities.json`。
- **认错感知投票**：已退出模型不再作为候选，认错原因会作为 honor signal 进入投票 prompt。
- **当前日期 system message**：每次 prompt 注入当前日期，避免模型把训练截止时间当作现实时间。
- CLI：`aap probe [ids...] [--all]`、`aap tools list`。
- TUI：`ToolCallView` 面板，按模型分组展示工具调用、成功/失败、结果预览和认错退出。
- 部署脚本：`scripts/start-searxng.sh`（WSL2 Docker，SearXNG 监听 `:28080`）。

#### Tier 1+2 — 模型发现、预检、多轮对抗
- **模型自动发现**：
  - `aap config discover --base-url --protocol [--api-key]` — 非交互列出上游模型。
  - `aap config add`（不带参数）— 交互流程：URL → 协议 → key → 多选 → 保存，并支持连续添加多个 endpoint。
- **运行前预检** (`src/engine/preflight.ts`)：按 endpoint 去重，调用 list-models 验证每个模型是否存在且 endpoint 可达。TUI 集成 `PreflightWarning`，支持 drop / abort / continue。
- **多轮对抗循环**：`AdversarialConfig.maxRounds` 默认 2；第 n>1 轮会把上一轮回答 + 挑刺注入上下文，投票仅基于最后一轮。
- **EngineHub**：`addModelsAndSave` / `reloadConfig` / `config-change` 事件，TUI 新增模型无需重启即可看到。
- **TUI 改进**：
  - `DiscoverModal` 支持 PgUp/PgDn，超过 20 个模型也能稳定选择。
  - 添加成功页可继续添加其他 endpoint。
  - `useHub` 对 chunk 事件做 50ms 批处理，降低流式输出抖动。
  - `ModelPanel` 根据终端高度只展示尾部 N 行，避免撑爆屏幕。

#### 基础能力（继承自 0.0.1）
- 三阶段对抗引擎：生成 → 互相挑刺 → 投票。
- 多协议客户端：OpenAI / Anthropic / Ollama。
- HTTP 服务兼容 OpenAI `/v1/chat/completions` 和 Anthropic `/v1/messages`。
- 基于 ink 的 TUI，实时展示多模型进度。
- 审计指标持久化到 `~/.aap/audit-metrics.json`。

### 修复
- CI：`npm run test -- --run` 会展开为 `vitest --run --run`，Vitest 2.1+ 会拒绝。现改为直接 `npm test`。

### 测试
- 10 个文件、69 个 Vitest 单元/集成测试。
- 使用真实 OpenAI-compatible 多模型代理做过端到端 smoke。

---

## [0.0.1] — 2026-04（CLI/TUI 初版重写）

从 Next.js Web UI 迁移为 Node.js CLI + TUI + HTTP server（PR #11）。
迁移记录见 `docs/history/phase-2/`。
