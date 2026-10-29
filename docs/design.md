# dsh-handoff 插件方案：长会话交接与任务接力

> 状态：`0.1.0` 已实现 M1（Host 端闭环）；`0.2.0` 已实现 M2 的会话三点菜单入口（仅菜单，不在标题栏/会话行加按钮），并改为默认机械版交接、`--narrative` 可选；`0.2.1` 让一键交接用 `/handoff resume --latest` 精确接上刚写的那份文档，并在摘要注入失败时显式提示。
>
> 本文是设计阶段形成的方案，保留原始验收标准与取舍记录；实现细节以代码和 README 为准。
> 与方案的一处命名统一：仓库、包、命令、工具、投影、目录全部使用 `handoff`（而非 `handover`），理由见 README。

## 1. 目标与成功标准

在同一个工作区里，当会话变得很长（默认 ≥ 800 步开始提醒）时，能一键把这轮工作的**需求、状态、进度、已做/未做、决策、文件地图、坑、验证方式**落成一份工作区内的交接文档；开新会话后，用一条命令（或第二阶段的按钮）让新会话在**首轮就拿到准确摘要并知道先读哪份文档**，从而快速接续，而不是重新摸索。

成功标准（可验收）：
1. 老会话执行 `/handoff` 后，`<工作区>/.dsh/handoff/<task>/HANDOFF.md` 与 `facts.json` 存在，11 个章节无空缺（无内容的章节显式写「无」）。
2. 文档中的事实（步数、改过的文件、失败命令、todo/plan/goal）来自会话日志折叠，不是模型臆造；文件地图里的路径经插件校验存在（缺失会标注）。
3. 新会话执行 `/handoff resume` 后，首轮模型输入里出现 ≤ 2400 字的接续摘要，且只注入一次；重复执行会提示已接手。
4. 达到阈值时只提醒一次/每档，不刷屏；不会静默写文档、不会自动开新会话。
5. 插件只写 `<工作区>/.dsh/handoff/` 之下；卸载插件后文档仍在、会话日志未被改动。

## 2. 需求结论（问答结果与两处冲突的处理）

| 维度 | 你的选择 | 对设计的影响 |
|---|---|---|
| 文档位置 | 工作区 `.dsh/handoff/<任务>/`：`HANDOFF.md` + `facts.json` | 随项目走；新会话按 cwd 扫描即可发现；`.dsh/` 建议加入 `.gitignore`（文档里注明，不自动改） |
| 生成时机 | 手动 `/handoff` + 阈值提醒 | 不做静默自动生成；模型**不**被授予「自主决定何时写」的权限 |
| 接续方式 | 手动 `/handoff resume` + UI「继续任务」按钮 | 不做「新会话自动注入」；接续必须有一次显式动作 |
| 叙事作者 | 由当前会话模型写 | 不引入子代理/独立 LLM 调用；插件提供模板 + 事实 + 校验 |
| 文档章节 | 全部 11 项 | 模板固定为 11 节（见 §4.2） |
| 交付范围 | Host 端完整版 | 见下方冲突处理 |

**冲突 1：UI 按钮 vs「Host-only」。** 两个答案直接矛盾。方案按「两个里程碑、同一份计划」处理：
- **M1（先交付、可独立验收）**：纯 Host 端闭环 —— 命令、工具、事实折叠、阈值提醒、手动 resume。
- **M2（M1 验收后）**：Web 客户端插件，在会话头部加「交接/继续任务」入口，复用 M1 的全部 Host 逻辑。
这样既不违背「先 Host 端」，也不丢你选的按钮。

**冲突 2：范围选项里写了「子代理叙事 / 自动注入」。** 这两项与你在「叙事作者」「接续方式」里的明确选择相反，**不采用**。叙事由当前会话模型写；接续只由命令或按钮触发。

## 3. 总体架构与数据流

