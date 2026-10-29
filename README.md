# dsh-handoff

长会话越跑越慢、改动越来越不准。**dsh-handoff** 把当前会话沉淀成一份工作区内的交接文档，并让新会话在第一条消息里就拿到准确摘要和文件地图，直接接着干，而不是从上千步的旧对话里重新摸索。

[English](README.en.md)

## 功能

- `/handoff` 在旧会话后台发送一条交接指令，由当前模型按固定 0–12 共 13 节格式写出 `HANDOFF.md`；第 12 节是给新会话的接手回复格式。不再由插件拼机械版，也不生成 `facts.json`。
- 交接内容全部在 `HANDOFF.md`：frontmatter 记录任务/来源/规模，正文包含摘要、状态、决策、文件地图、失败、验证和未决问题。
- 会话三点菜单里有「交接并继续」：等旧会话模型写完文档后自动新建会话，新会话只读取这份文档，并生成 6 个列表项的接手说明（不直接执行长任务）。
- 新会话执行 `/handoff resume`，会把不超过 2400 字的接续摘要注入到下一条消息：做到哪了、完整文档在哪、第一件事是什么。
- 默认 800 步时在消息边界插入一条不打断的提醒；之后每 200 步一档、上下文压力单独一档，各提醒一次。
- 全程本地：文档在 `<工作区>/.dsh/handoff/<taskId>/`，不联网、不起子代理或旁路 LLM 调用；只有你点一键交接时才会新建会话。

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
    retentionDays: 1
    language: zh
```

| 配置 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。 |
| `handoffDir` | `.dsh/handoff` | 工作区相对目录，必须留在工作区内。 |
| `remindAfterSteps` | `800` | 首次提醒步数。 |
| `remindEverySteps` | `200` | 提醒分档间隔。 |
| `remindAfterTokens` | `120000` | 上下文 token 提醒线；`0` 关闭。 |
| `maxUserMessages` | `40` | 生成任务元数据时保留的最近用户消息数。 |
| `maxAssistantMessages` | `12` | 生成任务元数据时保留的最近助手消息数。 |
| `maxCommandLog` | `40` | 生成任务元数据时保留的最近 shell 命令数。 |
| `maxErrors` | `30` | 生成任务元数据时保留的最近失败工具调用数。 |
| `retentionDays` | `1` | 任务最后一次更新超过这么多天就删除整个任务目录；`0` 关闭自动清理。 |
| `resumeBriefMaxChars` | `2400` | 接续摘要最大字符数。 |
| `language` | `zh` | 文档语言：`zh` 或 `en`。 |

如果用的不是 `desktop` profile，把命令里的 `desktop` 换成你的 profile 名。

## 用法

### 在长会话里生成交接

```text
/handoff
```

命令只做两件事：在 `<工作区>/.dsh/handoff/<taskId>/` 建好目录，并向当前会话模型发送一条带格式要求的交接指令。模型用 `write` 写出 `HANDOFF.md`；命令本身立即返回，文档需要等这一轮模型结束才可用。等文档写完后再执行 `/handoff resume`，或直接点一键交接。查看状态：

```text
/handoff status
/handoff list
```

`/handoff update` 是同一动作的显式写法；`/handoff --new` 会在本会话已有任务线时另开一条。

文档共 13 节（0–11 是交接内容，第 12 节是接手回复格式）：60 秒摘要、目标与验收、当前状态、已完成、待办与下一步、关键决策、文件地图、坑与失败、验证方式、环境依赖、未决问题、相关会话、接手回复格式。指令对每一节都给了内容要求，例如：第 3 节每条必须写「做了什么 → 产物路径 → 怎么验证 → 结果」，第 6 节必须是路径/作用/状态表格，第 8 节必须给出可直接执行的命令和期望结果，第 12 节必须保留六个标签的列表格式；不允许只写标题或空话。事实必须来自当前会话，不写密钥。`HANDOFF.md` 是唯一的内容文件。

### 一键交接（会话三点菜单）

在左侧会话列表里点某个会话的 **⋯**，选 **「交接并继续」**：

1. 向旧会话发送交接指令，模型开始写 `HANDOFF.md`；
2. 等这一轮模型结束（Toast 显示进度，最多等 4 分钟）；
3. 在同一工作区创建新会话，执行 `/handoff resume --latest --wake`：命令结果是一个默认收起的卡片，模型读取 `HANDOFF.md`（含第 12 节）后给出 6 个列表项的接手说明。

新会话不会立刻改文件或跑长命令；你确认它的计划后再让它继续。第 3 步用的是 `/handoff resume --latest --wake`：命令结果默认收起，模型由命令处理器直接唤醒，不再发送一大段用户 prompt；工作区里有多条历史 `pending` 任务时也会准确接上刚才这份。万一唤醒失败，会回退到一条很短的 prompt，并用红色 Toast 说明。

注入的摘要采用短字段格式（ID / 来源 / 规模 / 状态 / 文档 / 第一件事 / 接下来 / 规则），不再是长段落。新会话的自动 prompt 要求固定 6 个 Markdown 列表项（每项一行，避免聊天界面把单换行合并成一段）：

```text
- 【接手】taskId + 标题 + 接手的工作（一句话）
- 【状态】已完成/进行中/阻塞；分支/commit/工作树；最近测试基线；文档缺口（1-2 句）
- 【下一步】1) 动作 + 文件/命令 + 完成标准 2) … 3) …（最多 3 项）
- 【关键文件】`第 6 节路径 1`、`第 6 节路径 2`（最多 2 个）
- 【验证】`第 8 节命令` → 期望结果
- 【待确认】需要用户决定的问题；没有写“无”
```

文档缺失或不完整时，必须在【状态】说明并在【待确认】提问；这一轮不执行命令、不改文件。

按钮只放在三点菜单里，不占用会话标题栏，也不在会话行上增加图标。整个过程不需要再输入；新会话会自动给出回复。

在同一个工作区新开会话，执行：

```text
/handoff resume
```

只有一条 `pending` 任务时直接使用；多条时会列出并要求带 `taskId`，或者用 `--latest` 直接接续更新时间最新的一条（一键交接走的就是这条）：

```text
/handoff resume --latest
/handoff resume 20261029-1710-keep-history
```

摘要通过 `agent.inject` 放入下一条消息，不唤醒驱动，所以**执行后不会自动出现回复**：再发一条消息（内容随意），模型就会带着摘要开始。任务标记为 `resumed` 并记在 `index.json`；同一会话重复执行会提示「已接手」，加 `--force` 可再次注入。

### 模型工具

当前版本不再注册 `handoff_write` / `handoff_read`：旧会话直接用 `write` 写 `HANDOFF.md`，新会话直接用 `read` 读它，减少中间格式和额外文件。

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
  index.json                    工作区级索引（元数据，带锁）
  <taskId>/
    HANDOFF.md                  唯一内容文件（YAML frontmatter + 0–12 共 13 节）
```

