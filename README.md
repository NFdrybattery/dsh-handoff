# dsh-handoff

长会话越跑越慢、改动越来越不准。**dsh-handoff** 把当前会话沉淀成一份工作区内的交接文档，并让新会话在第一条消息里就拿到准确摘要和文件地图，直接接着干，而不是从上千步的旧对话里重新摸索。

[English](README.en.md)

## 功能

- `/handoff` 折叠真实会话事实（步数、改过的文件、shell 命令、失败、todo、goal），**立即**写出完整的 12 节 `HANDOFF.md`（机械版，不等待模型）。
- 需要模型叙事时执行 `/handoff --narrative`；`facts.json` 里的机械事实始终是权威，不允许臆造。
- 会话三点菜单里有「交接并继续」：一键交接、自动在本工作区新建会话、载入摘要并直接开始回复，不需要再输入。
- 新会话执行 `/handoff resume`，会把不超过 2400 字的接续摘要注入到下一条消息：做到哪了、完整文档在哪、第一件事是什么。
- 默认 800 步时在消息边界插入一条不打断的提醒；之后每 200 步一档、上下文压力单独一档，各提醒一次。
- 全程本地：文档在 `<工作区>/.dsh/handoff/<taskId>/`，不联网、不起子代理或旁路 LLM 调用、不自动开新会话。

## 安装

需要 DeepSeek Harness `0.2.1-rc.x`（`engines.dsh` 为 `>=0.2.1-rc.1 <0.3.0-0`），Node.js `^22.19.0 || >=24.0.0`。

### 本地目录安装（推荐）

打开 **设置 → 插件**，从本地目录安装 bundle，指向这个 checkout。插件管理会自动安装包并把 `dsh-handoff` 选进 profile；然后重启 DeepSeek Harness。

CLI 备选方案——只安装包，**不会**自动选中 bundle：

```powershell
dsh plugin --profile desktop add link:D:\path\to\dsh-handoff
```

如果 `dsh` 不在 `PATH` 里，就用 `<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd`。CLI 安装后，还需要在 **设置 → 插件** 里把 `dsh-handoff` 选为 bundle（或把它加进 profile `package.json` 的 `dsh.profile.bundles`），再重启。

### 从 npm 安装（发布后）

```powershell
dsh plugin --profile desktop add dsh-handoff
```

然后在 **设置 → 插件** 里选中 `dsh-handoff`，重启。

### 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-handoff
  name: dsh-handoff
  config:
    remindAfterSteps: 800
    remindEverySteps: 200
    remindAfterTokens: 120000
    handoffDir: .dsh/handoff
    language: zh
```

| 配置 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。 |
| `handoffDir` | `.dsh/handoff` | 工作区相对目录，必须留在工作区内。 |
| `remindAfterSteps` | `800` | 首次提醒步数。 |
| `remindEverySteps` | `200` | 提醒分档间隔。 |
| `remindAfterTokens` | `120000` | 上下文 token 提醒线；`0` 关闭。 |
| `maxUserMessages` | `40` | facts 保留的最近用户消息数。 |
| `maxAssistantMessages` | `12` | facts 保留的最近助手消息数。 |
| `maxCommandLog` | `40` | facts 保留的最近 shell 命令数。 |
| `maxErrors` | `30` | facts 保留的最近失败工具调用数。 |
| `keepHistory` | `10` | 每个任务保留的 `HANDOFF.md` 历史版本数。 |
| `resumeBriefMaxChars` | `2400` | 接续摘要最大字符数。 |
| `language` | `zh` | 文档语言：`zh` 或 `en`。 |

如果用的不是 `desktop` profile，把命令里的 `desktop` 换成你的 profile 名。

## 用法

### 在长会话里生成交接

```text
/handoff
```

命令会写出 `<工作区>/.dsh/handoff/<taskId>/{HANDOFF.md,facts.json}`，并把文档直接置为可接续的 `pending`。默认是**机械版**：所有章节由事实预填，不等待模型，约 0.1 秒完成。需要当前模型补齐叙事时再加 `--narrative`（会多一轮模型生成，明显更慢）。命令结果里会给出文档路径和步数。查看状态：

```text
/handoff status
/handoff list
```

`/handoff update` 是同一动作的显式写法；`/handoff --new` 会在本会话已有任务线时另开一条。

文档共 12 节：60 秒摘要、目标与验收、当前状态、已完成、待办与下一步、关键决策、文件地图、坑与失败、验证方式、环境依赖、未决问题、相关会话。没内容的章节会明确写「无」，不会让模型凭记忆编造；`facts.json` 由插件生成。

### 一键交接（会话三点菜单）

在左侧会话列表里点某个会话的 **⋯**，选 **「交接并继续」**：

1. 立即生成该会话的机械版交接；
2. 在同一工作区创建新会话；
3. 注入交接摘要并自动发出第一条消息，让新会话直接开始工作。

按钮只放在三点菜单里，不占用会话标题栏，也不在会话行上增加图标。整个过程不需要再输入；新会话会自动给出回复。

在同一个工作区新开会话，执行：

```text
/handoff resume
```

只有一条 `pending` 任务时直接使用；多条时会列出并要求带 `taskId`：

```text
/handoff resume 20261029-1710-keep-history
```

摘要通过 `agent.inject` 放入下一条消息，不唤醒驱动，所以**执行后不会自动出现回复**：再发一条消息（内容随意），模型就会带着摘要开始。任务标记为 `resumed` 并写入 `resume-log.jsonl`；同一会话重复执行会提示「已接手」，加 `--force` 可再次注入。

### 模型工具

| 工具 | 作用 |
| --- | --- |
| `handoff_write` | 用模型的叙事渲染完整 `HANDOFF.md`，校验文件地图，更新索引。 |
| `handoff_read` | 按需读取全文、某一节或机器事实，避免把旧对话整段塞回上下文。 |

两个工具都只写 `<工作区>/.dsh/handoff/`，并明确要求不写入密钥。

### 归档

```text
/handoff archive <taskId>
```

归档后文档仍在磁盘上，但不再出现在 resume 候选里。

### 卸载

在 **设置 → 插件** 里移除 `dsh-handoff`，或者：

```powershell
dsh plugin --profile desktop remove dsh-handoff
```

如果 profile 的 `dsh.profile.bundles` 里还留着 `dsh-handoff`，一并删掉，然后重启。`<工作区>/.dsh/handoff/` 下的文档会保留；不想留就自己删除。

## 落盘结构

```text
<工作区>/.dsh/handoff/
  index.json                    工作区级索引（带锁）
  <taskId>/
    HANDOFF.md                  人读主文档（YAML frontmatter + 12 节）
    facts.json                  机器事实（插件生成）
    history/<stamp>.md          覆盖前的历史版本（keepHistory）
    resume-log.jsonl            谁在何时接手的记录