```
会话事件流
   │  (turn/start, step/start, user/message, assistant/message,
   │   tool/call, tool/result, workspace/changes)
   ▼
handoffFacts 投影（插件内折叠，宿主侧，无 UI）
   │
   ├─ /handoff ──► 事实快照 facts.json + HANDOFF.md 骨架（status: draft）
   │                   │
   │                   └─ agent.followup(写作指令) ──► 当前模型调用 handoff_write
   │                                                        │
   │                                                        ▼
   │                                             HANDOFF.md 完整版（status: pending）
   │                                             index.json 登记「待接续」
   │
   ├─ 阈值提醒：sessionStats.steps / contextPressure ──► 下一条消息边界的 notice
   │
   └─ /handoff resume（新会话）──► 生成 resume brief ──► agent.inject 注入
                                       └─ index.json 标记 resumed + resume-log.jsonl
```

三条主流程互不阻塞：事实折叠是同步纯函数；`/handoff` 写文件后把「补写叙事」作为一次普通 follow-up 交给模型；提醒只是在下一条消息前插入一条 notice。

## 4. 数据契约

### 4.1 目录布局

```
<workspace>/.dsh/handoff/
  index.json                     # 工作区级索引（唯一写入口，带锁）
  <taskId>/
    HANDOFF.md                   # 人读主文档（YAML frontmatter + 11 节）
    facts.json                   # 机器事实（模型不可篡改，插件生成）
    history/<yyyymmdd-HHmmss>.md # 覆盖前快照，保留最近 keepHistory 份
    resume-log.jsonl             # 每次被接手：{at, sessionId, title}
```

`taskId = <yyyymmdd-HHmm>[-<asciiSlug>]`；同一会话第二次 `/handoff` 复用当前 taskId，加 `--new` 才新建任务线。中文标题只进 frontmatter / 正文，slug 只取 ASCII 安全字符，为空则省略。

### 4.2 `HANDOFF.md` 模板

```markdown
---
handoff_version: 1
task_id: 20261029-1710
title: 长会话交接插件设计
status: draft | pending | resumed | archived
created_at: 2026-10-29T17:10:00+08:00
updated_at: ...
workspace: D:\41_Agent\50_Deepseek
source_session: session-e2637357-...
source_session_title: ...
facts_as_of_seq: 4213
steps: 812
turns: 96
first_action: ...
---

# 任务交接：<title>

## 0. 60 秒摘要
（≤10 行：做什么、到哪了、下一步第一件事）

## 1. 目标与需求 / 验收标准
## 2. 当前状态（一句话 + 进度 + 阻塞）
## 3. 已完成（产物 + 验证结果）
## 4. 待办与下一步（按优先级，含「第一件事」）
## 5. 关键决策与理由
## 6. 文件地图（路径 → 作用 → 状态）
## 7. 坑与失败尝试（不要重试）
## 8. 验证方式与命令（期望输出 / 当前基线）
## 9. 环境与依赖（路径、版本；不含密钥）
## 10. 未决问题 / 需要用户确认
## 11. 相关会话与资料
```

`facts.json` 状态为 `draft` 时，第 3–11 节由插件用机械事实预填，叙事位置写 `> TODO(模型补写)`；模型补齐后 `status: pending`。

### 4.3 `facts.json`（`schemaVersion: 1`）

```json
{
  "schemaVersion": 1,
  "taskId": "20261029-1710",
  "generatedAt": "...",
  "asOfSeq": 4213,
  "workspace": "...",
  "session": { "id": "...", "title": "...", "turns": 96, "steps": 812,
               "toolCalls": 2401, "toolErrors": 17,
               "pressureTokens": 118340, "contextWindow": 131072 },
  "goal": {...} | null,
  "plan": {...} | null,
  "todos": [{ "content": "...", "status": "pending|in_progress|completed" }],
  "recentUserMessages": [{ "seq": 4190, "turn": 95, "time": "...", "text": "（≤4KB，超出截断）" }],
  "recentAssistantMessages": [{ "seq": 4200, "turn": 95, "text": "（≤2KB）" }],
  "files": [{ "path": "src/a.ts", "writes": 3, "edits": 5, "lastSeq": 4180 }],
  "recentTurnsChanged": [{ "turn": 94, "seq": 4102, "files": ["...", "..."] }],
  "commands": [{ "seq": 4100, "text": "（≤500，已脱敏）", "ok": true }],
  "errors": [{ "seq": 4090, "tool": "pwsh", "summary": "（≤300）" }],
  "truncated": { "userMessages": false, "commands": false }
}
```

