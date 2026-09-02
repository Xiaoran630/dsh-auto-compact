# dsh-auto-compact

DSH 插件：全模式兼容的**自动 / 手动上下文压缩**。

内置的 `@deepseek-ai/dsh-compaction-basic` 依赖 `ctx.tokenMeter` 做压力测量，而 tokenMeter 会调用 `llm.imageRequestPricing`；在 **PTC 模式**（工具通过 `run_code` TypeScript 程序呈现）下这条路径会报错，导致自动压缩和 `/compact` 命令都失效，最终上下文撑满。

本插件绕开 tokenMeter，用纯字符级 token 估算测量压力，并通过一次直接 `ctx.llm.stream()` 调用生成摘要，因此**与工具呈现模式无关，标准 / PTC / both 模式都可用**。

## 功能

- **自动压缩**：在 `agent/pre-step`（轮次之间）检测压力，超过阈值自动摘要并替换较早历史；模型确认 `CONTEXT_WINDOW_EXCEEDED` 时强制压缩并重试。
- **手动压缩**：在模型选择器左侧增加一个明显的「压缩」按钮，点击立即压缩，并显示压缩条数与 token。
- **不依赖 tokenMeter**：自实现字符级 token 估算 + 摘要 + 表面区间替换，避免 PTC 模式下的 `imageRequestPricing` 报错。
- 复用 `dsh-session` 内置的 `compaction/start`、`compaction/summary`、`compaction/end` 事件，因此压缩节点在对话/轨迹 UI 里正常展示。

## 配置

在 dsh-config-editor 的「插件配置」里编辑 `auto-compact`，或在 `cordis.patch.yml` 中配置：

```yaml
auto-compact:
  # 是否启用本插件（总开关）
  enabled: true
  # 触发压缩的上下文压力阈值（0-1），建议 0.6
  thresholdRatio: 0.6
  # 压缩后保留的最近上下文比例（0-1），建议 0.2
  retainRatio: 0.2
  # 是否在对话轮次之间自动判断执行压缩
  autoCompact: true
  # 是否保留提示词前缀（系统指令不会被压缩掉）
  preservePrefix: true
```

字段说明：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关 |
| `thresholdRatio` | number | `0.6` | 压力阈值（占上下文窗口比例），超过即压缩 |
| `retainRatio` | number | `0.2` | 压缩后保留最近上下文的比例，必须小于 thresholdRatio |
| `autoCompact` | boolean | `true` | 是否启用轮次间自动压缩 |
| `preservePrefix` | boolean | `true` | 是否保留提示词前缀（系统提示始终保留，不参与压缩） |

## 安装

```sh
# 1. 链接到 profile
dsh plugin --profile desktop add link:./dsh-auto-compact
# 或手动把依赖写进 profiles/<name>/package.json 后 pnpm install

# 2. 确认 bundles 里包含 dsh-auto-compact
# 3. 重启 profile
```

本插件会同时禁用内置的 `compaction-basic` 和 `command-compact`，由自身全权接管压缩（见 `cordis.patch.yml`）。

## 文件结构

- `index.js` — 宿主插件：配置解析、压力测量、摘要、压缩事务、自动触发、手动 HTTP 端点。
- `client.js` — 客户端插件：`conversation.input.right`（模型选择左侧）里的「压缩」按钮。
- `cordis.patch.yml` — 挂载本插件并禁用内置 compaction-basic / command-compact。
