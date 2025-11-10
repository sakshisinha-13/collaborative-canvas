# ARCHITECTURE.md

## Project Overview
A real-time collaborative drawing app allowing multiple users to draw simultaneously on a shared canvas with live synchronization.

---

## Architecture Summary

### Components
- **Client (Browser)**: Captures user input, renders strokes, manages undo/redo, and handles WebSocket communication.
- **Server (Node.js + Socket.io)**: Manages rooms, synchronizes operations, and broadcasts drawing events.

---

## Data Flow
1. User draws → client captures stroke data (points, color, width).
2. Client sends `stroke:start`, `stroke:update`, and `stroke:end` via WebSocket.
3. Server receives, appends to room history, and broadcasts to other users.
4. All clients render received strokes in real-time.

---

## WebSocket Protocol
**Message Types:**
- `stroke:start` – stroke metadata (id, color, width)
- `stroke:update` – incremental points
- `stroke:end` – stroke completion
- `undo` / `redo` – revert or restore operations
- `presence` – user cursor updates

---

## Undo/Redo Strategy
- Each stroke = one operation with unique `opId`.
- Undo marks an operation as inactive (tombstone).
- Clients re-render the canvas using all active operations.
- Redo reactivates the operation.

---

## Conflict Resolution
- **Last-writer-wins**: later operations appear above earlier ones.
- Consistency ensured by applying all operations in server sequence order.

---

## Optimizations
- **Batching** stroke points before sending.
- **Delta encoding** for smaller messages.
- **Offscreen rendering** for smooth performance.

---

## Scaling & Persistence
- Each room maintains an in-memory log of operations.
- For larger scale, use Redis pub/sub for cross-instance sync.
- Periodic snapshots or logs can be saved for recovery.

---

## Security
- Validate incoming messages.
- Rate-limit updates to prevent abuse.
- Use random room IDs for privacy.

---

## Limitations
- Undo requires re-rendering (can be optimized with checkpoints).
- Offline edits not supported.

---

**End of ARCHITECTURE.md**

