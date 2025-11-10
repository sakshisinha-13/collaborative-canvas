window.cursorsReady = true;
(function (host) {
  const overlay = document.querySelector('#cursor-layer');
  if (!overlay) {
    console.warn('No #cursor-layer element found — remote cursors disabled.');
    return;
  }

  const canvasEl = document.querySelector('#draw-canvas');
  const entries = new Map();
  const usersMeta = new Map();
  const STALE_MS = 2500;
  const REMOVE_MS = 9000;

  function makeNode(uid, { color = '#000', label = null } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'remote-cursor';
    wrapper.dataset.uid = uid;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = color;
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = label || String(uid).slice(0, 6);
    wrapper.appendChild(dot);
    wrapper.appendChild(lbl);
    overlay.appendChild(wrapper);
    return { wrapper, dot, lbl };
  }

  function getCanvasRectSafe() {
    if (!canvasEl) return { left: 0, top: 0, width: 0, height: 0 };
    return canvasEl.getBoundingClientRect();
  }

  function showCursor(uid, x, y, opts = {}) {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const rect = getCanvasRectSafe();
    let e = entries.get(uid);
    if (!e) {
      const parts = makeNode(uid, { color: opts.color || '#000', label: opts.label });
      e = {
        node: parts.wrapper,
        dot: parts.dot,
        lbl: parts.lbl,
        lastSeen: Date.now(),
        color: opts.color || '#000',
        label: opts.label || String(uid).slice(0, 6),
        idleTimer: null,
        removeTimer: null
      };
      entries.set(uid, e);
    } else {
      if (opts.color && opts.color !== e.color) {
        e.color = opts.color;
        e.dot.style.background = opts.color;
      }
      if (opts.label && opts.label !== e.label) {
        e.label = opts.label;
        e.lbl.textContent = opts.label;
      }
      e.lastSeen = Date.now();
      if (e.removeTimer) {
        clearTimeout(e.removeTimer);
        e.removeTimer = null;
      }
    }
    e.node.style.left = `${x}px`;
    e.node.style.top = `${y}px`;
    e.node.classList.remove('idle');
    scheduleTimers(uid);
  }

  function scheduleTimers(uid) {
    const e = entries.get(uid);
    if (!e) return;
    if (e.idleTimer) clearTimeout(e.idleTimer);
    if (e.removeTimer) clearTimeout(e.removeTimer);
    e.idleTimer = setTimeout(() => {
      if (e.node) e.node.classList.add('idle');
    }, STALE_MS);
    e.removeTimer = setTimeout(() => {
      removeCursor(uid);
    }, REMOVE_MS);
  }

  function removeCursor(uid) {
    const e = entries.get(uid);
    if (!e) return;
    try {
      e.node && e.node.parentNode && e.node.parentNode.removeChild(e.node);
    } catch (err) {}
    if (e.idleTimer) clearTimeout(e.idleTimer);
    if (e.removeTimer) clearTimeout(e.removeTimer);
    entries.delete(uid);
  }

  function updateUsers(list) {
    (list || []).forEach(u => {
      usersMeta.set(u.id, { color: u.color || '#000', label: u.name || String(u.id).slice(0, 6) });
    });
    const present = new Set((list || []).map(u => u.id));
    Array.from(entries.keys()).forEach(uid => {
      if (!present.has(uid)) removeCursor(uid);
    });
  }

  function handleRemoteCursor(msg) {
    if (!msg || typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
    const uid = msg.userId || msg.id || 'remote';
    const meta = usersMeta.get(uid) || {};
    showCursor(uid, msg.x, msg.y, { color: msg.color || meta.color, label: msg.label || meta.label });
  }

  host._cursors = host._cursors || {};
  host._cursors.showCursor = showCursor;
  host._cursors.removeCursor = removeCursor;
  host._cursors.updateUsers = updateUsers;

  (function chainHandlers() {
    const prevOnUsers = host.onUsers;
    host.onUsers = function (list) {
      try { if (typeof prevOnUsers === 'function') prevOnUsers(list); } catch (e) { console.error(e); }
      try { updateUsers(list); } catch (e) { console.error(e); }
    };
    const prevOnRemoteCursor = host.onRemoteCursor;
    host.onRemoteCursor = function (c) {
      try { if (typeof prevOnRemoteCursor === 'function') prevOnRemoteCursor(c); } catch (e) { console.error(e); }
      try { handleRemoteCursor(c); } catch (e) { console.error(e); }
    };
  })();

  window.addEventListener('resize', () => {});
})(window);
