
(function (root) {
  const DEFAULT_PATH = '/socket.io';
  const DEFAULT_ROOM = 'default';

  let _sock = null;
  let _isConnected = false;
  let _room = DEFAULT_ROOM;
  let _token = null;

  const _out = [];

  function _tryFlush() {
    while (_out.length && _isConnected) {
      const pkt = _out.shift();
      try {
        if (pkt.ack) {
          _sock.emit(pkt.event, pkt.payload, (ack) => {
            pkt.resolve && pkt.resolve(ack);
            if (pkt.event === 'draw' && root.onOpAck) {
              try { root.onOpAck(ack); } catch (e) { console.error(e); }
            }
          });
        } else {
          _sock.emit(pkt.event, pkt.payload);
          pkt.resolve && pkt.resolve(true);
        }
      } catch (err) {
        // push back and stop attempting for now
        _out.unshift(pkt);
        break;
      }
    }
  }

  function _enqueue(event, payload = {}, opts = {}) {
    const needsAck = !!opts.ack;
    return new Promise((resolve, reject) => {
      if (_isConnected && _sock) {
        if (needsAck) {
          try {
            _sock.emit(event, payload, (ackData) => {
              resolve(ackData);
              if (event === 'draw' && root.onOpAck) {
                try { root.onOpAck(ackData); } catch (e) { console.error(e); }
              }
            });
            return;
          } catch (e) {}
        } else {
          try {
            _sock.emit(event, payload);
            resolve(true);
            return;
          } catch (e) {}
        }
      }
      _out.push({ event, payload, ack: needsAck, resolve, reject });
    });
  }

  function _cleanSocket() {
    if (!_sock) return;
    try {
      _sock.removeAllListeners && _sock.removeAllListeners();
      _sock.disconnect && _sock.disconnect();
    } catch (e) {}
    _sock = null;
    _isConnected = false;
  }

  const WS = {
    get socket() { return _sock; },
    get connected() { return _isConnected; },

    connect(roomId = DEFAULT_ROOM, token = null, opts = {}) {
      _room = roomId || DEFAULT_ROOM;
      _token = token || null;

      // teardown existing
      _cleanSocket();

      const defaultOpts = {
        path: DEFAULT_PATH,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        transports: ['websocket', 'polling']
      };
      const ioOpts = Object.assign({}, defaultOpts, opts);

      // create socket (assumes IO client available globally)
      // eslint-disable-next-line no-undef
      _sock = io(ioOpts);

      _sock.on('connect', () => {
        _isConnected = true;
        // join room after connect
        try {
          _sock.emit('join-room', { roomId: _room, token: _token });
        } catch (e) {}
        _tryFlush();
        if (root.onSocketConnect) {
          try { root.onSocketConnect(_sock.id); } catch (e) { console.error(e); }
        }
      });

      _sock.on('disconnect', (reason) => {
        _isConnected = false;
        if (root.onSocketDisconnect) {
          try { root.onSocketDisconnect(reason); } catch (e) { console.error(e); }
        }
      });

      _sock.on('connect_error', (err) => {
        if (root.onConnectError) {
          try { root.onConnectError(err); } catch (e) { console.error(e); }
        } else {
          console.warn('WS connect_error', err && err.message ? err.message : err);
        }
      });

      _sock.on('init-state', (payload) => {
        if (root.onInitState) {
          try { root.onInitState(payload); } catch (e) { console.error(e); }
        }
      });

      _sock.on('draw', (op) => {
        if (root.onRemoteDraw) {
          try { root.onRemoteDraw(op); } catch (e) { console.error(e); }
        }
      });

      _sock.on('cursor', (c) => {
        if (root.onRemoteCursor) {
          try { root.onRemoteCursor(c); } catch (e) { console.error(e); }
        }
      });

      _sock.on('users', (list) => {
        try { console.debug('CLIENT websocket: users', list); } catch (e) {}
        if (root.onUsers) {
          try { root.onUsers(list); } catch (e) { console.error(e); }
        }
        try { window.dispatchEvent(new CustomEvent('users-updated', { detail: list })); } catch (e) {}
      });

      _sock.on('op-ack', (ack) => {
        if (root.onOpAck) {
          try { root.onOpAck(ack); } catch (e) { console.error(e); }
        }
      });

      _sock.on('undo-redo', (payload) => {
        if (root.onUndoRedo) {
          try { root.onUndoRedo(payload); } catch (e) { console.error(e); }
        }
      });

      _sock.on('full-state', (payload) => {
        if (root.onFullState) {
          try { root.onFullState(payload); } catch (e) { console.error(e); }
        }
      });
    },

    sendDraw(payload, opts = {}) { return _enqueue('draw', payload, { ack: !!opts.ack }); },
    sendCursor(payload) { return _enqueue('cursor', payload, { ack: false }); },
    sendUndo() { return _enqueue('undo', {}, { ack: false }); },
    sendRedo() { return _enqueue('redo', {}, { ack: false }); },

    disconnect() {
      _cleanSocket();
    },

    switchRoom(newRoom) {
      _room = newRoom || DEFAULT_ROOM;
      if (_sock && _sock.connected) {
        try { _sock.emit('join-room', { roomId: _room, token: _token }); } catch (e) {}
      } else {
        this.connect(_room, _token);
      }
    }
  };

  root.WS = WS;
})(window);
