# 路线图

> [English](ROADMAP.md) · **简体中文**

AAP 仍处于 1.0 之前。当前优先级是正确性、可观察性和协议兼容性，而不是扩大产品表面积。

## 现在

- 稳定工具接地流式输出，确保最终内容和工具调用日志总能正确合并。
- 在 capability cache 中区分"模型不支持 tool-calling"和"上游临时失败"。
- 改进大模型列表、多轮配置和运行复盘相关的 TUI 控制。
- 持续回归测试 OpenAI-compatible 和 Anthropic-compatible API response。

## 下一步

- 在上游行为足够稳定可测后，增加 Anthropic 和 Ollama tool-calling adapter。
- 允许挑刺阶段调用工具，并引用用于反驳的证据。
- 增加 independent judge 模式，减少 self-grading bias。
- 增加收敛检测：当高严重性 challenge 消失时，多轮运行可提前停止。
- 尝试 Bayesian/log-pool 投票，替代简单算术加权。

## 之后

- 立场分配：强制部分模型先 steelman 反方观点，再进入投票。
- 可证伪元数据：重要 claim 需要说明什么证据会推翻它。
- 运行记录导入/导出，方便在 issue 和研究笔记中共享对抗轨迹。
- 基于真实 probe 结果生成 provider compatibility matrix。

## 适合新贡献者

- 改进常见 provider 配置错误的报错文案。
- 为 CLI 参数解析和 config migration 增加聚焦测试。
- 扩展本地网关和 Ollama 文档。
- 增加更多 OpenAI / Anthropic 兼容接口的 `curl` 示例。
- 改进 TUI 空状态和快捷键提示。

## 非目标

- 核心项目暂不计划浏览器 Web UI。核心表面是 CLI + TUI + HTTP server。
- AAP 不会静默抓取互联网。外部访问应该通过配置好的工具完成，并留下可见日志。
- AAP 不声称投票能保证真相。它的目标是暴露不确定性，并降低单模型失败模式。
