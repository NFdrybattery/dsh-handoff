/**
 * The instruction sent to the old Session's model. Keeping it in one pure
 * function makes the required document shape testable and keeps commands.js
 * about orchestration rather than prose.
 */

/**
 * @param {object} options
 * @param {string} options.taskId
 * @param {string} options.title
 * @param {string} options.createdAt
 * @param {string} options.updatedAt
 * @param {string} options.workspace
 * @param {string} options.sourceSession
 * @param {number} options.steps
 * @param {number} options.turns
 * @param {string} options.docPath
 * @param {number} [options.recentRounds]
 * @param {string} [options.recentDialog]
 * @returns {string}
 */
export function buildHandoffInstruction({
  taskId,
  title,
  createdAt,
  updatedAt,
  workspace,
  sourceSession,
  steps,
  turns,
  docPath,
  recentRounds = 5,
  recentDialog = '',
}) {
  return [
    '【生成交接文档】请把当前会话整理成一份完整交接文档，用 write 工具写到：',
    docPath,
    '',
    '必须使用下面的 frontmatter 和 0–12 共 13 个章节（task_id、status、source_session 等原样保留；尖括号内容替换为实际值）：',
    '---',
    'handoff_version: 1',
    `task_id: ${JSON.stringify(taskId)}`,
    `title: ${JSON.stringify(title)}`,
    'status: pending',
    `created_at: ${JSON.stringify(createdAt)}`,
    `updated_at: ${JSON.stringify(updatedAt)}`,
    `workspace: ${JSON.stringify(workspace)}`,
    `source_session: ${JSON.stringify(sourceSession)}`,
    `steps: ${steps}`,
    `turns: ${turns}`,
    'first_action: "<新会话应执行的第一件事>"',
    '---',
    '',
    `# 任务交接：${title}`,
    '',
    '## 0. 60 秒摘要',
    '- 用 3-5 条说清：在做什么、现在到哪、最近一次验证结果、下一步第一条动作。',
    '- 至少写出一个关键文件路径；不要只写“进展顺利”。',
    '',
    '## 1. 目标与需求 / 验收标准',
    '- 原始目标：用户最初要什么，最终交付物是什么。',
    '- 验收标准：可执行的检查项（命令、测试、页面行为或数据结果）。',
    '- 非目标：本次明确不做什么，避免新会话扩大范围。',
    '',
    '## 2. 当前状态',
    '- 已完成 / 进行中 / 阻塞，分别是什么。',
    '- 当前分支、最近 commit、工作树是否干净（能确认才写）。',
    '- 最近一次测试/构建结果与时间；没有跑就写“未运行”。',
    '- 文档未覆盖、可能过期或你不确定的内容。',
    '',
    '## 3. 已完成（产物 + 验证结果）',
    '- 每条固定写：做了什么 → 产物路径 → 怎么验证 → 结果。',
    '- 不要把“改过文件”当成“已完成”；没有验证就写“未验证”。',
    '',
    '## 4. 待办与下一步',
    '1. 第一件事：具体动作 + 涉及文件/命令 + 完成标准。',
    '2. 第二件事：同上。',
    '3. 最多写 5 条，按优先级排序；不要写“继续优化”这类空话。',
    '',
    '## 5. 关键决策与理由',
    '- 决策 / 原因 / 放弃的替代方案 / 代价。',
    '- 没有就写“无”；不要编造未发生的讨论。',
    '',
    '## 6. 文件地图',
    '| 路径 | 作用 | 状态 |',
    '| --- | --- | --- |',
    '| `<相对路径>` | 为什么重要 | 已改 / 已读 / 缺失 / 越界 |',
    '- 只列真正改过或新会话必须读的文件；不存在或工作区外的路径要标记。',
    '',
    '## 7. 坑与失败尝试',
    '- 每条固定写：尝试 → 报错原文/现象 → 原因 → 不要重试 → 正确做法。',
    '- 至少记录一次失败；没有就写“无”。',
    '',
    '## 8. 验证方式与命令',
    '```bash',
    '# 在这里写实际命令',
    '```',
    '- 每条命令写清：期望输出 / 通过标准 / 当前基线。',
    '- 命令必须能在当前工作区直接执行，不要写伪代码。',
    '',
    '## 9. 环境与依赖',
    '- 操作系统、Node/运行时版本、包管理器、关键依赖版本。',
    '- 安装或启动命令；环境变量只写名字，不写具体值。',
    '',
    '## 10. 未决问题 / 需要用户确认',
    '- 问题 / 影响 / 建议选项；没有就写“无”。',
    '- 不要替用户做需要产品决策的选择。',
    '',
    '## 11. 相关会话与资料',
    `- 来源会话：${sourceSession}`,
    '- 旧会话标题、相关文件、链接或外部资料；没有就写“无”。',
    '',
    '## 12. 最近几轮对话（界面显示）',
    `- 插件已按界面顺序原样提取最近 ${recentRounds} 轮用户输入与助手回复，本节内容就是下面这段片段，不需要另外概括。`,
    '- 写法：原样抄录。每条用户输入以 `用户：` 开头，其后的助手回复以 `回复：` 开头；原文的顺序、换行、标点、代码块都保持不变。',
    '- 禁止总结、改写、压缩、合并、截断或重排，也不要补充原文没有的字句；片段为空时本节写“无”。',
    '~~~text',
    recentDialog.length > 0 ? recentDialog : '无（recentRounds=0 或最近对话不可用）',
    '~~~',
    '',
    '写作要求：',
    '- 每一节都要写实际内容，不能只有标题；没有内容的节写“无”。',
    '- 第 12 节只做原样转录，不做任何加工；只有其余各节才需要归纳。',
    '- 事实来自当前会话；不要臆造未发生的文件、命令、测试或改动。',
    '- 路径写工作区相对路径；命令放在代码块里；不要写 API key、token、密码或私钥。',
    '- 只写这一个 HANDOFF.md，不要创建其他文件，不要调用 handoff_write。',
    '- 写完后只回复「已写入 ' + docPath + '」，不要再执行其他操作。',
  ].join('\n')
}
