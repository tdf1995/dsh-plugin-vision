/**
 * dsh-plugin-vision — 可选伴侣：粘贴/拖入图片 → 附件卡片（动态插件形式）
 *
 * 为什么需要它：
 *   社区包 `dsh-plugin-vision` 本身是 host-only（模型工具），不携带浏览器半区——
 *   因为外部包的客户端→宿主 RPC 端点需要平台级白名单，无法随 npm 包分发。
 *   这个文件用 DSH 会话的「动态 Cordis 插件」机制补上浏览器粘贴体验：
 *     粘贴/拖入图片 → Host 保存到工作区 → 输入框上方显示原生风格附件卡片
 *     （不自动发送）→ 你输入问题按 Enter → 模型用 see_image 看图。
 *
 * 用法（Web UI 的 Cordis 插件面板）：
 *   1. 新建插件，把下方「HOST 半区」贴进 Host 代码框，「CLIENT 半区」贴进 Client 代码框；
 *   2. 运行（首次需要批准；建议勾选双勾，以后免批准）；
 *   3. 若同时安装了 npm 包 dsh-plugin-vision，工具由包提供、本插件只做粘贴。
 *      若没有安装包，把 lib/index.js 的工具注册逻辑并入 HOST 半区即可。
 *
 * 注意：动态插件随会话存在，DSH 重启后需要重新加载（npm 包是持久的）。
 */

/* ================================================================
 * HOST 半区（粘贴到「Host 代码」框）
 * ================================================================
 */
return {
  inject: ['fs', 'shell', 'timer'],
  apply(ctx) {
    const fs = ctx.fs
    const shell = ctx.shell

    const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

    function resolvePolicy() {
      const policy = ctx.get('sandboxPolicy')
      if (policy === undefined) return undefined
      let session = undefined
      const agents = ctx.get('agents')
      if (agents !== undefined) {
        try {
          const agent = agents.currentInitiator()
          if (agent && agent.session) session = agent.session
        } catch (e) { session = undefined }
      }
      try {
        return policy.resolve(session !== undefined ? { session: session } : {})
      } catch (e) {
        return undefined
      }
    }

    function resolvePolicyFor(sessionId) {
      const policy = ctx.get('sandboxPolicy')
      if (policy === undefined) return undefined
      let session = undefined
      if (typeof sessionId === 'string' && sessionId) {
        const sessions = ctx.get('sessions')
        if (sessions !== undefined) {
          try { session = sessions.get(sessionId) } catch (e) { session = undefined }
        }
      }
      if (session === undefined) return resolvePolicy()
      try {
        return policy.resolve({ session: session })
      } catch (e) {
        return resolvePolicy()
      }
    }

    ctx.effect(() => harness.handle('vision:save-image', async (args) => {
      const policy = resolvePolicyFor(args && args.sessionId)
      const workspaceRoot = policy && policy.workspaceRoot ? policy.workspaceRoot : undefined
      const mime = String((args && args.mime) || '')
      const dataUrl = String((args && args.dataUrl) || '')
      if (mime.indexOf('image/') !== 0) throw new Error('仅支持图片（png/jpg/webp/gif）')
      const ext = EXT[mime]
      if (!ext) throw new Error('不支持的图片类型: ' + mime)
      const comma = dataUrl.indexOf(',')
      if (comma < 0) throw new Error('无效的图片数据')
      const b64 = dataUrl.slice(comma + 1).trim()
      if (!b64) throw new Error('图片数据为空')
      if (b64.length > 30 * 1024 * 1024) throw new Error('图片过大（超过约 20MB）')
      let rawName = String((args && args.name) || 'image').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 60) || 'image'
      const nameDot = rawName.lastIndexOf('.')
      if (nameDot > 0) rawName = rawName.slice(0, nameDot)
      const ts = Date.now()
      const dir = (workspaceRoot ? workspaceRoot : '.') + '/.dsh-vision/uploads'
      const b64Path = dir + '/img-' + ts + '.b64'
      const outPath = dir + '/img-' + ts + '-' + rawName + '.' + ext
      try {
        const b64Target = await fs.resolve(b64Path)
        await fs.writeText(b64Target, b64, undefined, undefined, policy)
      } catch (e) {
        throw new Error('保存图片失败: ' + e.message)
      }
      const command = 'New-Item -ItemType Directory -Force -Path $env:VISION_UP | Out-Null; [System.IO.File]::WriteAllBytes($env:VISION_OUT, [System.Convert]::FromBase64String([System.IO.File]::ReadAllText($env:VISION_B64).Trim())); Remove-Item $env:VISION_B64 -Force'
      let result
      try {
        const spec = shell.resolve({
          command: command,
          env: { VISION_UP: dir, VISION_B64: b64Path, VISION_OUT: outPath },
          timeoutMs: 60000,
          stdoutMaxBytes: 4096,
          sandboxPolicy: policy,
        })
        result = await shell.run(spec)
      } catch (e) {
        throw new Error('图片解码失败: ' + e.message)
      }
      if (result.exitCode !== 0) {
        const errText = result.stderr && result.stderr.text ? result.stderr.text : ''
        throw new Error('图片解码失败 (exit=' + result.exitCode + '): ' + (errText || '未知错误'))
      }
      return { path: outPath, mime: mime }
    }))
  },
}