```

任务 id 为 `<YYYYMMDD-HHmm>[-ascii-slug]`；同一会话复用当前任务 id，除非传 `--new`。接手过某任务的会话再执行 `/handoff`，更新的就是那条被接手的任务线，不会另起一份文档。状态流转：`draft` → `pending` → `resumed`，终态 `archived`。

不想把交接笔记提交进仓库，就把 `.dsh/` 加进 `.gitignore`；想随项目交付就保留。插件不会自动改你的 `.gitignore`。

## 工作原理

1. **Host-only 会话投影** `handoffFacts` 折叠已提交的会话事件：轮次、步数、用户/助手文本、工具调用、write/edit 路径、shell 命令、失败、workspace 变更轮次；状态有上限，可 checkpoint。
2. `/handoff` 读取该投影以及宿主自带的 `sessionStats`、`contextPressure`、`todos`、`goal`、`plan`、`title` 投影，写 `facts.json`，渲染带机械预填的骨架。
3. 模型调用 `handoff_write`；工具校验必填叙事、检查文件地图（不存在标 `[缺失]`、越界标 `[路径越界]`，不直接失败），渲染最终 markdown，把任务置为 `pending`。
4. `/handoff resume` 用索引行、`facts.json` 和已保存的叙事生成摘要，通过 `agent.inject` 注入且不唤醒驱动；用户的下一条消息会带着它进入首个模型 step。
5. 提醒在 `agent/pre-step` 或 `tools/post-execute` 边界，通过原生的插件 `notice` 通道投递，不打断工具调用。

## 性能

- `/handoff` 机械版：文档渲染约 0.05ms，命令整体约 0.1s（实测 handler 53ms、`handoff_write` 47ms）。
- 旧流程一次约 99s，其中插件逻辑不到 1s，其余是模型读取约 13KB 文档/事实并生成约 10KB 交接文档的时间；现在默认不再触发这一轮。
- `/handoff --narrative` 仍会多一轮模型生成，慢是预期行为，按需使用。

## 安全与边界

- 写入原子化（临时文件 + fsync + rename）；`index.json` 更新用 `O_EXCL` 文件锁串行化，30 秒陈旧锁自动恢复。
- `handoffDir` 必须是工作区内相对路径；符号链接路径组件拒绝；`..` 逃逸拒绝；文件地图里越界的路径只标记、不读取。
- shell 命令、错误摘要和接续摘要经过密钥脱敏（`sk-*`、`Bearer *`、`*_KEY=*`、私钥块）。
- 不自动开新会话、不自动发消息、不改写会话日志、不替代 `/compact`。
- 卸载插件后所有文档仍在磁盘上。

## 已知限制

- 一键交接的机械版不包含模型推理；需要模型叙事时用 `/handoff --narrative`，或在新会话里让模型补齐。
- 一键交接要求当前会话已有所属工作区；空白会话不会显示该菜单项。
- 文件地图来自 `write`/`edit`/`str_replace_editor` 工具调用，不是 `git diff`；shell 命令造成的改动只能从命令日志里看到。接续摘要会要求新会话先核对工作区。
- 一键交接生成的是机械版，不包含模型推理；需要模型叙事时用 `/handoff --narrative`，或让新会话补齐。
- 一键交接要求会话属于某个工作区；空白会话不会显示该菜单项。

## 开发

纯 ESM JavaScript，无构建步骤，除 Harness 自带包外无运行时依赖。

```powershell
npm test
```

测试覆盖纯 fold、渲染、存储/锁/历史、索引损坏恢复、路径安全和脱敏。

本地安装工作副本：

```powershell
dsh plugin --profile desktop add link:$PWD
```

## 发布到 GitHub / npm

远程仓库：<https://github.com/NFdrybattery/dsh-handoff>（`origin` 已配置）。

```powershell
git push -u origin main
npm publish
```

`npm pack --dry-run` 会列出实际发布的文件（`lib/`、`cordis.patch.yml`、locale、icon、README、LICENSE、SECURITY、CHANGELOG）。GitHub Actions 会在 Node 22.19 和 24 上跑单元测试。

## 为什么叫 handoff 而不是 handover？

在 agent / workflow 工具语境里，"handoff" 是「把任务和上下文交给另一个执行者」的通用说法，而且更短。仓库名、包名、命令、工具名、投影 key、数据目录、locale 全部统一用 `handoff`：`dsh-handoff`、`/handoff`、`handoff_write`、`.dsh/handoff`，只需要记一种拼写。以后改名会牵动命令名、工具名和落盘目录，所以把命名决定记录在这里。

## 许可证

MIT，见 [LICENSE](LICENSE)。
