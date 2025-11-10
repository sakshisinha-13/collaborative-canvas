const store = new Map();

function ensureRoom(id) {
  if (!store.has(id)) {
    store.set(id, { members: new Map(), meta: { private: false, token: null, created: new Date() } });
  }
  return store.get(id);
}

module.exports = {
  createRoomWithToken(roomId, token) {
    const r = ensureRoom(roomId);
    r.meta.token = token;
    r.meta.private = true;
    r.meta.created = new Date();
    return r.meta;
  },

  getRoomMeta(roomId) {
    const r = store.get(roomId);
    return r ? r.meta : null;
  },

  addUser(roomId, user) {
    const r = ensureRoom(roomId);
    r.members.set(user.id, user);
  },

  removeUser(roomId, userId) {
    const r = store.get(roomId);
    if (!r) return;
    r.members.delete(userId);
  },

  getUsers(roomId) {
    const r = store.get(roomId);
    if (!r) return [];
    return Array.from(r.members.values());
  }
};
