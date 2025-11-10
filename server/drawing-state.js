const roomStates = new Map();

function ensureRoom(id) {
  if (!roomStates.has(id)) {
    roomStates.set(id, { ops: [], undone: [] });
  }
  return roomStates.get(id);
}

module.exports = {
  getState(roomId) {
    const r = ensureRoom(roomId);
    return { ops: r.ops.map(o => ({ ...o })) };
  },

  mergeIncomingOp(roomId, incoming) {
    if (!incoming || !incoming.id) return;
    const r = ensureRoom(roomId);

    if (incoming.tool && incoming.color && typeof incoming.size !== 'undefined' && Array.isArray(incoming.points)) {
      const existing = r.ops.find(o => o.id === incoming.id);
      if (!existing) {
        r.ops.push({ ...incoming, points: [...incoming.points] });
      } else {
        existing.tool = incoming.tool;
        existing.color = incoming.color;
        existing.size = incoming.size;
        existing.points = [...incoming.points];
      }
      return;
    }

    if (Array.isArray(incoming.points)) {
      let op = r.ops.find(o => o.id === incoming.id);
      if (op) {
        op.points = (op.points || []).concat(incoming.points);
      } else {
        r.ops.push({
          id: incoming.id,
          userId: incoming.userId || null,
          points: [...incoming.points],
          tool: incoming.tool || 'brush',
          color: incoming.color || '#000',
          size: typeof incoming.size !== 'undefined' ? incoming.size : 4,
          deleted: false
        });
      }
    }
  },

  undo(roomId) {
    const r = ensureRoom(roomId);
    for (let i = r.ops.length - 1; i >= 0; i--) {
      const op = r.ops[i];
      if (op && !op.deleted) {
        op.deleted = true;
        r.undone.push(op.id);
        return { type: 'undo', opId: op.id };
      }
    }
    return null;
  },

  redo(roomId) {
    const r = ensureRoom(roomId);
    if (r.undone.length) {
      const opId = r.undone.pop();
      const op = r.ops.find(o => o.id === opId);
      if (op) {
        op.deleted = false;
        return { type: 'redo', opId };
      }
    }
    return null;
  }
};
