/**
 * dsh-handoff — Web client half.
 *
 * One click performs a fast mechanical handoff of the current Session, creates
 * a new Session in the same workspace, injects the resume brief, and sends a
 * first prompt so the new Session starts working without waiting for the user.
 *
 * Entry points:
 *   - sidebar.workspaces.session.menu.item  "…" menu row (the only button; the
 *     Session header and the Session row stay untouched)
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
        title: '生成交接文档，并在新会话生成接手说明',
        writing: '已发送交接指令，模型正在写交接文档…',
        creating: '正在创建新会话…',
        starting: '正在完整读取交接并生成接手说明…',
        done: '已创建新会话，模型正在完整读取交接并生成接手说明',
        error: '交接失败',
        resumeWarn: '交接摘要未能载入（新会话仍会自己读文档）',
        blank: '当前会话还没有内容，无法交接',
        noWorkspace: '找不到会话所属的工作区',
        workingShort: '交接中…',
        prompt: (workspacePath) =>
          [
            '请按 HANDOFF.md 第 12 节「新会话接手回复格式」接手：先完整读文档，只输出 6 个 Markdown 列表项；不要执行命令、不要改文件。',
            '如果文档没有第 12 节，按【接手】【状态】【下一步】【关键文件】【验证】【待确认】六项各一行回复。',
            `若上一条没有【交接续接】标题，读取 ${workspacePath}\\.dsh\\handoff\\ 下最新的 HANDOFF.md。`,
          ].join('\n'),
      },
      en: {
        action: 'Handoff and continue',
        title: 'Create a handoff document and a takeover note in a new Session',
        writing: 'Handoff instruction sent; the model is writing the document…',
        creating: 'Creating a new Session…',
        starting: 'Reading the full handoff and writing the takeover note…',
        done: 'New Session created; the model is reading the full handoff and writing the takeover note',
        error: 'Handoff failed',
        resumeWarn: 'The resume brief could not be loaded (the new Session will read the document)',
        blank: 'This Session has no content yet',
        noWorkspace: 'Could not resolve the Session workspace',
        workingShort: 'Handing off…',
        prompt: (workspacePath) =>
          [
            'Take over using section 12 ("Takeover reply format") of HANDOFF.md: read the whole document first, then output only six Markdown list items; do not run commands or modify files.',
            'If section 12 is absent, reply with six one-line items: [Takeover], [State], [Next], [Key file], [Verify], [Confirm].',
            `If the previous message has no "[Handoff resume]" header, read the newest HANDOFF.md under ${workspacePath}\\.dsh\\handoff\\.`,
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

    /**
     * The command round trip may report its outcome as the result itself, as
     * `{ result }`, or as `{ value: { result } }` depending on the client half
     * that carries it. Normalize that here so a failed command is never silent.
     */
    function commandFailure(outcome) {
      if (outcome === null || typeof outcome !== 'object') return null
      const inner = outcome.result ?? outcome.value?.result ?? outcome
      return inner?.kind === 'error' ? String(inner.text ?? 'command failed') : null
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
            const failure = commandFailure(result)
            if (failure !== null) throw new Error(failure)

            // Wait for the old Session's model to finish writing HANDOFF.md
            // before opening the new Session, so it never reads a missing or
            // half-written document. Give the turn 10s to start, then up to 4min.
            const sessionFace = reference.binding.session
            const startedAt = Date.now()
            // If a turn was already running, wait for it to end, then wait for
            // the queued handoff turn to start and finish. If idle, wait for the
            // handoff turn directly.
            let phase = sessionFace.getSnapshot().running === true ? 'idle' : 'start'
            while (Date.now() - startedAt < 240_000) {
              const running = sessionFace.getSnapshot().running === true
              if (phase === 'idle') {
                if (!running) phase = 'start'
              } else if (phase === 'start') {
                if (running) phase = 'finish'
                else if (Date.now() - startedAt > 10_000) break
              } else if (phase === 'finish' && !running) {
                break
              }
              await new Promise((resolve) => setTimeout(resolve, 250))
            }
          })

          pushToast(t.creating, 'info')
          const newSessionId = await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId)

          pushToast(t.starting, 'info')
          let resumeWarning = ''
          await ctx.sessions.using(newSessionId, { source: 'controllerOperation' }, async (reference) => {
            // `--wake` injects the brief and starts the model turn from the
            // command handler, so the first visible input is the collapsed
            // command result instead of a long user prompt.
            // `--latest` targets the task this flow just wrote.
            try {
              const resumed = await reference.binding.session.command('/handoff resume --latest --wake')
              resumeWarning = commandFailure(resumed) ?? ''
            } catch (error) {
              resumeWarning = error instanceof Error ? error.message : String(error)
            }
            if (resumeWarning.length > 0) {
              // Fallback only when the command could not wake the model.
              const result = await reference.binding.session.prompt(
                [{ type: 'text', text: t.prompt(workspace.path ?? '') }],
                'queue',
              )
              if (result?.ok === false) throw new Error(result.error?.message ?? 'prompt failed')
            }
          })

          ctx.uiWorkspace.openSession(newSessionId)
          if (resumeWarning.length > 0) {
            pushToast(`${t.done}；${t.resumeWarn}: ${resumeWarning}`, 'error', 10000)
          } else {
            pushToast(t.done, 'success', 5000)
          }
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
