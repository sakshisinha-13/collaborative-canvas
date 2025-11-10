# Real-Time Collaborative Drawing Canvas

A multi-user real-time drawing app built with **vanilla JavaScript**, **HTML5 Canvas**, **Node.js**, and **Socket.IO**. It supports private rooms, invite links, live cursors, undo/redo, and smooth state synchronization.

## Setup Instructions

### 1. Clone and Install
```bash
git clone <your-repo-url>
cd collab-canvas
npm install
```

### 2. Run the Server
```bash
npm start
```
By default, the app runs on:  
**[http://localhost:3000](http://localhost:3000)**

## How to Test with Multiple Users

1. Start the app with `npm start`.
2. Open **[http://localhost:3000](http://localhost:3000)** in your browser.
3. You’ll see a modal with two options:
   * **Paste Invite / Room Link** to join an existing session
   * **Create Private Room** to generate a new room and invite others
4. When you create a private room:
   * A **shareable invite URL** appears (auto-copied to clipboard).
   * Open that link in another browser or an **Incognito window** to simulate another user.
5. Draw simultaneously, and you’ll see:
   * Real-time strokes appear across all tabs.
   * Colored cursor indicators for each participant.
   * The active user list updates dynamically.

## Project Structure
```
collab-canvas/
├── client/
│   ├── index.html           # UI and modal
│   ├── style.css            # Light/dark themes & layout
│   ├── canvas.js            # Drawing logic and undo/redo
│   ├── websocket.js         # Socket.io client and message handling
│   ├── cursors.js           # Remote cursor overlay
│   └── main.js              # App bootstrap and modal logic
├── server/
│   ├── server.js            # Express + Socket.IO backend
│   ├── rooms.js             # Room/user management
│   └── drawing-state.js     # Global state and undo/redo
├── package.json
└── README.md
```

## Features Implemented

* Brush and eraser with adjustable size and color
* Real-time sync between multiple clients
* Live user list with color indicators
* Remote cursor visibility for all participants
* Global undo/redo system
* Private rooms with unique shareable invite links
* Efficient canvas updates and WebSocket batching
* Simple, responsive, no-framework UI

## Known Limitations / Bugs

* **Undo/Redo** works globally but may occasionally revert remote actions slightly out of order during very high activity.
* **Conflict handling** for overlapping strokes is basic, using last-write-wins.
* **Persistence**: Canvas state is in memory—rooms clear if the server restarts.
* **No authentication**: Anyone with the invite URL can join that private room.
* **No mobile touch optimization** yet; it works best on desktop.

## Time Spent

| Phase                         |     Approx Time |
| :---------------------------- | --------------: |
| Canvas Drawing and Tools      |         3 hours |
| Socket.IO Real-Time Sync      |       2.5 hours |
| Undo/Redo and State Management|       1.5 hours |
| Room System and Invite Modal  |         2 hours |
| Cursor and User Management    |          1 hour |
| UI Polish, Testing, and Bug Fixes |       1.5 hours |
| **Total**                     | **~11.5 hours** |
