// server/index.js (v2 - with HP, Energy, Skills)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname + '/../public'));

const rooms = {}; // { roomId: { players: { socketId: playerState } } }

function randomPos() {
  return { x: Math.floor(Math.random() * 600) + 50, y: Math.floor(Math.random() * 400) + 50 };
}

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6'];

const MATCH_DURATION = 60 * 1000; // 1 menit
const LOOT_INTERVAL = 5000; // tiap 5 detik spawn loot
const LOOT_LIFETIME = 8000; // loot hilang setelah 8 detik

// Tambahkan state loot dan timer ke tiap room
function initMatch(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.matchActive) return;
  if (Object.keys(room.players).length < 2) return; // hanya start kalau ada 2+

  console.log('Match started in room', roomId);
  room.matchActive = true;
  room.loots = [];
  room.matchEndTime = Date.now() + MATCH_DURATION;

  // Timer match
  room.timer = setInterval(() => {
    const remaining = room.matchEndTime - Date.now();
    if (remaining <= 0) {
      clearInterval(room.timer);
      io.to(roomId).emit('game_over', { winner: null });
      delete rooms[roomId];
    } else {
      io.to(roomId).emit('timer', { remaining });
    }
  }, 1000);

  // Loot spawn interval
  room.lootSpawner = setInterval(() => {
    spawnLoot(roomId);
  }, LOOT_INTERVAL);
}

function spawnLoot(roomId) {
  const room = rooms[roomId];
  if (!room || !room.matchActive) return;
  const loot = {
    id: 'loot_' + Math.random().toString(36).substr(2, 5),
    x: Math.floor(Math.random() * 700) + 50,
    y: Math.floor(Math.random() * 500) + 50,
    type: Math.random() < 0.5 ? 'hp' : 'energy'
  };
  room.loots.push(loot);
  io.to(roomId).emit('loot_spawn', loot);

  // hilangkan loot setelah lifetime
  setTimeout(() => {
    if (!room.loots) return;
    room.loots = room.loots.filter(l => l.id !== loot.id);
    io.to(roomId).emit('loot_remove', { id: loot.id });
  }, LOOT_LIFETIME);
}

io.on('connection', (socket) => {
  console.log('connect:', socket.id);

  socket.on('create_or_join', ({ roomId, name }, ack) => {
    if (!roomId) return ack({ ok: false, error: 'roomId empty' });

    if (!rooms[roomId]) rooms[roomId] = { players: {} };
    socket.join(roomId);

    const spawn = randomPos();
    const color = COLORS[Object.keys(rooms[roomId].players).length % COLORS.length];
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: name || 'Player',
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      color,
      lastProcessedInput: 0,
      hp: 100,
      energy: 100,
      speedMultiplier: 1,
      defend: false,
      defendUntil: 0,
      speedUntil: 0,
      alive: true
    };

    socket.data.roomId = roomId;

    const players = Object.values(rooms[roomId].players).map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, color: p.color, hp: p.hp, energy: p.energy
    }));

    ack({ ok: true, me: rooms[roomId].players[socket.id], players });

    socket.to(roomId).emit('player_joined', {
      id: socket.id, name, x: spawn.x, y: spawn.y, color, hp: 100, energy: 100
    });

    if (Object.keys(rooms[roomId].players).length >= 2) {
      initMatch(roomId);
    }
  });

  socket.on('pickup_loot', (lootId) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.matchActive) return;
    const me = room.players[socket.id];
    if (!me || !me.alive) return;

    const loot = room.loots?.find(l => l.id === lootId);
    if (!loot) return;

    // ambil efek loot
    if (loot.type === 'hp') me.hp = Math.min(100, me.hp + 20);
    if (loot.type === 'energy') me.energy = Math.min(100, me.energy + 20);

    // hapus loot
    room.loots = room.loots.filter(l => l.id !== lootId);
    io.to(roomId).emit('loot_remove', { id: lootId });
  });

  socket.on('input', (input) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p || !p.alive) return;

    // check buffs
    const now = Date.now();
    p.defend = now < p.defendUntil;
    p.speedMultiplier = now < p.speedUntil ? 2 : 1;

    const dt = Math.max(0, Math.min(0.1, input.dt));
    const baseSpeed = 150;
    const speed = baseSpeed * p.speedMultiplier;
    p.vx = input.ax * speed;
    p.vy = input.ay * speed;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = Math.max(0, Math.min(800, p.x));
    p.y = Math.max(0, Math.min(600, p.y));
    p.lastProcessedInput = input.seq;
  });

  // skill usage
  socket.on('use_skill', (skill) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const me = room.players[socket.id];
    if (!me || !me.alive) return;

    const now = Date.now();

    switch (skill) {
      case 'damage':
        if (me.energy < 20) return;
        me.energy -= 20;

        // find nearest player
        let nearest = null;
        let distMin = Infinity;
        for (const id in room.players) {
          const target = room.players[id];
          if (id === socket.id || !target.alive) continue;
          const dx = target.x - me.x;
          const dy = target.y - me.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < distMin && dist < 100) {
            distMin = dist;
            nearest = target;
          }
        }

        if (nearest) {
          let dmg = 20;
          if (nearest.defend) dmg *= 0.5;
          nearest.hp -= dmg;
          if (nearest.hp <= 0) {
            nearest.hp = 0;
            nearest.alive = false;
            io.to(roomId).emit('player_dead', { id: nearest.id });
            checkGameOver(roomId);
          }
        }
        break;

      case 'speed':
        if (me.energy < 15) return;
        me.energy -= 15;
        me.speedUntil = now + 3000;
        break;

      case 'defend':
        if (me.energy < 10) return;
        me.energy -= 10;
        me.defendUntil = now + 3000;
        break;
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    delete rooms[roomId].players[socket.id];
    socket.to(roomId).emit('player_left', { id: socket.id });
    if (Object.keys(rooms[roomId].players).length === 0) delete rooms[roomId];
  });
});

function checkGameOver(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const alive = Object.values(room.players).filter(p => p.alive);
  if (alive.length <= 1) {
    const winner = alive[0];
    io.to(roomId).emit('game_over', {
      winner: winner ? { id: winner.id, name: winner.name } : null
    });
    // clear room state
    for (const id in room.players) {
      room.players[id].alive = false;
    }
    setTimeout(() => delete rooms[roomId], 1000);
  }
}

// broadcast state
setInterval(() => {
  for (const roomId in rooms) {
    const players = Object.values(rooms[roomId].players).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      color: p.color,
      hp: p.hp,
      energy: p.energy,
      alive: p.alive,
      speedUntil: p.speedUntil,
      defendUntil: p.defendUntil
    }));
    const loots = rooms[roomId].loots || [];
    io.to(roomId).emit('state', { players, loots, ts: Date.now() });
  }
}, 50);

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));