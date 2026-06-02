# FAQ

> [English](FAQ.md) · **简体中文**

## AAP 是 RAG 的替代品吗？

不是。AAP 是一个多模型对抗协作编排层，RAG 是提供检索上下文的方法。二者可以组合：RAG 提供资料，AAP 让多个模型围绕答案进行检查、挑刺和投票。

## 多模型投票能保证真相吗？

不能。只有当投票者拥有相对独立的证据和不同失败模式时，投票才更有价值。因此 AAP 把投票放在工具接地、同行挑刺、主动认错之后。如果证据不足，AAP 会输出需要人工审查，而不是制造假 winner。

## 为什么要做工具接地？

模型可能声称自己"搜索过"或"查证过"，但实际上没有调用任何工具。AAP 会记录真实工具调用，并在 TUI 中显示哪个模型调用了 `search`、`fetch_url`、`exec_python` 或 `concede`。

## AAP 能安全审计我的本地代码吗？

可以，但只能通过可选的 local-repo 工具。在 TUI 里按 `[r]` 可以交互式添加源码路径；用 CLI 则运行 `aap tools repo add <path>` 和 `aap tools enable`。`npm run dev` 启动的 TUI 会显示 `tools` 和 `local-repo` 是否就绪。这些工具只读且有边界：列文件、搜索文本、读取有限文件片段，并可选运行 allowlist 中完全匹配的验证命令。它会硬排除 `.git`、`dist`、`assets`、`node_modules`、Python 环境、缓存、生成产物和常见密钥文件。如果模型没有通过这些工具给出文件、行号或测试输出证据就报告代码缺陷，应视为证据不足。

## 源码审计的最终详细结论在哪里看？

TUI 顶部摘要故意只放短结论。run 完成后，它会显示 `完整报告` 路径，文件在 `~/.aap/runs/<runId>.md`。这个 Markdown 报告包含完整最终结论、证据链、结构化黑板、全部挑刺、用户 claim 裁决、工具调用摘要和每个模型最终回答。HTTP 响应里同一个位置会放在 `x_adversarial.reportPath`。

## 用户意见能参与对抗吗？

可以。HTTP API 支持 `user_opinion`、`user_evidence`、`x_adversarial.user_opinion`。TUI 里先启动盲答 run，再在选中的 run 上按 `u` 追加用户意见/证据链接。AAP 会把文本拆成 claim，在 `fetch_url` 启用时抓取证据链接，让模型在盲审第一轮之后逐条评审，最终输出采纳 / 反驳 / 部分采纳 / 证据不足。用户意见不会直接获得投票权。

## 怎么避免模型附和用户？

第一轮模型回答是盲审，不看用户意见。如果模型后续在没有证据的情况下支持非偏好类用户 claim，AAP 会记录反附和信号，并给该模型本轮投票权重惩罚。输出还包含采纳矩阵和证据图，用来追踪每条 claim 为什么被采纳、反驳或保持不确定。

## 结构化黑板是什么？

AAP 会把每一轮生成结果转换成结构化 claim、证据引用、共识簇、controller 事件和修正指令。模型互相挑刺也会回写进黑板，所以下一轮修正拿到的是 challenge-derived revision directives，而不只是自由文本辩论记录。低独立证据共识、少数派保护、身份漂移、每轮摘要和注册挑刺都会显示在 TUI、HTTP 输出和 `x_adversarial.structuredDeliberation` 里。

## AAP 会固定第 2 轮结束吗？

不会。AAP 现在使用自适应轮次控制：至少运行 `adversarial.roundControl.minRounds`，之后只有在配置的继续信号消失时才停止，或达到 `adversarial.maxRounds` 安全上限。`maxRounds` 是成本和延迟上限，不是真相保证；如果达到上限仍有未解决挑刺，最终协议契约会标记需人工复核。

## AAP 怎么随着大模型进化而进化？

AAP 不写死供应商排名。每次运行会把轻量模型画像事件写入 `~/.aap/model-profiles.json`：盲答完成度、工具使用、证据审查、挑刺行为、身份漂移和反附和信号。后续投票会读取这些画像，并按真实表现动态调权。等现实结果后来被证实时，用 `aap calibration add` 回填；它会写入 `calibration-memory.json`，同时把校准事件反馈到模型画像。单纯“说得很自信”不会被当成正确。

## 为什么要探测 tool-calling 能力？

很多 OpenAI-compatible 网关会列出模型，但其中一部分并不真正支持 function/tool calling。AAP 会在工具接地运行前探测能力，并缓存 24 小时。在工具接地对抗 run 里，不支持工具调用的模型会在辩论前被剔除，因为它不能使用 AAP 的搜索证据路径。

## 能用本地模型吗？

可以。AAP 支持 Ollama 和 OpenAI-compatible 本地网关。是否支持工具调用取决于具体网关和模型。用 `aap config discover` 列出模型，用 `aap probe` 测试工具能力。

## 同一个 endpoint 有很多模型，怎么批量添加？

运行：

```bash
aap config add
```

交互式流程会调用 `/v1/models`，列出可用模型，允许多选保存，并在完成后继续添加下一个 endpoint，不需要重启程序。

## 第三方 Opus、DeepSeek、Qwen 平台怎么配置？

如果平台是 OpenAI-compatible，用 `--protocol openai`，base URL 通常以 `/v1` 结尾：

```bash
aap config add my-model --protocol openai --base-url https://provider.example/v1 --api-key sk-... --model provider/model-id
```

Anthropic 原生协议没有公开 model-list 接口，需要显式填写 `--model`。搜索功能依赖单独的 SearXNG 地址 `adversarial.tools.searxngUrl`；AAP server、SearXNG、模型 provider 是三类不同地址。不要把真实 API key 发到 issue、PR、日志或聊天记录。

## 为什么没有 Web UI？

这个项目定位就是 Node.js CLI + Ink TUI + Hono HTTP server。没有 Next.js、Tailwind、浏览器 React UI 或 `src/app`。AAP 更适合在终端里运行，并作为 Claude Code、Cursor 或自研 agent 的本地兼容上游。

## `concede()` 是什么意思？

`concede()` 是主动认错退出工具。如果模型发现证据证明自己的答案错了，它可以退出竞争，说明原因，并可选 defer 给另一个模型。这是求真机制的一部分：承认错误是好结果，不是失败。

## 为什么默认端口是 `28788`？

早期版本使用 `8788`，在部分 Windows 机器上会落入系统排除端口范围，导致 `EACCES`。现在默认端口是 `28788`。如果本地 `~/.aap/config.json` 仍然写了旧端口，它会覆盖源码默认值。

## 可以只跑服务端吗？

可以：

```bash
aap --no-tui
```

HTTP server 仍然提供 OpenAI-compatible 和 Anthropic-compatible 接口。

## npm 包免费吗？

是。`ai-adversarial-protocol` 是公开发布的 MIT-licensed npm package。