### 4.4 `index.json`

```json
{ "schemaVersion": 1,
  "tasks": [{
    "taskId": "...", "title": "...", "status": "draft|pending|resumed|archived",
    "createdAt": "...", "updatedAt": "...",
    "workspace": "...", "docPath": "HANDOFF.md 的相对路径", "factsPath": "facts.json",
    "sourceSessionId": "...", "sourceSessionTitle": "...",
    "steps": 812, "turns": 96, "firstAction": "...",
    "resumedBy": ["session-..."], "resumedAt": "..."
  }] }
```

`status` 语义：`draft`（骨架已写、模型未补齐）→ `pending`（可接续）→ `resumed`（已被接手）→ `archived`。只有 `pending` 出现在 resume 候选里，`draft` 会提示「先补齐」。

### 4.5 Resume brief（注入文本，≤2400 字符）

```
[交接续接] 你正在接续一个已有任务，而不是从零开始。
任务：<title>（taskId）
来源：<sessionId> <title>，<steps> 步 / <turns> 轮，文档更新于 <time>
完整文档：<绝对路径>/HANDOFF.md（先读它）
机器事实：<绝对路径>/facts.json（截至 seq <N>）
当前状态：<statusNow>｜进度：<progress>
第一件事：<firstAction>
接下来：<next[0..2]>
注意：文档事实截至旧会话；动手前用 read / git status 核对工作区现状，冲突时以工作区为准。
约束：读完 HANDOFF.md 再动手；完成一个阶段后用 /handoff 更新文档。
```

## 5. 工程结构（无构建步骤）

```
D:\41_Agent\50_Deepseek\dsh-handoff\
  package.json
  cordis.patch.yml
  README.md
  lib/index.js      # Cordis 插件：name / inject / Config / apply
  lib/facts.js      # handoffFacts 投影定义 + 纯 fold 函数
  lib/store.js      # 目录、原子写、锁、index CRUD、history
  lib/render.js     # HANDOFF.md 渲染 + brief 生成
  lib/tools.js      # handoff_write / handoff_read
  lib/commands.js   # /handoff 命令族
  lib/notice.js     # 阈值提醒
  lib/resume.js     # 接续注入与登记
  test/*.test.js    # node:test 单元测试
```

- 纯 ESM JavaScript，**不引入 TypeScript/esbuild**：当前安装版（app.asar，DSH 0.2.1-rc.3 / 桌面版 44.7.0）里没有 `@deepseek-ai/*` 的 `.d.ts`，手写 JS 最省事，也避免在用户机器上装工具链。
- 依赖只声明 peer（`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`、`zod`）；由宿主解析，与 `dsh-rewind-plugin` 的做法一致。
- `package.json`：
  ```json
  { "name": "dsh-handoff", "version": "0.1.0", "type": "module", "main": "lib/index.js",
    "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
    "dsh": { "bundle": { "patch": "./cordis.patch.yml" },
             "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-ui-session"] } },
    "engines": { "node": ">=22", "dsh": ">=0.2.1-rc.1 <0.3.0-0" } }
  ```
  （`dsh.client` 仅 M2 需要；M1 可先留空。）
- `cordis.patch.yml`：`- insert: [{ id: dsh-handoff, name: dsh-handoff }]`，配置在 profile 的 `cordis.patch.yml` 里按 id 覆盖。

## 6. 子系统实现

### 6.1 事实折叠（`lib/facts.js`）

注册宿主侧投影（无 `wire` 块，客户端不可见）：

```js
ctx.sessionProjections.register({
  key: 'handoffFacts', stateVersion: 1,
  stateSchema: factsStateSchema,        // zod
  init: () => emptyFacts(),
  apply: (state, event) => /* 纯函数，未命中事件原样返回 state */,
})
```

折叠规则（事件名均已确认存在于 `KNOWN_SESSION_EVENT_TYPES`）：

