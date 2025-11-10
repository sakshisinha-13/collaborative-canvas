const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const app = express();
const httpSrv = http.createServer(app);

const { Server } = require('socket.io');
const socketServer = new Server(httpSrv, { cors: { origin: 'https://collaborative-canvas-six.vercel.app', methods: ['GET', 'POST'] } });

const Rooms = require('./rooms');
const DrawingState = require('./drawing-state');

app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('/health', (req, res) => res.json({ ok: true }));

function genId(length = 24) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

app.get('/create-room', (req, res) => {
  try {
    const roomId = genId(20);
    const token = genId(36);
    Rooms.createRoomWithToken(roomId, token);
    const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
    const proto = req.protocol || 'http';
    const url = `${proto}://${host}/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`;
    res.json({ ok: true, roomId, token, url });
  } catch (err) {
    console.error('create-room failed', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

socketServer.on('connection', (socket) => {
  console.info('Client connected:', socket.id);
  let activeRoom = 'default';

  socket.on('join-room', ({ roomId: requestedRoom, token } = {}) => {
    try {
      if (requestedRoom) activeRoom = requestedRoom;
      const meta = Rooms.getRoomMeta(activeRoom);
      if (meta && meta.private) {
        if (!token || token !== meta.token) {
          socket.emit('join-error', { message: 'Invalid token for this private room' });
          console.warn(`Rejecting join for ${socket.id} to ${activeRoom} (bad token)`);
          return;
        }
      }
      socket.join(activeRoom);
      Rooms.addUser(activeRoom, { id: socket.id, color: pickRandomColor() });
      console.info(`Socket ${socket.id} entered room ${activeRoom}`);
      const state = DrawingState.getState(activeRoom);
      socket.emit('init-state', { ops: state.ops || [], users: Rooms.getUsers(activeRoom) });
      socketServer.to(activeRoom).emit('users', Rooms.getUsers(activeRoom));
    } catch (err) {
      console.error('join-room handler error', err);
      socket.emit('join-error', { message: 'internal_server_error' });
    }
  });

  socket.on('request-users', () => {
    try {
      const list = Rooms.getUsers(activeRoom);
      socket.emit('users', list);
    } catch (err) {
      console.error('request-users error', err);
    }
  });

  socket.on('cursor', (payload) => {
    try {
      if (!payload) return;
      payload.userId = socket.id;
      socket.to(activeRoom).emit('cursor', payload);
    } catch (err) {
      console.error('cursor handler error', err);
    }
  });

  socket.on('draw', (op) => {
    try {
      if (!op) return;
      DrawingState.mergeIncomingOp(activeRoom, Object.assign({}, op, { userId: socket.id }));
      socketServer.to(activeRoom).emit('draw', Object.assign({}, op, { userId: socket.id }));
    } catch (err) {
      console.error('draw handler error', err);
    }
  });

  socket.on('undo', () => {
    try {
      const out = DrawingState.undo(activeRoom);
      if (out) socketServer.to(activeRoom).emit('undo-redo', out);
    } catch (err) {
      console.error('undo handler error', err);
    }
  });

  socket.on('redo', () => {
    try {
      const out = DrawingState.redo(activeRoom);
      if (out) socketServer.to(activeRoom).emit('undo-redo', out);
    } catch (err) {
      console.error('redo handler error', err);
    }
  });

  socket.on('disconnect', (reason) => {
    try {
      Rooms.removeUser(activeRoom, socket.id);
      console.info(`Socket ${socket.id} disconnected from ${activeRoom} (${reason})`);
      socketServer.to(activeRoom).emit('users', Rooms.getUsers(activeRoom));
    } catch (err) {
      console.error('disconnect handler error', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpSrv.listen(PORT, () => console.log(`Listening on ${PORT}`));

function pickRandomColor() {
  const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];
  return palette[Math.floor(Math.random() * palette.length)];
}
