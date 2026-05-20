# 贡献指南

> [English](CONTRIBUTING.md) · **简体中文**

感谢考虑贡献代码！这个项目还在快速演化期，代码、设计、测试都欢迎 PR。

## 开发环境

- Node.js **>= 20**（依赖 Node 20+ 的 fetch / streaming API）
- 平台：Linux / macOS / Windows（Windows 上 `exec_python` 工具需要 WSL2 + Docker）
- 推荐编辑器：VS Code（本仓库 TS 严格模式，类型自动提示有用）

```bash
git clone git@github.com:laochendeai/ai-adversarial-protocol.git
cd ai-adversarial-protocol
npm install
npm run dev          # 直接跑源码（tsx）
```

## 提交前检查

```bash
npm run type-check   # tsc --noEmit
npm test             # vitest --run
npm run build        # tsup → dist/cli.js
```

**所有三项必须通过**。CI 会跑同样的检查（详见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。

## 改动哲学

- **Surgical commits**：一个 commit 一件事。需要的辅助 refactor 单独成 commit。
- **测试先行**：bug fix 先有重现测试再有修复；新函数至少 happy path + 一个边界用例。详见 [TESTING.md](TESTING.md)。
- **去抽象**：不要给"未来可能的需求"加抽象。三段相似的代码比一次过早的泛化好。
- **不要静默吞错**：错误要么回到调用方、要么 emit 成事件。不要 `catch {}`。

更多约定见 [AGENTS.md](AGENTS.md)。

## Commit 格式

[Conventional Commits](https://www.conventionalcommits.org/) 强制要求：

```
<type>(<scope>): <short description>

<longer body, why over what>
```

常用 type：
- `feat` — 新特性
- `fix` — bug 修复
- `refactor` — 不改变外部行为的内部重构
- `test` — 加测试
- `docs` — 仅文档
- `chore` — 构建、依赖、配置

例：`feat(tools): add concede tool for honest withdrawal`

## PR 流程

1. 从 `main` 创建分支（`feat/<short-name>` / `fix/<...>` / `chore/<...>`）。
2. 写代码 + 测试，跑完上面的检查。
3. push 之后开 PR，套用 `.github/PULL_REQUEST_TEMPLATE.md` 模板。
4. CI 三项 (Type Check / Tests / GitGuardian) 必须全绿。
5. PR 描述要回答两个问题：
   - **Why**：解决什么问题？什么观察导致的？
   - **What**：改了哪些核心文件，新增/修改/删除？
6. 合并策略默认是 `--merge`（保留 commit 历史 + 一个 merge 节点），这样 surgical commits 在 main 上仍然可见。

## 重大改动

涉及架构、引擎流程、事件契约、HTTP API 形状的改动，先开 issue 讨论再写代码，避免做白工。

## 安全相关

发现安全漏洞 → 看 [SECURITY.md](SECURITY.md)，**不要直接开 public issue**。

## 资源

- [ARCHITECTURE.md](ARCHITECTURE.md) — 模块职责 + 数据流
- [TESTING.md](TESTING.md) — 测试约定
- [AGENTS.md](AGENTS.md) — 行为规则与 governance
- [CHANGELOG.md](CHANGELOG.md) — 版本历史
