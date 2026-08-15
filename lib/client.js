/**
 * dsh-plugin-vision — browser client half.
 *
 * Loaded by the DSH web app through the package's `dsh.client` declaration
 * (see package.json). Registered via the module loader as a standard Cordis
 * client plugin:
 *   - conversation.input.left  : a small image-attach button (🖼️)
 *   - conversation.input.dock  : native-style attachment cards with thumbnails
 *   - global paste / drop interception on the page
 *
 * Pasted images are POSTed to the host's `/vision/save-image` route
 * (registered by the host half via ctx.webServer) and saved to the session
 * workspace; the returned path is appended to the composer draft — the model
 * then analyzes it with the `see_image` tool.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-vision',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    // Inline styles use the app's theme tokens, so the UI matches light/dark.
    var S = {
      leftBtn: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 6, border: 'none',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
      },
      row: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '6px 10px', borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
      },
      card: {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 6px 3px 3px', borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)',
        maxWidth: 280,
      },
      thumb: { width: 34, height: 34, borderRadius: 6, objectFit: 'cover', display: 'block' },
      name: {
        fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160,
      },
      x: {
        border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer', fontSize: 12, padding: '2px 5px', borderRadius: 4, lineHeight: 1,
      },
      hint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      add: {
        fontSize: 12, padding: '3px 8px', borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
      },
      busy: {
        fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '6px 10px', borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
      },
      err: {
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
        color: 'var(--dsw-alias-state-error-primary)', padding: '6px 10px', borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
      },
    };

    function readAsDataURL(file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result)); };
        fr.onerror = function () { reject(new Error('读取文件失败')); };
        fr.readAsDataURL(file);
      });
    }

    /** POST one pasted image to the host route; returns { path, mime }. */
    async function saveImage(payload) {
      var res = await fetch('/vision/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok || !data || !data.path) {
        throw new Error((data && data.error) || ('保存失败 (HTTP ' + res.status + ')'));
      }
      return data;
    }

    exports.name = 'dsh-plugin-vision';
    exports.inject = ['timer'];
    exports.apply = function (ctx) {
      var slots = ctx.get('slots');
      if (slots === undefined) return;

      var store = { draft: '', items: [], busy: false, error: null, inputActions: null, sessionId: '' };
      var storeListeners = new Set();
      function setStore(patch) {
        for (var k in patch) store[k] = patch[k];
        storeListeners.forEach(function (fn) { fn(); });
      }
      function subscribeStore(fn) { storeListeners.add(fn); return function () { storeListeners.delete(fn); }; }

      async function handleFile(file) {
        if (!file) return;
        var mime = (file.type || '').toLowerCase();
        if (mime.indexOf('image/') !== 0) return;
        setStore({ busy: true, error: null });
        try {
          var dataUrl = await readAsDataURL(file);
          var res = await saveImage({
            name: file.name || 'image',
            mime: mime,
            dataUrl: dataUrl,
            sessionId: store.sessionId,
          });
          var path = res.path;
          var id = 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
          var line = '【图片】' + path;
          var items = store.items.slice().concat([{ id: id, path: path, line: line, name: file.name || '图片', thumb: dataUrl, confirmed: false }]);
          var nextDraft = store.draft.trim() ? store.draft + '\n' + line : line;
          setStore({ items: items, busy: false, draft: nextDraft });
          if (store.inputActions && typeof store.inputActions.setDraft === 'function') {
            store.inputActions.setDraft(nextDraft);
          }
          try { var ta = document.querySelector('textarea'); if (ta) ta.focus(); } catch (e) { /* best effort */ }
        } catch (err) {
          setStore({ busy: false, error: (err && err.message) ? err.message : String(err) });
        }
      }

      function removeImage(id) {
        var item = null;
        for (var i = 0; i < store.items.length; i += 1) {
          if (store.items[i].id === id) { item = store.items[i]; break; }
        }
        var items = store.items.filter(function (x) { return x.id !== id; });
        var draft = store.draft;
        if (item) {
          draft = draft.split('\n').filter(function (l) { return l !== item.line; }).join('\n')
            .replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
        }
        setStore({ items: items, draft: draft });
        if (store.inputActions && typeof store.inputActions.setDraft === 'function') {
          store.inputActions.setDraft(draft);
        }
      }

      function useStoreTick() {
        var tick = React.useState(0);
        React.useEffect(function () {
          return subscribeStore(function () { tick[1](function (x) { return x + 1; }); });
        }, []);
        return tick[0];
      }

      function VisionLeftButton(props) {
        useStoreTick();
        var fileRef = React.useRef(null);
        store.sessionId = props.sessionId || '';
        store.inputActions = props.inputActions;
        return React.createElement(React.Fragment, null,
          React.createElement('button', {
            type: 'button', style: S.leftBtn, title: '添加图片，AI 将通过 Gemini/GLM 查看',
            onClick: function () { if (fileRef.current) fileRef.current.click(); },
          }, '🖼️'),
          React.createElement('input', {
            type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' },
            ref: function (el) { fileRef.current = el; },
            onChange: function (e) {
              var files = e.target && e.target.files;
              if (files) { for (var i = 0; i < files.length; i += 1) handleFile(files[i]); }
              e.target.value = '';
            },
          })
        );
      }

      function VisionDock(props) {
        useStoreTick();
        var addRef = React.useRef(null);
        store.sessionId = props.sessionId || '';
        store.inputActions = props.inputActions;
        var useInput = props.useInput;
        var draft = useInput ? useInput(function (s) { return (s && typeof s.draft === 'string') ? s.draft : ''; }) : '';
        store.draft = draft;

        var liveItems = [];
        for (var i = 0; i < store.items.length; i += 1) {
          var it = store.items[i];
          var present = draft.indexOf(it.line) >= 0;
          if (present && !it.confirmed) it.confirmed = true;
          if (it.confirmed && !present) continue;
          liveItems.push(it);
        }
        if (liveItems.length !== store.items.length) store.items = liveItems;

        React.useEffect(function () {
          function onPaste(e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            var file = null;
            for (var i = 0; i < items.length; i += 1) {
              var it = items[i];
              if (it && it.kind === 'file' && it.type && it.type.toLowerCase().indexOf('image/') === 0) {
                var f = it.getAsFile();
                if (f) { file = f; break; }
              }
            }
            if (!file) return;
            e.preventDefault(); e.stopPropagation(); handleFile(file);
          }
          function onDrop(e) {
            var files = e.dataTransfer && e.dataTransfer.files;
            if (!files || files.length === 0) return;
            var picked = [];
            for (var i = 0; i < files.length; i += 1) {
              if (files[i] && files[i].type && files[i].type.toLowerCase().indexOf('image/') === 0) picked.push(files[i]);
            }
            if (picked.length === 0) return;
            e.preventDefault(); e.stopPropagation();
            for (var j = 0; j < picked.length; j += 1) handleFile(picked[j]);
          }
          function onDragOver(e) {
            var dt = e.dataTransfer;
            if (!dt || !dt.types) return;
            for (var i = 0; i < dt.types.length; i += 1) {
              if (dt.types[i] === 'Files') { e.preventDefault(); return; }
            }
          }
          window.addEventListener('paste', onPaste, true);
          window.addEventListener('drop', onDrop, true);
          window.addEventListener('dragover', onDragOver, true);
          return function () {
            window.removeEventListener('paste', onPaste, true);
            window.removeEventListener('drop', onDrop, true);
            window.removeEventListener('dragover', onDragOver, true);
          };
        }, []);

        if (store.busy && liveItems.length === 0 && !store.error) {
          return React.createElement('div', { style: S.busy }, '正在处理图片…');
        }
        if (store.error && liveItems.length === 0) {
          return React.createElement('div', { style: S.err },
            React.createElement('span', null, '图片保存失败：' + store.error),
            React.createElement('button', { type: 'button', style: S.add, onClick: function () { setStore({ error: null }); } }, '关闭')
          );
        }
        if (liveItems.length === 0) return null;
        return React.createElement('div', { style: S.row },
          liveItems.map(function (it) {
            return React.createElement('div', { key: it.id, style: S.card },
              React.createElement('img', { src: it.thumb, alt: it.name, style: S.thumb }),
              React.createElement('span', { style: S.name, title: it.path }, it.name),
              React.createElement('button', { type: 'button', style: S.x, title: '移除图片', onClick: function () { removeImage(it.id); } }, '✕')
            );
          }),
          React.createElement('span', { style: S.hint }, '图片已附加，输入问题后按 Enter 发送'),
          React.createElement('button', {
            type: 'button', style: S.add, title: '继续添加图片',
            onClick: function () { if (addRef.current) addRef.current.click(); },
          }, '＋添加'),
          React.createElement('input', {
            type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' },
            ref: function (el) { addRef.current = el; },
            onChange: function (e) {
              var files = e.target && e.target.files;
              if (files) { for (var i = 0; i < files.length; i += 1) handleFile(files[i]); }
              e.target.value = '';
            },
          })
        );
      }

      slots.inject('conversation.input.left', function () {
        return slots.register(
          { name: 'conversation.input.left', id: 'vision-image-btn', order: 0, label: '添加图片' },
          function (props) { return React.createElement(VisionLeftButton, Object.assign({}, props)); }
        );
      });
      slots.inject('conversation.input.dock', function () {
        return slots.register(
          { name: 'conversation.input.dock', id: 'vision-image', order: 30, label: '图片附件' },
          function (props) { return React.createElement(VisionDock, Object.assign({}, props)); }
        );
      });
    };

    module.exports = exports;
  },
});
