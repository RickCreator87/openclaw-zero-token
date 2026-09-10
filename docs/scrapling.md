# Scrapling MCP 集成

本项目集成了 [Scrapling](https://github.com/D4Vinci/Scrapling)，为 OpenClaw 提供强大的网页抓取能力，包括 Cloudflare 绕过和自适应解析。

## 为什么需要 Scrapling？

OpenClaw 本身已有 `web_fetch` 和 `web_search` 工具，但在以下场景中存在局限：

| 场景            | 现有工具局限 | Scrapling 优势          |
| --------------- | ------------ | ----------------------- |
| Cloudflare 保护 | 无法绕过     | 自动解决 Turnstile 挑战 |
| 网站结构变化    | 选择器失效   | 自适应元素追踪          |
| 需要 JS 渲染    | 支持有限     | 完整浏览器自动化        |
| 高防护网站      | 易被拦截     | 浏览器指纹伪装          |

## 功能特性

- **反检测能力**: 自动绕过 Cloudflare Turnstile 等反爬虫机制
- **自适应解析**: 元素指纹追踪，网站改版自动修复选择器
- **多种抓取模式**:
  - `get`: 基本 HTTP 请求（适用于低/中防护网站）
  - `fetch`: Playwright 浏览器抓取（需要 JS 渲染）
  - `stealthy_fetch`: 隐式浏览器抓取（适用于高防护网站）

## 应用场景

1. **数据采集**: 批量抓取商品信息、新闻文章、社交媒体内容
2. **竞品监控**: 定期监控竞争对手网站价格、动态
3. **内容聚合**: 从多个来源聚合内容到知识库
4. **自动化测试**: 验证网页功能和内容展示
5. **绕过防护**: 访问 Cloudflare 保护的内部系统或公开页面

## 对比示例

### 之前 (web_fetch)

```
用户: "获取 x.com 这条推文的内容"
结果: 无法访问，需要登录或被拦截
```

### 之后 (scrapling)

```
用户: "用 scrapling 获取 x.com/sitinme/status/2032315717224169723"
结果: ✅ 成功获取完整推文内容，包括文字、互动数据
```

## 快速开始

### 自动安装

```bash
# 在项目目录运行
./scripts/setup-scrapling.sh
```

### 手动安装

> Scrapling 是一个 Python 包，通过 `pip3 install` 自动从 [PyPI](https://pypi.org/project/scrapling/) 下载安装，无需手动克隆 GitHub 仓库。

1. **安装 Python 依赖**:

   ```bash
   pip3 install scrapling mcp curl_cffi browserforge msgspec patchright markdownify
   ```

   此命令会自动从 PyPI 下载并安装 Scrapling 及所有依赖。

2. **安装 acpx 依赖**:

   ```bash
   cd extensions/acpx
   pnpm install
   cd ../..
   ```

3. **配置 OpenClaw**:

   在 `~/.openclaw/openclaw.json` 中添加：

   ```json
   {
     "plugins": {
       "entries": {
         "acpx": {
           "enabled": true,
           "config": {
             "mcpServers": {
               "scrapling": {
                 "command": "scrapling",
                 "args": ["mcp"]
               }
             }
           }
         }
       }
     },
     "browser": {
       "profiles": {
         "chrome": {
           "color": "007AFF"
         }
       }
     }
   }
   ```

4. **重启 Gateway**:

   ```bash
   pnpm openclaw gateway run --bind loopback --port 18789 --force
   ```

## 使用方法

在 OpenClaw 中通过自然语言调用：

```plaintext
"使用 scrapling 获取 https://example.com 的内容"
"用 scrapling 绕过 Cloudflare 抓取 https://x.com/..."
"用 scrapling 提取页面中的所有链接"
```

## 可用工具

| 工具                  | 功能                  | 适用场景                |
| --------------------- | --------------------- | ----------------------- |
| `get`                 | HTTP 请求 + 内容提取  | 低/中防护网站           |
| `bulk_get`            | 批量 HTTP 请求        | 批量抓取                |
| `fetch`               | Playwright 浏览器抓取 | 需要 JS 渲染            |
| `bulk_fetch`          | 批量浏览器抓取        | 批量 JS 页面            |
| `stealthy_fetch`      | 隐式浏览器抓取        | 高防护网站 (Cloudflare) |
| `bulk_stealthy_fetch` | 批量隐式抓取          | 批量高防护网站          |

## 高级选项

### HTTP 模式

如果需要通过 HTTP 访问 MCP Server（而非 stdio），修改配置：

```json
"scrapling": {
  "command": "scrapling",
  "args": ["mcp", "--http", "--port", "8765"]
}
```

### 代理配置

在工具调用时指定代理：

```python
result = await session.call_tool("stealthy_fetch", {
    "url": "https://example.com",
    "proxy": "http://username:password@localhost:8030"
})
```

## 相关链接

- [Scrapling GitHub](https://github.com/D4Vinci/Scrapling)
- [Scrapling 文档](https://scrapling.readthedocs.io/)
- [Scrapling PyPI](https://pypi.org/project/scrapling/)
