# 安全策略

> [English](SECURITY.md) · **简体中文**

## Supported Versions

只有 main 分支接收安全更新。Pre-1.0 阶段不维护多版本回溯。

| Version | Supported |
| ------- | --------- |
| `main` (HEAD) | ✅ |
| Older tags / forks | ❌ |

## Reporting a Vulnerability

**请不要在 public issue 里披露安全问题。**

私下报告渠道（任选其一）：

1. **GitHub Security Advisory**（推荐）
   访问 https://github.com/laochendeai/ai-adversarial-protocol/security/advisories/new 。GitHub 会私下发给维护者，可以协作修复 + 协调披露。

2. **GitHub 私信**
   联系 [@laochendeai](https://github.com/laochendeai)。

报告里包含：
- 问题描述 + 严重程度判断
- 复现步骤（最好附最小复现代码 / 命令）
- 环境信息（Node 版本、OS、AAP 版本 / commit）
- 你认为合理的修复方向（可选）

## Response

| 时间 | 动作 |
| ---- | ---- |
| 48 小时内 | 收到确认 |
| 7 天内 | 给出严重性评估 + 计划 |
| 30 天内（一般） | 修复发布；高危情况下会更快 |

## 关注重点

这个项目**主动**关注以下风险面，欢迎针对性测试：

- **Tool sandbox 越权**：`exec_python` 应该完全网络隔离 + 文件系统隔离；如果发现可逃逸或访问宿主网络，请立刻报告。
- **Prompt 注入 → 工具滥用**：恶意问题导致模型调用 `exec_python` 执行恶意代码（即使在沙箱里）造成资源耗尽，或调用 `fetch_url` 探测内网。
- **凭证泄漏**：API key、配置文件路径、HTTP 错误回显里的敏感字段。
- **HTTP API 输入验证**：`/v1/chat/completions` 解析 `model` 字段时的注入 / DoS。

## 致谢

负责任披露的报告者会被记入 CHANGELOG 的 Security 段落（如愿意公开）。
