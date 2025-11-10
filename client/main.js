// client/main.js
// App bootstrap: UI wiring, modal for joining/creating rooms, and safe WS event chaining.

(function () {
  // --- tiny helpers ---
  function getParam(name, fallback = null) {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get(name) || fallback;
    } catch (err) {
      return fallback;
    }
  }

  function $(id) { return document.getElementById(id); }

  async function writeClipboard(text) {
    if (!text) return Promise.reject(new Error('No text provided'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('execCommand returned false'));
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  // attach an additional global handler while preserving existing one
  function appendGlobal(fnName, fn) {
    const previous = window[fnName];
    window[fnName] = function (...args) {
      try { if (typeof previous === 'function') previous(...args); } catch (e) { console.error(e); }
      try { fn(...args); } catch (e) { console.error(e); }
    };
  }

  // --- DOM refs ---
  const colInp = $('color');
  const sizeInp = $('size');
  const btnBrush = $('brush');
  const btnEraser = $('eraser');
  const btnUndo = $('undo');
  const btnRedo = $('redo');
  const statusEl = $('status');
  const usersEl = $('users');
  const btnShare = $('share-room');

  // --- UI utilities ---
  function showStatus(text, error = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = error ? 'crimson' : '';
  }

  function listUsers(arr) {
    if (!usersEl) return;
    usersEl.innerHTML = '';
    (arr || []).forEach(u => {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.alignItems = 'center';
      const myId = window.WS && window.WS.socket && window.WS.socket.id ? window.WS.socket.id : null;
      const label = (u.id === myId) ? 'You' : `User ${String(u.id || '').slice(0,6)}`;
      li.appendChild(document.createTextNode(label + (u.name ? ` (${u.name})` : '')));

      const swatch = document.createElement('span');
      swatch.style.width = '12px';
      swatch.style.height = '12px';
      swatch.style.display = 'inline-block';
      swatch.style.borderRadius = '2px';
      swatch.style.marginLeft = '8px';
      swatch.style.background = u.color || '#000';
      li.appendChild(swatch);

      usersEl.appendChild(li);
    });
  }

  // --- initialize drawing app (external module) ---
  if (!window.CanvasApp) {
    console.error('Missing CanvasApp (canvas.js).');
  } else {
    try { CanvasApp.init(); } catch (err) { console.error('CanvasApp.init failed', err); }
  }

  // --- wire controls ---
  if (colInp) {
    colInp.addEventListener('input', (e) => CanvasApp.setColor(e.target.value));
    try { CanvasApp.setColor(colInp.value); } catch (e) {}
  }

  if (sizeInp) {
    sizeInp.addEventListener('input', (e) => CanvasApp.setSize(e.target.value));
    try { CanvasApp.setSize(sizeInp.value); } catch (e) {}
  }

  if (btnBrush) {
    btnBrush.addEventListener('click', () => {
      CanvasApp.setTool('brush');
      btnBrush.classList.add('active');
      btnEraser && btnEraser.classList.remove('active');
    });
    btnBrush.classList.add('active');
  }

  if (btnEraser) {
    btnEraser.addEventListener('click', () => {
      CanvasApp.setTool('eraser');
      btnEraser.classList.add('active');
      btnBrush && btnBrush.classList.remove('active');
    });
  }

  if (btnUndo) {
    btnUndo.addEventListener('click', () => { window.WS && window.WS.sendUndo && window.WS.sendUndo(); });
  }

  if (btnRedo) {
    btnRedo.addEventListener('click', () => { window.WS && window.WS.sendRedo && window.WS.sendRedo(); });
  }

  // --- share-invite ---
  if (btnShare) {
    btnShare.addEventListener('click', async () => {
      const room = window.__currentRoom || (new URL(window.location.href)).searchParams.get('room');
      const token = window.__currentToken || (new URL(window.location.href)).searchParams.get('token');
      const invite = room ? `${location.protocol}//${location.host}/?room=${encodeURIComponent(room)}${token ? `&token=${encodeURIComponent(token)}` : ''}` : window.location.href;
      try {
        await writeClipboard(invite);
        const prev = statusEl && statusEl.textContent;
        showStatus('Invite copied!');
        setTimeout(() => showStatus(prev || 'Connected'), 1400);
      } catch (err) {
        alert('Unable to copy. Here is the invite:\n' + invite);
      }
    });
  }

  // --- modal and connection flow ---
  (function modalConnect() {
    const urlRoom = getParam('room', null);
    const urlToken = (function () { try { return new URL(window.location.href).searchParams.get('token'); } catch (e) { return null; } })();

    function redirectTo(room, token) {
      const href = `/?room=${encodeURIComponent(room)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
      window.location.href = href;
    }

    function parseInput(text) {
      if (!text) return null;
      text = text.trim();
      try {
        if (text.startsWith('http://') || text.startsWith('https://') || text.includes('room=')) {
          const u = new URL(text, window.location.origin);
          const r = u.searchParams.get('room') || u.searchParams.get('r') || null;
          const t = u.searchParams.get('token') || u.searchParams.get('t') || null;
          if (r) return { room: r, token: t };
        }
      } catch (e) {
        // ignore
      }
      const parts = text.split(/[,\s]+/).filter(Boolean);
      if (parts.length === 2) return { room: parts[0], token: parts[1] };
      return { room: text, token: null };
    }

    async function connectTo(room, token) {
      showStatus('Connecting...');
      window.__currentRoom = room;
      window.__currentToken = token || null;

      if (!window.WS) {
        console.error('WS wrapper missing.');
        showStatus('No WS', true);
        return;
      }
      try {
        if (WS.connect.length >= 2) {
          WS.connect(room, token);
        } else {
          try { WS.connect(room, token); } catch (e) { WS.connect(room); }
        }
      } catch (err) {
        console.warn('WS.connect failed; falling back to redirect', err);
        redirectTo(room, token);
      }
    }

    if (urlRoom) {
      connectTo(urlRoom, urlToken);
      return;
    }

    const modal = $('room-modal');
    const inviteFld = $('invite-input');
    const btnJoin = $('btn-join-link');
    const btnCreate = $('btn-create-room');
    const inviteArea = $('invite-area');
    const inviteUrl = $('invite-url');
    const inviteTip = $('invite-tip');
    const copyBtn = $('btn-copy-invite');
    const enterBtn = $('btn-enter-room');
    const msgBox = $('modal-msg');

    if (!modal || !inviteFld || !btnJoin || !btnCreate) {
      connectTo('default', null);
      return;
    }

    modal.classList.remove('hidden');
    setTimeout(() => inviteFld.focus(), 150);

    btnJoin.addEventListener('click', () => {
      const raw = inviteFld.value && inviteFld.value.trim();
      if (!raw) {
        msgBox.textContent = 'Please paste an invite URL or a room id.';
        return;
      }
      const parsed = parseInput(raw);
      if (!parsed || !parsed.room) {
        msgBox.textContent = 'Could not parse invite. Paste the full URL or a room id.';
        return;
      }
      msgBox.textContent = '';
      modal.classList.add('hidden');
      connectTo(parsed.room, parsed.token);
    });

    inviteFld.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') btnJoin.click();
    });

    btnCreate.addEventListener('click', async () => {
      btnCreate.disabled = true;
      const origText = btnCreate.textContent;
      btnCreate.textContent = 'Creating...';
      msgBox.textContent = 'Creating private room...';
      try {
        const resp = await fetch('/create-room');
        const json = await resp.json();
        if (!json || !json.ok) {
          msgBox.textContent = 'Failed to create room. Try again.';
          btnCreate.disabled = false;
          btnCreate.textContent = origText;
          return;
        }
        inviteUrl.value = json.url;
        inviteArea.style.display = 'block';
        msgBox.textContent = '';
        inviteTip.textContent = 'Attempting to copy invite...';
        try {
          await writeClipboard(json.url);
          inviteTip.textContent = 'Invite copied to clipboard! Share it with collaborators.';
        } catch (err) {
          inviteTip.textContent = 'Invite created — click Copy to copy the URL.';
        }

        copyBtn.onclick = async () => {
          try { await writeClipboard(inviteUrl.value); inviteTip.textContent = 'Copied to clipboard!'; }
          catch (e) { inviteTip.textContent = 'Copy failed — select and copy manually.'; }
        };

        enterBtn.onclick = () => { window.location.href = inviteUrl.value; };
      } catch (err) {
        console.error(err);
        msgBox.textContent = 'Error creating room. See console.';
        btnCreate.disabled = false;
        btnCreate.textContent = origText;
      }
    });
  })();

  // --- websocket event wiring (safe chaining) ---
  appendGlobal('onSocketConnect', (id) => {
    showStatus('Connected');
    console.info('Socket id:', id);
    try {
      if (window.WS && window.WS.socket && window.WS.socket.emit) {
        window.WS.socket.emit('request-users');
      }
    } catch (e) {
      console.warn('request-users failed', e);
    }
  });

  appendGlobal('onSocketDisconnect', (reason) => {
    showStatus('Disconnected', true);
    console.warn('Socket disconnected:', reason);
  });

  appendGlobal('onInitState', (data) => {
    try {
      if (data && data.ops) CanvasApp.loadRemoteState(data.ops);
      if (data && data.users) listUsers(data.users);
    } catch (e) { console.error('init-state error', e); }
  });

  appendGlobal('onRemoteDraw', (op) => {
    try { CanvasApp.applyRemoteOp(op); } catch (e) { console.error('apply remote op', e); }
  });

  appendGlobal('onRemoteCursor', (c) => {
    // reserved for top-level cursor analytics if needed
  });

  appendGlobal('onUsers', (users) => {
    try { listUsers(users); } catch (e) { console.error('render users error', e); }
  });

  // robust duplicate: allow websocket.js to dispatch a DOM event with fresh users
  window.addEventListener('users-updated', (ev) => {
    try { listUsers(ev.detail); } catch (e) { console.error('users-updated handler error', e); }
  });

  appendGlobal('onUndoRedo', (payload) => {
    try { CanvasApp.applyUndoRedo(payload); } catch (e) { console.error('undo/redo error', e); }
  });

  appendGlobal('onOpAck', (ack) => {
    // optional acknowledgement handler
  });

  appendGlobal('onJoinError', (p) => {
    try {
      const msg = p && p.message ? p.message : 'Failed to join room (invalid token?)';
      alert(msg);
    } catch (e) { console.error(e); }
  });

  // --- keyboard shortcuts ---
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      window.WS && window.WS.sendUndo && window.WS.sendUndo();
    } else if ((ev.key === 'y' && (ev.ctrlKey || ev.metaKey)) || (ev.key === 'Z' && ev.ctrlKey && ev.shiftKey)) {
      ev.preventDefault();
      window.WS && window.WS.sendRedo && window.WS.sendRedo();
    } else if (ev.key === 'b') {
      CanvasApp.setTool('brush');
      btnBrush && btnBrush.classList.add('active');
      btnEraser && btnEraser.classList.remove('active');
    } else if (ev.key === 'e') {
      CanvasApp.setTool('eraser');
      btnEraser && btnEraser.classList.add('active');
      btnBrush && btnBrush.classList.remove('active');
    }
  });

  // small debug helper
  window.__app = { setRoom: (r) => window.WS && window.WS.switchRoom && window.WS.switchRoom(r) };

})(); // IIFE end
