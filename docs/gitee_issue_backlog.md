# Gitee Issue Backlog

This backlog mirrors the product and algorithm work discussed for the AAP user-opinion and forecasting roadmap. It is safe to publish: no API keys or provider credentials are included.

Use `scripts/create-gitee-issues.ps1` with a Gitee personal access token to create these as real Gitee issues.

## 1. feat(engine): build evidence graph for user-opinion claims

Labels: `type: feature`, `area: engine`

### 背景

当前 user-opinion MVP 已能把用户意见拆成 claim，并输出采纳/反驳/证据不足和附和风险。但它还不是完整的证据图，用户 claim、模型回答、证据、challenge、verdict 之间缺少统一结构。

### 目标

建立 Evidence-Adversarial Graph，让用户意见作为待验证 claim 入图，而不是作为投票权或事实来源。

### 实现建议

- 新增图结构：nodes = user_claim / model_answer / evidence / challenge / verdict。
- 新增 edges：supports / refutes / qualifies / depends_on。
- 将用户 claim verdict、模型 challenge、工具证据统一映射进图。
- 在 `x_adversarial` 中返回图的精简 JSON。

### 验收标准

- 用户意见不会直接进入投票权重。
- 每个用户 claim 都能追踪到支持/反驳/不确定证据。
- 最终输出能引用图中的证据路径解释采纳或拒绝原因。
- 有单元测试覆盖支持、反驳、部分支持、证据不足四类 claim。

## 2. feat(engine): use anti-sycophancy signals in scoring and voting

Labels: `type: feature`, `area: engine`

### 背景

当前 MVP 会报告 sycophancy signals，但还没有把这些信号纳入模型可靠性、投票权重或最终风险提示。

### 目标

把“无证据附和用户意见”的行为量化为权重惩罚和输出风险。

### 实现建议

- 为每个模型生成 per-run sycophancy score。
- 如果模型在盲审阶段未持有某 claim，看到用户意见后无证据支持该 claim，则降低本轮评审权重。
- 将附和风险写入 audit metrics。
- voting prompt 和 final response 显示哪些模型存在附和风险。

### 验收标准

- 无证据支持用户 claim 的模型不会因附和而提高最终可信度。
- 附和风险能影响本轮 voting aggregation 或至少输出 explicit risk flag。
- 测试覆盖：用户意见正确、错误、部分正确、诱导附和四类场景。

## 3. feat(tools): verify user-provided evidence links during claim review

Labels: `type: feature`, `area: tools`, `area: engine`

### 背景

用户意见支持 evidenceUrls，但当前主要由模型评审文本，并没有强制抓取用户链接来验证链接内容是否真实支持 claim。

### 目标

让用户证据链接进入工具验证链，避免模型仅根据链接标题或用户描述做判断。

### 实现建议

- 对 `userOpinion.evidenceUrls` 调用 `fetch_url`。
- 抽取 title、正文摘要、状态码、抓取错误。
- 将 evidence fetch result 作为 claim review prompt 的输入。
- 如果链接不可访问或内容不支持 claim，明确标记。

### 验收标准

- 每个 evidenceUrl 都有 fetched / failed / skipped 状态。
- claim verdict 能区分“链接存在但不支持 claim”和“链接不可访问”。
- 不把用户描述的证据当成已验证事实。
- 测试覆盖抓取成功、404、内容不相关、无证据链接。

## 4. feat(forecasting): add generic probabilistic forecasting framework

Labels: `type: feature`, `area: engine`

### 背景

世界杯冠军概率、美国总统选举概率等任务不能由 LLM 直接“嘴算”。需要结构化概率模型，LLM 负责拆解、审计和解释。

### 目标

新增通用 ForecastModel 框架，支持 base rate、signals、uncertainty、simulation、calibration。

### 实现建议

- 定义 ForecastQuestion、ForecastCandidate、ForecastSignal、ForecastResult。
- 支持概率排名、置信区间、敏感性分析。
- 支持 Brier Score / Log Loss 历史校准记录。
- LLM 输出只能作为 qualitative signal，不直接替代概率模型。

### 验收标准

- 输出概率总和合理归一化。
- 每个候选项都有 probability、confidence interval、top drivers。
- 有测试证明 LLM textual preference 不能直接覆盖模型概率。

## 5. feat(forecasting): implement World Cup champion probability model

Labels: `type: feature`, `area: engine`

### 背景

目标用例之一是对 2026 年世界杯冠军竞猜输出几率排名。

### 目标

实现可解释的世界杯冠军概率模型，而不是让 LLM 直接预测冠军。

### 实现建议

- 支持 team rating：Elo/Glicko/SPI-like 初版任选其一。
- 纳入近期状态、对手强度、赛程路径、淘汰赛随机性。
- 用 Monte Carlo 模拟生成冠军概率排名。
- 输出敏感性因素：伤病、分组路径、近期比赛、市场赔率校准。