/* ================================================================
 * CLIENT 半区（粘贴到「Client 代码」框）
 * ================================================================
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(
      '.visn-left-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1;padding:0}' +
      '.visn-left-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}' +
      '.visn-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}' +
      '.visn-card{display:inline-flex;align-items:center;gap:6px;padding:3px 6px 3px 3px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);max-width:280px}' +
      '.visn-card img{width:34px;height:34px;border-radius:6px;object-fit:cover;display:block}' +
      '.visn-name{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}' +
      '.visn-x{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px;line-height:1}' +
      '.visn-x:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary)}' +
      '.visn-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}' +
      '.visn-add{font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}' +
      '.visn-add:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}' +
      '.visn-busy{font-size:12px;color:var(--dsw-alias-label-secondary);padding:6px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}' +
      '.visn-err{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-state-error-primary);padding:6px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}'
    )

    const store = { draft: '', items: [], busy: false, error: null, inputActions: null, sessionId: '' }
    const storeListeners = new Set()
    function setStore(patch) { Object.assign(store, patch); for (const fn of storeListeners) fn() }
    function subscribeStore(fn) { storeListeners.add(fn); return () => { storeListeners.delete(fn) } }

    function readAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(new Error('读取文件失败'))
        fr.readAsDataURL(file)
      })
    }

    async function handleFile(file) {
      if (!file) return
      const mime = (file.type || '').toLowerCase()
      if (mime.indexOf('image/') !== 0) return
      setStore({ busy: true, error: null })
      try {
        const dataUrl = await readAsDataURL(file)
        const res = await host.call('vision:save-image', { name: file.name || 'image', mime: mime, dataUrl: dataUrl, sessionId: store.sessionId })
        const path = res && res.path ? res.path : ''
        if (!path) throw new Error('未返回图片路径')
        const id = 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
        const line = '【图片】' + path
        const items = store.items.slice().concat([{ id: id, path: path, line: line, name: file.name || '图片', thumb: dataUrl, confirmed: false }])
        const nextDraft = store.draft.trim() ? store.draft + '\n' + line : line
        setStore({ items: items, busy: false, draft: nextDraft })
        if (store.inputActions && typeof store.inputActions.setDraft === 'function') store.inputActions.setDraft(nextDraft)
        try { const ta = document.querySelector('textarea'); if (ta) ta.focus() } catch (e) { /* best effort */ }
      } catch (err) {
        setStore({ busy: false, error: (err && err.message) ? err.message : String(err) })
      }
    }

    function removeImage(id) {
      const item = store.items.find((x) => x.id === id)
      const items = store.items.filter((x) => x.id !== id)
      let draft = store.draft
      if (item) draft = draft.split('\n').filter((l) => l !== item.line).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
      setStore({ items: items, draft: draft })
      if (store.inputActions && typeof store.inputActions.setDraft === 'function') store.inputActions.setDraft(draft)
    }

    function useStoreTick() {
      const [tick, setTick] = React.useState(0)
      React.useEffect(() => subscribeStore(() => setTick((x) => x + 1)), [])
      return tick
    }

    function VisionLeftButton(props) {
      useStoreTick()
      const fileRef = React.useRef(null)
      store.sessionId = props.sessionId || ''
      store.inputActions = props.inputActions
      return React.createElement(React.Fragment, null,
        React.createElement('button', {
          type: 'button', className: 'visn-left-btn', title: '添加图片，AI 将通过 Gemini/GLM 查看',
          onClick: () => { if (fileRef.current) fileRef.current.click() },
        }, '🖼️'),
        React.createElement('input', {
          type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' },
          ref: (el) => { fileRef.current = el },
          onChange: (e) => {
            const files = e.target && e.target.files
            if (files) { for (let i = 0; i < files.length; i += 1) handleFile(files[i]) }
            e.target.value = ''
          },
        }),
      )
    }

    function VisionDock(props) {
      useStoreTick()
      const addRef = React.useRef(null)
      store.sessionId = props.sessionId || ''
      store.inputActions = props.inputActions
      const useInput = props.useInput
      const draft = useInput ? useInput((s) => (s && typeof s.draft === 'string' ? s.draft : '')) : ''
      store.draft = draft
      const liveItems = []
      for (const it of store.items) {
        const present = draft.indexOf(it.line) >= 0
        if (present && !it.confirmed) it.confirmed = true
        if (it.confirmed && !present) continue
        liveItems.push(it)
      }
      if (liveItems.length !== store.items.length) store.items = liveItems

      React.useEffect(() => {
        function onPaste(e) {
          const items = e.clipboardData && e.clipboardData.items
          if (!items) return
          let file = null
          for (let i = 0; i < items.length; i += 1) {
            const it = items[i]
            if (it && it.kind === 'file' && it.type && it.type.toLowerCase().indexOf('image/') === 0) {
              const f = it.getAsFile()
              if (f) { file = f; break }
            }
          }
          if (!file) return
          e.preventDefault(); e.stopPropagation(); handleFile(file)
        }
        function onDrop(e) {
          const files = e.dataTransfer && e.dataTransfer.files
          if (!files || files.length === 0) return
          const picked = []
          for (let i = 0; i < files.length; i += 1) {
            if (files[i] && files[i].type && files[i].type.toLowerCase().indexOf('image/') === 0) picked.push(files[i])
          }
          if (picked.length === 0) return
          e.preventDefault(); e.stopPropagation()
          for (const f of picked) handleFile(f)
        }
        function onDragOver(e) {
          const dt = e.dataTransfer
          if (!dt || !dt.types) return
          for (let i = 0; i < dt.types.length; i += 1) { if (dt.types[i] === 'Files') { e.preventDefault(); return } }
        }
        window.addEventListener('paste', onPaste, true)
        window.addEventListener('drop', onDrop, true)
        window.addEventListener('dragover', onDragOver, true)
        return () => {
          window.removeEventListener('paste', onPaste, true)
          window.removeEventListener('drop', onDrop, true)
          window.removeEventListener('dragover', onDragOver, true)
        }
      }, [])

      if (store.busy && liveItems.length === 0 && !store.error) {
        return React.createElement('div', { className: 'visn-busy' }, '正在处理图片…')
      }
      if (store.error && liveItems.length === 0) {
        return React.createElement('div', { className: 'visn-err' },
          React.createElement('span', null, '图片保存失败：' + store.error),
          React.createElement('button', { type: 'button', className: 'visn-add', onClick: () => setStore({ error: null }) }, '关闭'),
        )
      }
      if (liveItems.length === 0) return null
      return React.createElement('div', { className: 'visn-row' },
        liveItems.map((it) => React.createElement('div', { key: it.id, className: 'visn-card' },
          React.createElement('img', { src: it.thumb, alt: it.name }),
          React.createElement('span', { className: 'visn-name', title: it.path }, it.name),
          React.createElement('button', { type: 'button', className: 'visn-x', title: '移除图片', onClick: () => removeImage(it.id) }, '✕'),
        )),
        React.createElement('span', { className: 'visn-hint' }, '图片已附加，输入问题后按 Enter 发送'),
        React.createElement('button', { type: 'button', className: 'visn-add', title: '继续添加图片', onClick: () => { if (addRef.current) addRef.current.click() } }, '＋添加'),
        React.createElement('input', {
          type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' },
          ref: (el) => { addRef.current = el },
          onChange: (e) => {
            const files = e.target && e.target.files
            if (files) { for (let i = 0; i < files.length; i += 1) handleFile(files[i]) }
            e.target.value = ''
          },
        }),
      )
    }

    slots.inject('conversation.input.left', () => slots.register(
      { name: 'conversation.input.left', id: 'vision-image-btn', order: 0, label: '添加图片' },
      (props) => React.createElement(VisionLeftButton, Object.assign({}, props)),
    ))
    slots.inject('conversation.input.dock', () => slots.register(
      { name: 'conversation.input.dock', id: 'vision-image', order: 30, label: '图片附件' },
      (props) => React.createElement(VisionDock, Object.assign({}, props)),
    ))
  },
}
