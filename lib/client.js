/**
 * dsh-handoff — Web client half.
 *
 * One click performs a fast mechanical handoff of the current Session, creates
 * a new Session in the same workspace, injects the resume brief, and sends a
 * first prompt so the new Session starts working without waiting for the user.
 *
 * Entry points:
 *   - conversation.session.header.actions   icon button next to the title
 *   - sidebar.workspaces.session.row.action hover button on a Session row
 *   - sidebar.workspaces.session.menu.item  "…" menu row
 *   - shell.overlay                         progress / error toast
 */

window.__ModuleLoader__.load({
  id: 'dsh-handoff',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TEXT = {
      zh: {
        action: '交接并继续',
        title: '生成交接文档，并在新会话自动继续',
        writing: '正在生成本会话的机械版交接文档…',
        creating: '正在创建新会话…',
        starting: '正在载入交接并自动继续…',
        done: '已创建新会话，模型正在自动继续',
        error: '交接失败',
        blank: '当前会话还没有内容，无法交接',
        noWorkspace: '找不到会话所属的工作区',
        workingShort: '交接中…',
        prompt: (workspacePath) =>
          [
            `你正在接续工作区 ${workspacePath} 中的一个已有任务，而不是从零开始。`,
            '',
            '如果上一条消息已经带有「[交接续接]」摘要，直接按摘要执行。',
            `否则请先读取 ${workspacePath}\\.dsh\\handoff\\ 下最新的 HANDOFF.md 和 facts.json（按修改时间选择最新一份）。`,
            '如果 HANDOFF.md 仍是 draft 或含 TODO，请先用 handoff_write 补齐（task_id 见文档 frontmatter），再继续。',
            '然后按文档「第一件事」立即开始执行，不要等待用户输入。',
            '完成一个阶段后，在本会话用 /handoff 更新交接文档。',
          ].join('\n'),
      },
      en: {
        action: 'Handoff and continue',
        title: 'Create a handoff document and continue automatically in a new Session',
        writing: 'Writing the mechanical handoff for this Session…',
        creating: 'Creating a new Session…',
        starting: 'Loading the handoff and continuing…',
        done: 'New Session created; the model is continuing automatically',
        error: 'Handoff failed',
        blank: 'This Session has no content yet',
        noWorkspace: 'Could not resolve the Session workspace',
        workingShort: 'Handing off…',
        prompt: (workspacePath) =>
          [
            `You are continuing an existing task in workspace ${workspacePath}, not starting from scratch.`,
            '',
            'If the previous message already carries a "[Handoff resume]" brief, follow it.',
            `Otherwise read the newest HANDOFF.md and facts.json under ${workspacePath}\\.dsh\\handoff\\ (pick the latest by modification time).`,
            'If HANDOFF.md is still a draft or contains TODOs, complete it with handoff_write first (task_id is in the frontmatter), then continue.',
            'Start immediately with the document\'s first action; do not wait for user input.',
            'After a milestone, update the handoff in this Session with /handoff.',
          ].join('\n'),
      },
    }

    const toastStore = { state: { visible: false, text: '', tone: 'info', id: 0 }, listeners: new Set(), timer: null }

    function notifyToast(next, autoHideMs) {
      toastStore.state = { ...next, id: toastStore.state.id + 1 }
      for (const listener of toastStore.listeners) listener()
      if (toastStore.timer !== null) clearTimeout(toastStore.timer)
      toastStore.timer = null
      if (autoHideMs > 0) {
        toastStore.timer = setTimeout(() => {
          toastStore.state = { ...toastStore.state, visible: false, id: toastStore.state.id + 1 }
          for (const listener of toastStore.listeners) listener()
        }, autoHideMs)
      }
    }

    function pushToast(text, tone = 'info', autoHideMs = 0) {
      notifyToast({ visible: true, text, tone }, autoHideMs)
    }

    function useToast() {
      return React.useSyncExternalStore(
        (listener) => {
          toastStore.listeners.add(listener)
          return () => toastStore.listeners.delete(listener)
        },
        () => toastStore.state,
        () => toastStore.state,
      )
    }

    const activeSessions = new Set()
    let pluginCtx = null

    function HandoffIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 3, y: 4, width: 7, height: 9, rx: 1.5 }),
        h('rect', { x: 14, y: 11, width: 7, height: 9, rx: 1.5 }),
        h('path', { d: 'M10 9h4a2 2 0 0 1 2 2v1' }),
        h('path', { d: 'M15 10l1 2 2-1' }),
      )
    }

    function Toast() {
      const state = useToast()
      if (!state.visible) return null
      const color =
        state.tone === 'error'
          ? 'var(--dsw-alias-state-error-primary, #e5484d)'
          : state.tone === 'success'
            ? 'var(--dsw-alias-state-success-primary, #30a46c)'
            : 'var(--dsw-alias-brand-primary, #4f7cff)'
      return h(
        'div',
        {
          role: 'status',
          'aria-live': 'polite',
          style: {
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            zIndex: 2147483000,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            maxWidth: 'min(620px, calc(100vw - 32px))',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14))',
            background: 'var(--dsw-alias-bg-overlay, #1f2430)',
            color: 'var(--dsw-alias-label-primary, #e6e8ee)',
            boxShadow: '0 8px 28px rgba(0,0,0,.28)',
            fontSize: 13,
            lineHeight: 1.5,
            pointerEvents: 'none',
          },
        },
        h('span', { style: { color, marginTop: 1 } }, '●'),
        h('span', null, state.text),
      )
    }

    function useLocale(ctx) {
      return React.useSyncExternalStore(
        (listener) => ctx.locale.subscribe(listener),
        () => ctx.locale.getSnapshot(),
        () => ctx.locale.getSnapshot(),
      )
    }

    function strings(locale) {
      return String(locale?.active ?? '').toLowerCase().startsWith('en') ? TEXT.en : TEXT.zh
    }

    function useWorkspaceForSession(useWorkspaces, sessionId) {
      const snapshot = useWorkspaces((state) => state)
      return snapshot?.items?.find((workspace) => Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId))
    }

    function useHandoffAction(ctx, sessionId, workspace) {
      const locale = useLocale(ctx)
      const t = strings(locale)
      const [busy, setBusy] = React.useState(false)

      const run = async () => {
        if (busy || activeSessions.has(sessionId)) return
        if (!workspace || typeof workspace.workspaceId !== 'string') {
          pushToast(t.noWorkspace, 'error', 8000)
          return
        }
        const snapshot = ctx.sessions.list.getSnapshot()
        if (snapshot.byId?.[sessionId]?.blank === true) {
          pushToast(t.blank, 'error', 8000)
          return
        }

        activeSessions.add(sessionId)
        setBusy(true)
        try {
          pushToast(t.writing, 'info')
          await ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async (reference) => {
            const result = await reference.binding.session.command('/handoff')
            if (result?.ok === false) throw new Error(result.error?.message ?? 'handoff command failed')
          })

          pushToast(t.creating, 'info')
          const newSessionId = await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId)

          pushToast(t.starting, 'info')
          await ctx.sessions.using(newSessionId, { source: 'controllerOperation' }, async (reference) => {
            // Best-effort brief: the prompt below is self-contained if this fails.
            try {
              await reference.binding.session.command('/handoff resume')
            } catch {
              /* ignore: the prompt still points at the newest document */
            }
            const result = await reference.binding.session.prompt(
              [{ type: 'text', text: t.prompt(workspace.path ?? '') }],
              'queue',
            )
            if (result?.ok === false) throw new Error(result.error?.message ?? 'prompt failed')
          })

          ctx.uiWorkspace.openSession(newSessionId)
          pushToast(t.done, 'success', 5000)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          pushToast(`${t.error}: ${message}`, 'error', 10000)
        } finally {
          activeSessions.delete(sessionId)
          setBusy(false)
        }
      }

      return { busy, run, t }
    }

    function MenuItem({ sessionId, useWorkspaces, useMenuOpenState }) {
      const workspace = useWorkspaceForSession(useWorkspaces, sessionId)
      const { busy, run, t } = useHandoffAction(pluginCtx, sessionId, workspace)
      const [, setMenuOpen] = useMenuOpenState()
      const [hover, setHover] = React.useState(false)
      if (!workspace) return null
      const start = () => {
        setMenuOpen(false)
        run()
      }
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          tabIndex: 0,
          disabled: busy,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              start()
            }
          },
          onClick: start,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            minHeight: 32,
            padding: '6px 10px',
            border: 0,
            borderRadius: 6,
            background: hover && !busy ? 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,.08))' : 'transparent',
            color: 'var(--dsw-alias-label-primary, #e6e8ee)',
            font: 'inherit',
            fontSize: 13,
            textAlign: 'left',
            cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          },
        },
        h(HandoffIcon, { size: 14 }),
        h('span', null, busy ? t.workingShort : t.action),
      )
    }

    return {
      inject: ['slots', 'sessions', 'uiWorkspace', 'locale'],
      apply(ctx) {
        pluginCtx = ctx
        ctx.effect(
          () => () => {
            if (toastStore.timer !== null) clearTimeout(toastStore.timer)
          },
          'dsh-handoff toast timer',
        )

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'dsh-handoff', order: 350 }, MenuItem),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-handoff-toast', order: 1000 }, Toast),
        )
      },
    }
  },
})