旧版本的 `facts.json`、`history/`、`resume-log.jsonl` 会在下一次 `/handoff` 命令时自动删除；内容已经不再依赖它们。

任务 id 为 `<YYYYMMDD-HHmm>[-ascii-slug]`；同一会话复用当前任务 id，除非传 `--new`。接手过某任务的会话再执行 `/handoff`，更新的就是那条被接手的任务线，不会另起一份文档。状态流转：`draft` → `pending` → `resumed`，终态 `archived`。

不想把交接笔记提交进仓库，就把 `.dsh/` 加进 `.gitignore`；想随项目交付就保留。插件不会自动改你的 `.gitignore`。

**自动清理**：每次执行 `/handoff` 命令时，会先删除最后一次更新超过 `retentionDays`（默认 1 天）的任务目录，并同步从 `index.json` 移除；按 `updatedAt` 计算，删除后不可恢复。设为 `0` 关闭清理。

**载入校验**：`/handoff resume` 只核对 `HANDOFF.md` frontmatter 的 `task_id` 与索引任务 id；不一致、文档不存在或仍是 `draft` 就拒绝注入。`--latest` 使用 `index.latestTaskId`，精确指向刚发送指令的那条任务，而不是靠时间猜测。

## 工作原理

1. `/handoff` 读取会话投影只用于任务元数据（标题、步数、轮数），然后在任务目录里向当前模型 `followup` 一条带 0–12 共 13 节格式要求的交接指令。
2. 当前模型用 `write` 直接写 `HANDOFF.md`；插件不拼机械版、不生成 `facts.json`，也不要求调用专用工具。
3. 一键交接在旧会话这一轮模型结束后再创建新会话；新会话只读 `HANDOFF.md`，从 frontmatter 和正文生成摘要，不默认读取旧会话。
4. `/handoff resume` 通过 `agent.inject` 注入摘要且不唤醒驱动；用户的下一条消息会带着它进入首个模型 step。
5. 提醒在 `agent/pre-step` 或 `tools/post-execute` 边界，通过原生的插件 `notice` 通道投递，不打断工具调用。

## 性能

- 插件本身只发指令和写索引，耗时在毫秒级；主要时间花在旧会话模型生成 `HANDOFF.md` 上，通常几十秒到一两分钟。
- 一键交接会等旧会话这一轮模型结束再开新会话，避免新会话读到缺失或半写文档；这段时间 Toast 会显示“模型正在写交接文档”。
- 新会话只读取一份 `HANDOFF.md`，然后生成 **6 个列表项的接手说明**，不会自动执行长任务。

## 安全与边界

- 写入原子化（临时文件 + fsync + rename）；`index.json` 更新用 `O_EXCL` 文件锁串行化，30 秒陈旧锁自动恢复。
- `handoffDir` 必须是工作区内相对路径；符号链接路径组件拒绝；`..` 逃逸拒绝；文件地图里越界的路径只标记、不读取。
- shell 命令、错误摘要和接续摘要经过密钥脱敏（`sk-*`、`Bearer *`、`*_KEY=*`、私钥块）。
- 除你点击「交接并继续」外，不自动开新会话、不自动发消息；不改写会话日志、不替代 `/compact`。
- 卸载插件后所有文档仍在磁盘上。

## 已知限制

- 交接文档由旧会话模型生成，质量取决于模型是否按模板写全；`/handoff status` 会显示文档是否已生成。
- 一键交接要求当前会话已有所属工作区；空白会话不会显示该菜单项。
- 如果旧会话模型没有写出 frontmatter 里的 `task_id`，`/handoff resume` 会拒绝载入；重新执行一次 `/handoff` 即可。

## 开发

纯 ESM JavaScript，无构建步骤，除 Harness 自带包外无运行时依赖。

```powershell
npm test
```

测试覆盖纯 fold、渲染、存储/锁、索引损坏恢复、路径安全、脱敏、清理，以及 `/handoff` 的参数解析与 `resume` 候选选择（含 `--latest`）。

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

在 agent / workflow 工具语境里，"handoff" 是「把任务和上下文交给另一个执行者」的通用说法，而且更短。仓库名、包名、命令、工具名、投影 key、数据目录、locale 全部统一用 `handoff`：`dsh-handoff`、`/handoff`、`.dsh/handoff`，只需要记一种拼写。以后改名会牵动命令名、工具名和落盘目录，所以把命名决定记录在这里。

## 许可证

MIT，见 [LICENSE](LICENSE)。
