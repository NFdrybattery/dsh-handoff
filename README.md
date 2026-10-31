# dsh-handoff

把长会话交给新会话：旧会话模型写一份 `HANDOFF.md`，新会话只读这份文档继续。

包名是 **dsh-handoff**，命令仍是 `/handoff`。

[English](README.en.md)

## 功能

- `/handoff`：在旧会话后台发送交接指令，由当前模型按 0–12 共 13 节写出 `HANDOFF.md`。
- 第 12 节把最近几轮用户输入与助手回复**原样**抄进文档（`用户：` / `回复：`），不总结、不改写；轮数由 `recentRounds` 配置，默认 5。
- 会话 ⋯ 菜单「交接并继续」：等旧模型写完后自动新建会话，新会话只读文档；命令结果默认收起，不发送长 prompt。
- `/handoff resume`：手动注摘要；`/handoff resume --latest --wake` 由命令处理器直接唤醒模型。
- 任务默认 1 天后自动清理；文档在 `<工作区>/.dsh/dsh-handoff/`。

## 安装

需要 DeepSeek Harness `0.2.1-rc.x`，Node.js `^22.19.0 || >=24.0.0`。

在 **设置 → 插件** 里从本地目录安装这个 checkout，选中 `dsh-handoff`，然后重启。CLI 备选：

```powershell
dsh plugin --profile desktop add link:D:\path\to\dsh-handoff
```

CLI 只安装包，仍需在 **设置 → 插件** 里选中 `dsh-handoff`（或写入 profile 的 `dsh.profile.bundles`）再重启。其他 profile 把 `desktop` 换成对应名称。

卸载：**设置 → 插件** 移除 `dsh-handoff`，或：

```powershell
dsh plugin --profile desktop remove dsh-handoff
```

首次使用新默认目录时，会把旧的 `.dsh/handoff/` 自动迁到 `.dsh/dsh-handoff/`；已有文档随目录一起保留。

## 用法

### 生成交接文档

```text
/handoff
/handoff status
/handoff list
```

`/handoff` 只建目录并向当前模型发送带格式要求的指令；文档要等这一轮模型结束才可用。`/handoff update` 是同一动作，`/handoff --new` 新开一条任务线。

文档 0–11 节是交接内容，第 12 节是原样转录的最近几轮对话。第 12 节不做归纳，其余各节才允许总结；每节都必须写实际内容、不允许只写标题，事实必须来自当前会话。

### 一键交接

在会话列表点 **⋯** →「交接并继续」：

1. 旧会话模型开始写 `HANDOFF.md`；
2. 等这一轮结束（最多 4 分钟）；
3. 新会话执行 `/handoff resume --latest --wake`，命令结果收起，模型读取文档并结合项目文件梳理前期工作，给出简要接手总结。

新会话第一轮不执行命令、不改文件；确认后再继续。

### 手动接续

```text
/handoff resume
/handoff resume --latest
/handoff resume --latest --wake
/handoff resume <taskId>
```

- 不带 `--wake`：只注入摘要，需要你再发一条消息；
- 带 `--wake`：注入后直接唤醒模型，一键交接走这条；
- 多条 pending 时用 `--latest` 或显式 `taskId`。

重复接续同一任务会提示「已接手」；加 `--force` 可重新注入。

### 归档

```text
/handoff archive <taskId>
```

文档保留，但不再出现在 resume 候选中。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-handoff
  name: dsh-handoff
  config:
    retentionDays: 1
    language: zh
```

| 配置 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。 |
| `retentionDays` | `1` | 超过这么多天未更新的任务目录自动删除；`0` 关闭。 |
| `recentRounds` | `5` | 写入交接文档的最近对话轮数；`0` 关闭该节。 |
| `resumeBriefMaxChars` | `2400` | 接续摘要最大字符数。 |
| `language` | `zh` | `zh` 或 `en`。 |
| `remindAfterSteps` | `800` | 首次提醒步数。 |
| `remindEverySteps` | `200` | 提醒分档间隔。 |
| `remindAfterTokens` | `120000` | 上下文 token 提醒线；`0` 关闭。 |

### 设置页

安装并启用插件后，**设置 → Handoff** 可以编辑：

- 三个提醒阈值
- 任务保留天数
- 最近对话轮数
- 摘要最大字符数
- 摘要/唤醒语言

保存后的设置走 Host 设置 API；部分设置需要重新加载插件才生效。`enabled` 不放在设置页里，因为关闭插件后这个页面本身也会消失，启停请用插件管理或 profile 配置。

## 文件

```text
<工作区>/.dsh/dsh-handoff/
  index.json              任务索引（元数据）
  <taskId>/HANDOFF.md     唯一内容文件，含 0–12 节
```

每次 `/handoff` 会清理超过 `retentionDays` 的旧任务；旧版本的 `facts.json`、`history/`、`resume-log.jsonl` 也会被删除。任务状态为 `draft` → `pending` → `resumed`，`archived` 为终态。

不想把交接笔记提交进仓库，把 `.dsh/` 加进 `.gitignore`；想随项目交付就保留。

## 限制

- 文档由旧会话模型生成，质量取决于它是否按模板写全；`/handoff status` 显示文档是否已生成。
- 一键交接需要会话已有工作区；空白会话不显示菜单项。
- 文档缺少 frontmatter `task_id` 时，resume 会拒绝载入；重新 `/handoff` 即可。
- `index.json` 仍是任务发现/清理所需的元数据文件，不是交接内容。

## 开发

```powershell
npm test
```

纯 ESM、无构建步骤；测试覆盖存储、清理、索引、摘要、指令格式和 resume 选择。

仓库：<https://github.com/NFdrybattery/dsh-handoff>

## 许可证

MIT，见 [LICENSE](LICENSE)。