| 事件 | 折叠内容 |
|---|---|
| `turn/start` / `step/start` | turns / steps 计数 |
| `user/message`（`source.kind === 'user'`） | 最近 40 条正文（每条 ≤4KB，超长截断） |
| `assistant/message` | 最近 12 条正文（≤2KB） |
| `tool/call` | `{turn, step, callId, name, arguments}`：统计次数；`write/edit/str_replace_editor` 取 `arguments.path`；`pwsh/bash` 取 `arguments.command`（脱敏 ≤500） |
| `tool/result` | `{message:{isError, content}, error}`：记录失败摘要（≤300），成功命令计入 `commands` |
| `workspace/changes` | 记 `{turn, seq}`，生成文档时用 `ctx.workspaceChanges.summary(sessionId, seq)` 补文件清单 |

生成文档时的其它事实**直接读现成投影**，但必须走 `ctx.get('sessionProjections')` 再 `stateOf(session, 'todos' | 'plan' | 'goal' | 'sessionStats' | 'turnOutline' | 'contextPressure')`：命令处理器所在上下文没有声明 `sessionProjections` 注入，直接写 `ctx.sessionProjections` 会被 Cordis 拒绝（`cannot get property … without inject`），读法错误会让所有投影读成 `undefined`。所有读取都 `try/catch`，缺服务就降级（对应章节写「无」并在 facts 里记 `unavailable`）。

内存上限：users 40×4KB、assistants 12×2KB、commands 40、errors 30、files 200；超限截断并置 `truncated` 标记。

### 6.2 存储层（`lib/store.js`）

- **路径安全**：`handoffDir` 只接受相对路径（默认 `.dsh/handoff`），`path.resolve(cwd, dir)` 后必须仍在 cwd 内；拒绝 `..` 逃逸；`lstat` 检查 `.dsh` / `.handoff` 不是符号链接；任何写入都断言最终路径以 `<cwd>/.dsh/handoff/` 开头。
- **原子写**：同目录临时文件 → `fsync` → 删除旧文件 → `rename`（Windows 上 rename 不能覆盖已存在文件）；全程持锁。
- **锁**：`index.json.lock`，`open('wx')`；失败重试 10 次 × 50ms；mtime 超过 30s 视为陈旧锁并清除一次后重试；锁文件写 pid+时间便于诊断。
- **索引损坏**：解析失败 → 原名加 `.bak-<ts>` 保留 → 扫描 `*/facts.json` 重建 → 记录一条告警到命令输出。
- **历史**：覆盖 `HANDOFF.md` 前复制到 `history/`，超出 `keepHistory` 删除最旧。
- **幂等**：同一 taskId 相同内容不重复写；`updated_at` 不变。

### 6.3 `/handoff` 命令族（`lib/commands.js`）

`ctx.commands.register({ name:'handoff', description, input:{ hint:'[status|list|resume [taskId]|archive <taskId>] [--new]' }, handler })`

| 输入 | 行为 |
|---|---|
| `/handoff` 或 `/handoff update` | 折叠事实 → 写 `facts.json` + 骨架（draft）→ `agent.followup` 发写作指令 → 返回成功文本（含文档绝对路径、步数、待补章节） |
| `/handoff status` | 当前 taskId、status、更新时间、步数、文档路径 |
| `/handoff list` | 本工作区所有任务线（状态、更新时间、摘要首行） |
| `/handoff resume [taskId]` | 见 §6.6 |
| `/handoff archive <taskId>` | 置 archived，不再出现在 resume 候选 |

写作指令（follow-up，模型可见，≤300 字）：

> `[dsh-handoff] 交接骨架已写到 <path>/HANDOFF.md，机械事实在 facts.json（截至 seq N）。请先读这两份文件，然后调用 handoff_write 补齐全部叙事章节；每条事实以 facts.json 为准，不要臆造未发生的改动；无法确定的写进「未决问题」。`

失败处理：写入失败 → 返回 error 并带原因；followup 抛错（无驱动/会话不可写）→ 仍返回骨架路径，提示用户「手动说一句：按 HANDOFF.md 骨架补齐交接文档」；不静默吞掉。

### 6.4 工具（`lib/tools.js`）

**`handoff_write`**（`defineTool`）

