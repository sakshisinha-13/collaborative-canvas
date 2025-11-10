(function (global) {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas) throw new Error('Canvas element #draw-canvas not found');
  const ctx = canvas.getContext('2d');
  const offscreen = document.createElement('canvas');
  const offCtx = offscreen.getContext('2d');
  let w = 0, h = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    canvas.width = w;
    canvas.height = h;
    offscreen.width = w;
    offscreen.height = h;
    replayAll();
  }

  function debounce(fn, t) {
    let id;
    return function () {
      clearTimeout(id);
      id = setTimeout(() => fn.apply(this, arguments), t);
    };
  }

  window.addEventListener('resize', debounce(resize, 150));
  function now() { return Date.now(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  const ops = [];
  const undoneStack = [];
  let drawing = false;
  let currentPoints = [];
  let currentTool = 'brush';
  let currentColor = '#000000';
  let currentSize = 4;
  let lastPointSend = 0;
  const POINT_SEND_THROTTLE_MS = 40;

  function drawStrokeOnContext(ctxToUse, op) {
    if (!op || !op.points || op.points.length === 0) return;
    ctxToUse.save();
    if (op.tool === 'eraser') {
      ctxToUse.globalCompositeOperation = 'destination-out';
      ctxToUse.lineWidth = op.size;
    } else {
      ctxToUse.globalCompositeOperation = 'source-over';
      ctxToUse.strokeStyle = op.color || '#000';
      ctxToUse.lineWidth = op.size;
      ctxToUse.lineCap = 'round';
      ctxToUse.lineJoin = 'round';
    }
    const pts = op.points;
    if (pts.length === 1) {
      ctxToUse.beginPath();
      ctxToUse.arc(pts[0].x, pts[0].y, Math.max(1, op.size / 2), 0, Math.PI * 2);
      ctxToUse.fillStyle = op.color || '#000';
      ctxToUse.fill();
      ctxToUse.restore();
      return;
    }
    ctxToUse.beginPath();
    ctxToUse.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const mx = (prev.x + cur.x) / 2;
      const my = (prev.y + cur.y) / 2;
      ctxToUse.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctxToUse.stroke();
    ctxToUse.restore();
  }

  function replayAll() {
    offCtx.clearRect(0, 0, w, h);
    for (const op of ops) {
      if (!op.deleted) drawStrokeOnContext(offCtx, op);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(offscreen, 0, 0);
  }

  function findOp(id) {
    return ops.find(o => o.id === id);
  }

  function getPosFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    } else {
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  }

  function makeClientOpId() {
    return `c-${now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function handleStart(e) {
    if (e.cancelable) e.preventDefault();
    drawing = true;
    currentPoints = [];
    const p = getPosFromEvent(e);
    p.t = now();
    currentPoints.push(p);
    const op = {
      id: makeClientOpId(),
      userId: (WS && WS.socket && WS.socket.id) ? WS.socket.id : 'local',
      type: 'stroke',
      tool: currentTool,
      color: currentColor,
      size: currentSize,
      points: currentPoints.slice(),
      deleted: false
    };
    ops.push(op);
    replayAll();
    drawStrokeOnContext(ctx, op);
    if (WS && WS.sendDraw) {
      WS.sendDraw({
        id: op.id,
        userId: op.userId,
        tool: op.tool,
        color: op.color,
        size: op.size,
        points: [p]
      });
    }
  }

  function handleMove(e) {
    if (!drawing) return;
    if (e.cancelable) e.preventDefault();
    const p = getPosFromEvent(e);
    p.t = now();
    currentPoints.push(p);
    const lastOp = ops[ops.length - 1];
    if (lastOp) lastOp.points = currentPoints.slice();
    replayAll();
    if (lastOp) drawStrokeOnContext(ctx, lastOp);
    const tNow = now();
    if (tNow - lastPointSend > POINT_SEND_THROTTLE_MS) {
      lastPointSend = tNow;
      if (WS && WS.sendDraw) WS.sendDraw({ id: lastOp.id, points: [p] });
    }
    if (WS && WS.sendCursor) WS.sendCursor({ x: p.x, y: p.y, userId: (WS.socket && WS.socket.id) || 'local' });
  }

  function handleEnd(e) {
    if (!drawing) return;
    drawing = false;
    const lastOp = ops[ops.length - 1];
    if (lastOp && WS && WS.sendDraw) WS.sendDraw(lastOp);
    undoneStack.length = 0;
  }

  function attachInputHandlers() {
    canvas.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd);
    canvas.addEventListener('touchcancel', handleEnd);
    canvas.style.touchAction = 'none';
  }

  function applyRemoteOp(op) {
    if (op.tool && op.color && op.size !== undefined && op.points) {
      if (!findOp(op.id)) {
        ops.push(Object.assign({}, op, { points: op.points.slice() }));
        drawStrokeOnContext(offCtx, op);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(offscreen, 0, 0);
      } else {
        const existing = findOp(op.id);
        if (existing) existing.points = op.points.slice();
        replayAll();
      }
      return;
    }
    if (op.id && op.points) {
      const existing = findOp(op.id);
      if (existing) {
        existing.points = (existing.points || []).concat(op.points);
        const appendedOp = {
          id: op.id,
          userId: existing.userId,
          tool: existing.tool || 'brush',
          color: existing.color || '#000',
          size: existing.size || 4,
          points: op.points
        };
        drawStrokeOnContext(offCtx, appendedOp);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(offscreen, 0, 0);
      } else {
        ops.push(Object.assign({}, op));
        const temp = {
          id: op.id,
          userId: op.userId || 'remote',
          tool: 'brush',
          color: '#000',
          size: 4,
          points: op.points
        };
        drawStrokeOnContext(offCtx, temp);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(offscreen, 0, 0);
      }
    }
  }

  function applyUndoRedo(payload) {
    if (!payload || !payload.opId) return;
    const op = findOp(payload.opId);
    if (!op) return;
    if (payload.type === 'undo') op.deleted = true;
    else if (payload.type === 'redo') op.deleted = false;
    replayAll();
  }

  const CanvasApp = {
    init() {
      resize();
      attachInputHandlers();
    },
    setTool(t) { if (t === 'brush' || t === 'eraser') currentTool = t; },
    setColor(c) { currentColor = c; },
    setSize(s) { currentSize = clamp(parseInt(s, 10) || 1, 1, 200); },
    loadRemoteState(remoteOps) {
      if (!Array.isArray(remoteOps)) remoteOps = [];
      const serverMap = new Map();
      for (const o of remoteOps) serverMap.set(o.id, o);
      ops.length = 0;
      for (const o of remoteOps) ops.push(Object.assign({}, o, { points: o.points ? o.points.slice() : [] }));
      replayAll();
    },
    applyRemoteOp,
    applyUndoRedo
  };

  global.CanvasApp = CanvasApp;
  global.__CanvasDebug = { ops, offscreen, replayAll, findOp };
})(window);
