const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const app = express();
const httpSrv = http.createServer(app);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || null; 

const cors = require('cors');
if (FRONTEND_ORIGIN) {
  app.use(cors({
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  }));
} else {
  app.use(cors());
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('/health', (req, res) => res.json({ ok: true }));

// --- Helpers ---
function genId(length = 24) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

const Rooms = require('./rooms');
const DrawingState = require('./drawing-state');

app.get('/create-room', (req, res) => {
  try {
    const roomId = genId(20);
    const token = genId(36);
    Rooms.createRoomWithToken(roomId, token);

    // Build frontend base URL
    let frontendBase;
    if (FRONTEND_ORIGIN) {
      frontendBase = FRONTEND_ORIGIN.replace(/\/$/, '');
    } else if (req.headers.origin) {
      frontendBase = req.headers.origin.replace(/\/$/, '');
    } else {
      // fallback to host -> used only in local dev when FRONTEND_ORIGIN not set
      const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
      const proto = req.protocol || 'http';
      frontendBase = `${proto}://${host}`;
    }

    const url = `${frontendBase}/?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`;
    res.json({ ok: true, roomId, token, url });
  } catch (err) {
    console.error('create-room failed', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// --- Socket.IO setup with CORS restricted to FRONTEND_ORIGIN (or permissive when not set) ---
const { Server } = require('socket.io');
const ioCors = FRONTEND_ORIGIN ? { origin: FRONTEND_ORIGIN, methods: ['GET', 'POST'], credentials: true } : { origin: '*', methods: ['GET','POST'] };

const socketServer = new Server(httpSrv, { cors: ioCors });

socketServer.on('connection', (socket) => {
  console.info('Client connected:', socket.id);
  let activeRoom = 'default';

  socket.on('join-room', ({ roomId: requestedRoom, token, name, color } = {}) => {
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
      Rooms.addUser(activeRoom, { id: socket.id, color: color || pickRandomColor(), name: name || null });

      console.info(`Socket ${socket.id} entered room ${activeRoom}`);
      const state = DrawingState.getState(activeRoom) || { ops: [] };
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

  socket.on('draw', (op, ack) => {
    try {
      if (!op) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'empty_op' });
        return;
      }

      // merge into drawing state and broadcast
      DrawingState.mergeIncomingOp(activeRoom, Object.assign({}, op, { userId: socket.id }));

      // server may want to assign opId/seq in DrawingState — if so, return that
      // we'll emit the op to other peers with the userId included
      const broadcastOp = Object.assign({}, op, { userId: socket.id });
      socket.to(activeRoom).emit('draw', broadcastOp);

      // ack if callback is provided
      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    } catch (err) {
      console.error('draw handler error', err);
      if (typeof ack === 'function') ack({ ok: false, reason: 'server_error' });
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
httpSrv.listen(PORT, () => {
  console.log(`Listening on ${PORT} (FRONTEND_ORIGIN=${FRONTEND_ORIGIN || 'not-set'})`);
});

function pickRandomColor() {
  const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];
  return palette[Math.floor(Math.random() * palette.length)];
}