- 参数：`task_id?`、`title`、`status`（`pending|blocked|done` 语义写入第 2 节）、`summary`、`goal`、`acceptance[]`、`status_now`、`progress`、`blockers[]`、`done[]`、`next[]`（≥1，第一项即 first_action）、`decisions[]`、`files[{path, purpose, state}]`、`pitfalls[]`、`verify[]`、`env[]`、`open_questions[]`、`related[]`。
- 校验：`summary/goal/status_now/next[0]` 非空；`files[].path` 必须相对 cwd 且存在（不存在 → 标记 `[缺失]` 而不是报错）；路径统一正斜杠。
- 行为：渲染 `HANDOFF.md`（`status: pending`，frontmatter 保留 `facts_as_of_seq`）→ 写 `facts.json` 的 `narrative` 摘要块 → 更新 `index.json`（pending）→ 返回 `{ path, bytes, warnings[] }`。警告示例：`done` 为空但步数 > 60、`decisions` 为空、`files` 中有缺失路径。
- 幂等：同 taskId 覆盖写入并留历史。

**`handoff_read`**：`task_id?` + `section?`（`summary|next|files|facts|all`），返回文档摘录或 facts 子集；供新会话在 brief 之外按需深读，避免整篇塞进上下文。

两个工具都在描述里写明：**不得写入密钥**；只能写 `<workspace>/.dsh/handoff/`，工具内部强制。

### 6.5 阈值提醒（`lib/notice.js`）

- 数据源：`sessionStats.steps`（首选）、`contextPressure.projectedTokens`（次选）；缺服务则关闭提醒。
- 触发：`steps ≥ remindAfterSteps` 或 `projectedTokens ≥ remindAfterTokens`；按 `remindEverySteps` 分档，每档只提醒一次（状态存内存 Map<sessionId, 已提醒档>，随插件卸载清空；不写会话日志）。
- 投递：`ctx.on('agent/pre-step', async (payload, next) => { const d = await next(); if (d.kind !== 'enter') return d; const t = takeNotice(payload.agent); return t ? { kind:'enter', messages:[notice(t), ...d.messages] } : d })`，与 `dsh-multi-folder` 同一套写法；同时在 `tools/post-execute` 兜底投递，保证长工具链中途也能看到。
- notice 的 `source.kind` 必须是 `plugin:dsh-handoff`（v4 只接受生产者自有 kind），`form: 'notice'`，`summary` 取首行。
- 文案：`本会话已 812 步（上下文 118k/131k）。建议现在执行 /handoff 生成交接文档，然后在新会话用 /handoff resume 继续；若继续当前会话，注意后续改动准确率会下降。`
- 不做：静默生成、自动开新会话、打断当前工具调用。

### 6.6 接续（`lib/resume.js`）

1. `/handoff resume`：读 `index.json`，筛 `status === 'pending'`。
   - 0 条 → 提示「无待接续文档；先 /handoff list 查看，或 /handoff 生成本任务的」。
   - 1 条 → 直接用。
   - 多条 → 列出（taskId / 标题 / 更新时间 / 步数 / 第一件事），要求带 taskId 再执行。
2. 生成 brief（§4.5）；`agent.inject({ content:[{type:'text',text:brief}], source:{kind:'plugin:dsh-handoff', form:'notice', summary:'handoff resume'} })`。`inject` 不唤醒驱动，等用户下一条消息时生效，正好符合「新会话首轮就带上」。
3. 登记：`index.json` 追加 `resumedBy/resumedAt`，状态置 `resumed`；`resume-log.jsonl` 追加一行；命令返回文档路径与「已接手」提示。
4. 幂等：同一 session 已接手过同一 taskId → 提示并允许 `--force` 重新注入。

不做自动注入：新会话只有在显式执行命令（或 M2 点按钮）后才拿到 brief。

### 6.7 M2：Web 客户端（`lib/client.js`，无 JSX）

