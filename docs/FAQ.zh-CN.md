# FAQ

> [English](FAQ.md) · **简体中文**

## AAP 是 RAG 的替代品吗？

不是。AAP 是一个多模型对抗协作编排层，RAG 是提供检索上下文的方法。二者可以组合：RAG 提供资料，AAP 让多个模型围绕答案进行检查、挑刺和投票。

## 多模型投票能保证真相吗？

不能。只有当投票者拥有相对独立的证据和不同失败模式时，投票才更有价值。因此 AAP 把投票放在工具接地、同行挑刺、主动认错之后。如果证据不足，AAP 会输出需要人工审查，而不是制造假 winner。

## 为什么要做工具接地？

模型可能声称自己"搜索过"或"查证过"，但实际上没有调用任何工具。AAP 会记录真实工具调用，并在 TUI 中显示哪个模型调用了 `search`、`fetch_url`、`exec_python` 或 `concede`。

## 为什么要探测 tool-calling 能力？

很多 OpenAI-compatible 网关会列出模型，但其中一部分并不真正支持 function/tool calling。AAP 会在工具接地运行前探测能力，并缓存 24 小时。不支持工具调用的模型仍然可以用于非工具模式。

## 能用本地模型吗？

可以。AAP 支持 Ollama 和 OpenAI-compatible 本地网关。是否支持工具调用取决于具体网关和模型。用 `aap config discover` 列出模型，用 `aap probe` 测试工具能力。

## 同一个 endpoint 有很多模型，怎么批量添加？

运行：

```bash
aap config add
```

交互式流程会调用 `/v1/models`，列出可用模型，允许多选保存，并在完成后继续添加下一个 endpoint，不需要重启程序。

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
