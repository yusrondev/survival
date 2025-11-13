// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname + '/../public'));

const rooms = {}; // { roomId: { players: { socketId: playerState }, lastUpdate: ... } }

// helper to make random spawn pos
function randomPos() {
  return {
    x: Math.floor(Math.random() * 600) + 50,
    y: Math.floor(Math.random() * 400) + 50
  };
}

// color palette
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6'];

io.on('connection', (socket) => {
  console.log('conn:', socket.id);

  socket.on('create_or_join', ({ roomId, name }, ack) => {
    if (!roomId) return ack({ ok: false, error: 'roomId empty' });

    // create room record if not exist
    if (!rooms[roomId]) {
      rooms[roomId] = { players: {} };
    }

    // put socket in room
    socket.join(roomId);

    // spawn player
    const spawn = randomPos();
    const color = COLORS[Object.keys(rooms[roomId].players).length % COLORS.length];

    // Authoritative state for player
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: name || 'Player',
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      color,
      lastProcessedInput: 0
    };

    // attach roomId to socket
    socket.data.roomId = roomId;

    // ack with spawn and current players
    const players = Object.values(rooms[roomId].players).map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, color: p.color
    }));

    ack({ ok: true, me: { id: socket.id, x: spawn.x, y: spawn.y, color }, players });

    // broadcast new player to others in room
    socket.to(roomId).emit('player_joined', { id: socket.id, name: name || 'Player', x: spawn.x, y: spawn.y, color });
  });

  // receive inputs from client (client-side prediction inputs)
  // input: { seq, dt, ax, ay, speed }
  socket.on('input', (input) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player) return;

    // simple authoritative integration
    const maxSpeed = input.speed || 150; // px/s
    const dt = Math.max(0, Math.min(0.1, input.dt)); // clamp
    player.vx = input.ax * maxSpeed;
    player.vy = input.ay * maxSpeed;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // store last processed seq for reconciliation
    player.lastProcessedInput = input.seq;

    // bounds clamp (optional)
    player.x = Math.max(0, Math.min(800, player.x));
    player.y = Math.max(0, Math.min(600, player.y));
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      // remove player
      delete rooms[roomId].players[socket.id];
      // notify others
      socket.to(roomId).emit('player_left', { id: socket.id });
      // if room empty, delete room
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      }
    }
    console.log('disconn:', socket.id);
  });
});

// Periodic authoritative state broadcast (20Hz)
setInterval(() => {
  for (const roomId of Object.keys(rooms)) {
    const players = Object.values(rooms[roomId].players).map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, color: p.color, lastProcessedInput: p.lastProcessedInput
    }));
    io.to(roomId).emit('state', { players, ts: Date.now() });
  }
}, 50); // 50ms -> 20fps

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