- 入口：`ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name, id:'dsh-handoff', order:900 }, Component))`（与 `dsh-rewind-plugin` 同槽位；用 `React.createElement`，不引 esbuild）。
- 远程数据：Host 侧注册 Typert 命名空间 `handoff`，方法 `list(workspace)`、`brief(taskId)`、`markResumed(taskId, sessionId)`；客户端用现有 connection 调用，不新增 HTTP 路由。
- 「继续任务」：优先复用客户端 SessionManager 的 `session.create` + `session.prompt`（把 brief 作为第一条消息），创建后跳转到该会话；若该客户端接口不暴露，则降级为「打开新会话并把 brief 填进输入框」，不自动发送。**M2 开工前先做半天 spike 确认这条路径**，这是唯一的未知点。
- 界面文案走 `ctx.locale.register('handoff', {zh,en})`；不做独立设置页，阈值仍在 `cordis.patch.yml` 配置。

### 6.8 配置项（`Config`，schemastery）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `handoffDir` | `.dsh/handoff` | 工作区相对目录，拒绝绝对路径 |
| `remindAfterSteps` | `800` | 首次提醒步数 |
| `remindEverySteps` | `200` | 分档间隔 |
| `remindAfterTokens` | `120000` | 上下文压力提醒线（0 关闭） |
| `maxUserMessages` / `maxAssistantMessages` | `40` / `12` | 事实折叠条数 |
| `maxCommandLog` / `maxErrors` | `40` / `30` | 同上 |
| `keepHistory` | `10` | 历史版本数 |
| `resumeBriefMaxChars` | `2400` | brief 上限 |
| `language` | `zh` | 文档语言（`zh` / `en`） |

## 7. 公共 API 与兼容性

| 面向 | 契约 |
|---|---|
| 用户 | `/handoff`、`/handoff status|list|resume|archive` |
| 模型 | `handoff_write`、`handoff_read` |
| 宿主插件 | 投影键 `handoffFacts`（stateVersion 1，host-only）；Typert 命名空间 `handoff`（M2） |
| 落盘 | `handoff_version: 1`、`facts.json schemaVersion: 1`、`index.json schemaVersion: 1` |
| 兼容 | 读到更高的 `handoff_version` 只读不写并提示升级；`engines.dsh` 限定 `<0.3.0` |

事件名与 payload 已按当前版本核对：`tool/call = {turn,step,callId,name,arguments}`、`tool/result = {turn,step,message:{isError,content},error?}`；不调用已废弃的 `eventAt/snapshotEvents/ownEvents`，也不写 `plugin:` 记录（外部插件不允许 `appendPluginRecord`）。

## 8. 边界情况与失败模式

| 场景 | 处理 |
|---|---|
| 无 cwd / 目录不存在 / 只读工作区 | 命令返回明确错误，不落半成品 |
| `.dsh` 是符号链接 | 拒绝写入并说明原因（防止写出工作区） |
| 索引损坏 / 锁残留 | 备份 + 扫描重建；30s 陈旧锁自动清理一次 |
| 模型始终不调用 `handoff_write` | 文档停在 `draft`；`/handoff status` 显示待补；再提醒一档；不假装完成 |
| 模型写了不存在的文件路径 | 工具标 `[缺失]` 并给 warning，不阻断 |
| 事实超上限 | 截断 + `truncated` 标记 + 文档注明「仅保留最近 N 条」 |
| 非 git 仓库 | `workspaceChanges.summary` 缺失，退回 `tool/call` 里的写路径 |
| 会话已重启后再 `/handoff` | 投影从日志重放，事实完整；`workspaceChanges` 只覆盖本进程，文档注明「文件变更来自工具调用记录」 |
| 并发多会话写同一工作区 | 文件锁串行化；不同 taskId 互不覆盖 |
| 旧文档已过期 | brief 明示 `facts_as_of_seq` 与「以工作区为准」；resume 不改写事实 |
| 密钥泄漏 | 命令/环境做模式脱敏（`sk-*`、`Bearer *`、`*_KEY=*`、私钥块）；文档模板要求「不含密钥」 |
| 卸载插件 | 只注销命令/工具/投影；磁盘文档保留 |

## 9. 测试计划

1. **单元（`node --test`，不依赖 DSH）**
   - fold：构造事件序列 → 断言 steps/turns/files/commands/errors/截断标记；未知事件返回同一引用。
   - render：给定 facts+narrative → 断言 11 节齐全、frontmatter 字段、字数上限、缺失文件标 `[缺失]`。
   - store：临时目录下原子写、锁竞争、陈旧锁、索引损坏重建、历史裁剪、路径逃逸与符号链接拒绝。
   - redact：各类密钥样例被替换。
   - brief：超长截断、必含字段、字符上限。