### 验收标准

- 给定固定输入数据时输出稳定概率排名。
- 支持解释每个队概率的主要驱动因素。
- 不允许所有概率由 LLM 直接生成。
- 有 snapshot/golden 测试覆盖模拟结果范围。

## 6. feat(forecasting): implement US presidential election probability model

Labels: `type: feature`, `area: engine`

### 背景

目标用例之一是对 2028 年美国总统候选人输出几率排名。

### 目标

建立候选人提名概率 x 大选胜率的结构化模型。

### 实现建议

- 拆分 nomination_probability 和 general_election_probability。
- 支持 nationwide polls、state polls、fundraising、endorsements、economic fundamentals 等 signal。
- 支持 Electoral College 州级模拟和相关误差。
- 对未宣布、退选、法律/健康风险用 scenario 表达，而不是硬编码结论。

### 验收标准

- 输出每个候选人的提名概率、当选概率和主要不确定性。
- 对民调稀疏或候选人未确定的阶段明确降低置信度。
- LLM 只参与证据解释和假设审计，不直接覆盖概率。

## 7. feat(standards): add standards conflict adjudication engine

Labels: `type: feature`, `area: engine`

### 背景

目标用例之一是多个标准中存在冲突事实论断时，系统能给出适用场景下的正确裁决。

### 目标

建立标准冲突裁决引擎，按版本、生效日期、适用范围、强制性、上位/下位、专门/通用等规则裁决。

### 实现建议

- 定义 StandardDocument、Clause、Applicability、PrecedenceRule。
- 抽取标准元数据：版本、发布日期、生效日期、适用范围、废止/替代关系。
- 判断冲突类型：真冲突、场景不同、术语定义不同、过渡期冲突。
- 最终输出条款级证据链和适用边界。

### 验收标准

- 能说明为什么某标准/条款优先。
- 能区分“事实冲突”和“适用范围不同”。
- 有测试覆盖新旧标准、上位/下位、专门/通用、强制/推荐四类冲突。

## 8. test(eval): build benchmark suite for user-opinion truthfulness and sycophancy

Labels: `type: feature`, `area: engine`

### 背景

要证明系统有创新性，必须有 benchmark，而不是只看单次 demo。

### 目标

建立可重复评测集，验证用户意见参与后是否提升真值判断，同时不诱导模型附和。

### 实现建议

- 数据集场景：用户意见正确、错误、部分正确、证据伪造、多模型一致但都错、用户证据反驳多数票。
- 指标：claim verdict accuracy、sycophancy rate、requiresReview precision、evidence citation coverage。
- 支持离线 mock 模型响应，避免测试依赖外部 API。

### 验收标准

- CI 可跑，不需要真实 API key。
- 输出每类场景的指标汇总。
- 新增用户意见逻辑不能提高 sycophancy rate。

## 9. feat(http-tui): add evidence chain and user-claim adoption matrix UI

Labels: `type: feature`, `area: tui`, `area: http`

### 背景

当前 TUI 只显示简短用户意见评审结果，HTTP 只返回 metadata。用户需要看到每条意见如何被采纳、反驳或判定证据不足。

### 目标

提供用户意见采纳矩阵和证据链视图。

### 实现建议

- TUI 显示 claim x model assessment matrix。
- 显示每条 claim 的证据链接、抓取状态、支持/反驳摘要。
- HTTP final response 增加结构化 adoption report。
- 支持用户继续补充证据的下一轮入口。

### 验收标准

- 用户能快速看到自己的每条意见是否被认真处理。
- 附和风险以醒目但不过度打扰的方式显示。
- 流式和非流式 HTTP 输出一致。

## 10. docs(config): document provider setup for OpenAI-compatible Opus/DeepSeek/Qwen and search tools

Labels: `type: docs`, `area: docs`, `area: tools`

### 背景

第三方模型平台可能同时支持 OpenAI-compatible 和 Anthropic-compatible 协议。用户容易在 TUI discovery 里尝试 Anthropic 自动发现，但当前只有 OpenAI-compatible `/v1/models` discovery。

### 目标

补充模型配置和搜索工具启用文档，避免用户把 API key 发到聊天或错误使用 discovery。

### 实现建议

- 说明 OpenAI-compatible 平台如何配置 baseUrl `/v1`。
- 说明 Anthropic 原生协议需要手动指定 model id。
- 说明搜索工具依赖 SearXNG `searxngUrl`，以及当前 tool-calling 主要走 OpenAI-compatible path。
- 加入密钥轮转和本地配置安全提醒。

### 验收标准

- README/FAQ 中有可复制命令模板，但不包含真实 key。
- 用户能区分 AAP server、SearXNG server、模型 provider endpoint。
- 文档明确“不要把 API key 发到 issue、PR、聊天记录”。
