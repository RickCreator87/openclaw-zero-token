# OpenClaw / openclaw-zero-token CLI 架构流程

本文档描述本仓库中 **命令行入口** 到 **子命令执行** 的主路径，便于对照源码（`openclaw.mjs`、`entry.ts`、`cli/`）。与上游 OpenClaw 大架构说明见根目录 `ARCHITECTURE.md`。

## 图表说明

- **实线**：主流程；**虚线**：按需加载（懒注册子命令）或异步分支。
- **退出码**：`0` 成功；`1` 一般错误（校验失败、运行失败）；`2` 根级参数解析错误（如 `--container` / `--profile` 组合非法）；Node 版本过低时 `openclaw.mjs` 直接 `exit(1)`。
- **Zero Token**：`onboard` / `configure` 等流程可触发 `src/zero-token/providers/*` 与 Playwright/CDP，向各厂商 **网页 API** 发起请求；凭证落盘于状态目录下的 `auth.json` 等（勿提交版本库）。

```mermaid
flowchart TD
  subgraph Entry["入口"]
    A["openclaw.mjs<br/>校验 Node >= 22.12"] --> B{"dist/entry.(m)js 存在?"}
    B -->|否| E1["报错: missing dist/entry<br/>exit 1"]
    B -->|是| C["entry.js: normalize argv<br/>可选 respawn 子进程"]
  end

  C --> D{"容器模式<br/>--container?"}
  D -->|解析失败| X2["stderr 提示<br/>exit 2"]
  D -->|是| DC["Podman/Docker 内<br/>再执行 CLI"]
  D -->|否| P{"--profile / --dev?"}
  P -->|解析失败| X2
  P -->|是| PE["写入 profile 隔离<br/>STATE/CONFIG 环境变量"]
  P -->|否| V{"仅 --version / -V / -v ?"}
  V -->|是| VF["输出版本 + 可选 commit<br/>exit 0"]
  V -->|否| H{"仅 --help / -h ?"}
  H -->|是| HF["outputRootHelp<br/>exit 0"]
  H -->|否| R["runCli: Commander 程序"]

  subgraph Run["runCli / Commander"]
    R --> PL["插件发现与注册<br/>（extensions / plugins.allow）"]
    PL --> REG["registerProgramCommands<br/>核心命令占位 + 懒加载"]
    REG --> DISPATCH{"匹配子命令"}
  end

  DISPATCH -->|onboard / configure / setup| WZ["向导 + 配置写入<br/>openclaw.json / auth"]
  DISPATCH -->|gateway / daemon| GW["网关进程 / RPC<br/>WebSocket + HTTP"]
  DISPATCH -->|agent / tui| AG["经 Gateway 或 TUI<br/>调用模型与工具"]
  DISPATCH -->|models / channels / ...| SUB["各 cli/* 模块<br/>读配置 / 调服务"]
  DISPATCH -->|doctor| DOC["健康检查与修复建议<br/>可 exit 0 但含告警"]
  DISPATCH -->|未知或参数错误| ERR["Commander 错误信息<br/>通常 exit 1"]

  WZ --> BROWSER["Playwright / Chrome CDP<br/>（Zero Token 网页登录）"]
  WZ --> FS1["文件 I/O: 配置与 auth 存储"]
  GW --> NET["本机端口 / 对外 HTTP"]
  AG --> NET
  AG --> API["Provider: 网页 API 或<br/>OpenAI 兼容 / 本地 Ollama 等"]
  SUB --> FS2["读写配置与状态目录"]
  SUB --> NET

  style E1 fill:#f99
  style X2 fill:#f99
  style ERR fill:#f99
  style VF fill:#9f9
  style HF fill:#9f9
```

## 与源码的对应关系

| 阶段                      | 主要文件                                                               |
| ------------------------- | ---------------------------------------------------------------------- |
| 引导包装                  | `openclaw.mjs`                                                         |
| 进程入口、版本/帮助快路径 | `entry.ts`                                                             |
| CLI 主循环                | `cli/run-main.ts` → `cli/program/*`                                    |
| 核心子命令注册            | `cli/program/command-registry.ts`                                      |
| 扩展子命令                | `cli/program/register.subclis.ts`、`cli/program/subcli-descriptors.ts` |
| Zero Token 网页侧         | `src/zero-token/providers/`、`src/zero-token/streams/`                 |