2. **集成（stub ctx）**：`apply()` 后命令/工具/投影各注册一次；`/handoff` 在临时工作区产出 draft 文档与 index；`handoff_write` 产出 pending；`resume` 把 brief 送进 stub agent 的 inject 并标记 resumed。
3. **端到端（本机 DSH）**：见 §10 验收步骤。
4. **回归**：卸载/重载插件后无残留监听；再执行命令不抛「重复注册」。

## 10. 验收标准（逐条可测）

1. 老会话 `/handoff` → 30s 内出现 `<cwd>/.dsh/handoff/<task>/HANDOFF.md`（11 节）与 `facts.json`；`/handoff status` 状态从 `draft` 变 `pending`（模型补齐后）。
2. 文档里出现真实步数、真实改过的文件（与 `write/edit` 调用一致）、真实失败命令；抽查 3 条与日志吻合。
3. 新会话 `/handoff resume` → 请求首条即含 brief；再执行一次提示「已接手」。
4. 步数跨过 800/1000/1200 各只提醒一次；提醒出现在消息边界，不打断工具。
5. 插件只写 `.dsh/handoff/`（用文件时间戳抽查工作区其它文件未被触碰）。
6. 卸载插件后 DSH 正常启动，文档可读，旧会话日志未被改写。

## 11. 实施顺序与安装验证

| 步骤 | 内容 | 验证 |
|---|---|---|
| S0 | 0.5 天 spike：外部插件能否用自带 `zod` 注册投影并 `stateOf`；命令 handler 里 `agent.followup` 是否触发新回合；notice 是否被 v4 接受 | 写一个一次性探针插件，控制台打点 |
| S1 | 包骨架 + `cordis.patch.yml` + 空 `apply` | 插件在 profile 加载，日志无错 |
| S2 | `lib/facts.js` + 单测 | `node --test` 通过 |
| S3 | `lib/store.js` + `lib/render.js` + 单测 | 同上 |
| S4 | 工具 `handoff_write/read` | 手工调用产出文档 |
| S5 | `/handoff` 命令族 | 端到端生成 |
| S6 | 阈值提醒 | 调低阈值验证分档 |
| S7 | resume + 索引登记 | 新会话验收 |
| S8 | README / 卸载说明 / 全量验收 | §10 |
| M2 | 客户端按钮 | 会话头部出现入口，点击可继续 |

安装（M1）：
1. `& "D:\10_Programs\DSH\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add link:D:\41_Agent\50_Deepseek\dsh-handoff`
2. 确认 `C:\Users\hyb\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 含 `dsh-handoff`（不在就手动加；或走插件管理界面启用）。
3. 重启 DSH（新装 bundle 不走热更新），在测试工作区跑 §10。
4. 卸载：`dsh plugin --profile desktop remove dsh-handoff` + 从 bundles 移除。

## 12. 明确假设与非目标

**假设**
- 当前安装版 DSH 0.2.1-rc.3 / 桌面 44.7.0，Node 24，Windows；插件以 `link:` 方式装入 `desktop` profile。
- `ctx.sessionProjections.register` 接受外部插件的定义（S0 验证；失败则降级为「监听 `session/event` + facts 落盘」的内存折叠，兜底方案已写在 §6.1 的 try/catch 里）。
- 用户接受 `.dsh/` 进工作区（并在需要时自行 gitignore）。

**非目标**
- 不自动开新会话、不自动发消息、不在新会话自动注入（M2 按钮也需点击）。
- 不替代 `/compact`，不改写会话日志，不做 fork/rewind。
- 不做跨机器同步、不做任务看板、不做多工作区聚合。
- 不承诺在没有模型的场景生成叙事（只保证机械事实完整）。

**风险与对策**
- 模型在长会话里写不准 → facts.json 是权威、工具校验并提供 warnings、`first_action` 与文件地图机械生成。
- 外部插件投影注册不兼容 → S0 先验证，失败切内存折叠兜底。
- M2 客户端建会话接口不确定 → 先 spike，不行就降级为「填入新会话输入框」。
