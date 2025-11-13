// public/js/game.js
// Main client-side logic: rendering, joystick, prediction + reconciliation

// DOM
const lobby = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const btnJoin = document.getElementById('btnJoin');
const roomInput = document.getElementById('roomId');
const nameInput = document.getElementById('name');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const meNameDiv = document.getElementById('meName');
const hud = document.getElementById('hud');
let hpBar, energyBar;

let speedEffectActive = false;

let loots = [];
let matchTime = 0;

let me = null;
const players = {}; // other players and me: {id:{x,y,color,name}}
let lastServerStateTs = 0;

// prediction data
let inputSeq = 0;
let pendingInputs = []; // inputs not yet acked by server
let lastTime = performance.now();
let joystickManager = null;
let axis = { x: 0, y: 0 }; // current joystick axis [-1..1]
window.MAX_SPEED = 150;

// setup joystick using nipplejs
function setupJoystick() {
  const zone = document.getElementById('joystickArea');

  const mgr = nipplejs.create({
    zone: zone,
    mode: 'static',
    position: { left: '80px', top: '80px' },
    color: 'white',
    size: 120,
    multitouch: true,        // <--- penting: aktifkan multi-touch
    restJoystick: true,      // biar balik ke tengah
    catchDistance: 50
  });

  // pastikan area joystick tidak memblokir touch lain
  zone.style.touchAction = 'none';
  zone.style.pointerEvents = 'auto';

  mgr.on('move', (evt, data) => {
    if (!data || !data.vector) return;
    axis.x = data.vector.x;
    axis.y = data.vector.y * -1;
  });

  mgr.on('end', () => {
    axis.x = 0;
    axis.y = 0;
  });

  joystickManager = mgr;
}

// drawing
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const lerpFactor = 0.25;

  for (const id in players) {
    const p = players[id];
    if (id !== me?.id && p.targetX !== undefined && p.targetY !== undefined) {
      p.x += (p.targetX - p.x) * lerpFactor;
      p.y += (p.targetY - p.y) * lerpFactor;
    }

    const size = 32;

    // cek apakah player ini sedang speed (diri sendiri atau lawan)
    const isSpeedOwn = id === me?.id && window.SPEED_UP;
    const isSpeedOther = id !== me?.id && p.speedUntil && p.speedUntil > Date.now();

    if (isSpeedOwn || isSpeedOther) {
      const trailCount = 10;
      for (let i = 0; i < trailCount; i++) {
        ctx.fillStyle = `rgba(255, 255, 0, ${0.06 * (trailCount - i)})`;
        ctx.beginPath();
        ctx.roundRect(
          p.x - ((id === me?.id ? me.vx : p.vx) || 0) * i * 0.04 - size / 2,
          p.y - ((id === me?.id ? me.vy : p.vy) || 0) * i * 0.04 - size / 2,
          size, size, 6
        );
        ctx.fill();
      }
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'yellow';
    } else {
      ctx.shadowBlur = 0;
    }

    // gambar body
    ctx.fillStyle = p.color || '#fff';
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);

    // HP bar untuk pemain lain
    if (id !== me?.id) {
      const barWidth = 40;
      const barHeight = 5;
      const hpPercent = Math.max(0, Math.min(1, (p.hp ?? 100) / 100));
      const barX = p.x - barWidth / 2;
      const barY = p.y - size / 2 - 10;

      // gambar background bar
      ctx.fillStyle = '#555';
      ctx.fillRect(barX, barY, barWidth, barHeight);

      // gambar health bar
      ctx.fillStyle = `hsl(${hpPercent * 120}, 100%, 50%)`;
      ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);

      // border bar
      ctx.strokeStyle = '#000';
      ctx.strokeRect(barX, barY, barWidth, barHeight);

      // gambar nama player di atas bar
      ctx.font = '12px Arial';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(p.name || 'Player', p.x, barY - 5); // nama tepat di atas bar
    } else{
      // gambar nama
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name || 'Player', p.x, p.y - size / 2 - 10);
    }

    // reset shadow sekali di akhir per pemain
    ctx.shadowBlur = 0;
  }

  // gambar loot
  for (const loot of loots) {
    ctx.fillStyle = loot.type === 'hp' ? '#4cd137' : '#f1c40f';
    ctx.beginPath();
    ctx.arc(loot.x, loot.y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

// setelah draw()
function updateHUD() {
  if (!me) return;
  document.getElementById('hpBar').style.width = me.hp + '%';
  document.getElementById('energyBar').style.width = me.energy + '%';
}

// reconcile: when receiving authoritative state
function handleServerState(data) {
  lastServerStateTs = data.ts;

  for (const sp of data.players) {
    const id = sp.id;

    if (id !== me.id) {
      players[id].targetX = sp.x;
      players[id].targetY = sp.y;
      players[id].speedUntil = sp.speedUntil;  // simpan info speed
    }

    if (!players[id]) {
      players[id] = {
        id, x: sp.x, y: sp.y, color: sp.color, name: sp.name,
        hp: sp.hp, energy: sp.energy,
        targetX: sp.x, targetY: sp.y
      };
    } else {
      // update shared stats
      players[id].hp = sp.hp;
      players[id].energy = sp.energy;

      if (id === me.id) {
        // --- sinkronisasi HP & Energy dari server ---
        me.hp = sp.hp;
        me.energy = sp.energy;

        // server authoritative position
        players[id].x = sp.x;
        players[id].y = sp.y;

        // reconcile input prediction
        const lastProcessed = sp.lastProcessedInput || 0;
        pendingInputs = pendingInputs.filter(inp => inp.seq > lastProcessed);

        for (const inp of pendingInputs) {
          const speed = inp.speed || window.MAX_SPEED;
          players[id].x += inp.ax * speed * inp.dt;
          players[id].y += inp.ay * speed * inp.dt;
        }
      } else {
        // pemain lain → kita simpan posisi target, bukan langsung snap
        players[id].targetX = sp.x;
        players[id].targetY = sp.y;
      }
    }
  }
}

// main loop: handle local prediction, send inputs, render
function loop(now) {
  const dt = Math.min(0.06, (now - lastTime) / 1000);
  lastTime = now;

  if (me) {
    // create input from axis
    const ax = axis.x || 0;
    const ay = axis.y || 0;
    const seq = ++inputSeq;
    const input = { seq, dt, ax, ay, speed: window.MAX_SPEED };

    // apply locally (prediction)
    me.x += ax * window.MAX_SPEED * dt;
    me.y += ay * window.MAX_SPEED * dt;

    // keep in bounds
    me.x = Math.max(0, Math.min(canvas.width, me.x));
    me.y = Math.max(0, Math.min(canvas.height, me.y));

    // store pending input
    pendingInputs.push(input);

    // send to server (non-blocking)
    window.sendInput(input);
    // update players table for rendering
    players[me.id] = { id: me.id, x: me.x, y: me.y, color: me.color, name: me.name };
  }

  for (const loot of loots) {
    const dx = me.x - loot.x;
    const dy = me.y - loot.y;
    if (Math.sqrt(dx * dx + dy * dy) < 20) {
      window.socket.emit('pickup_loot', loot.id);
    }
  }

  draw();
  updateHUD();
  requestAnimationFrame(loop);
}

// handle player join/leave
window.onPlayerJoined((p) => {
  players[p.id] = { id: p.id, x: p.x, y: p.y, color: p.color, name: p.name };
});

window.onPlayerLeft((p) => {
  delete players[p.id];
});

window.onState((data) => {
  handleServerState(data);
});

window.onLootSpawn((loot) => {
  loots.push(loot);
});

window.onLootRemove(({ id }) => {
  loots = loots.filter(l => l.id !== id);
});

window.onTimer(({ remaining }) => {
  matchTime = Math.ceil(remaining / 1000);
  document.getElementById('timer').innerText = `Time: ${matchTime}s`;
});

window.onGameOver((data) => {
  alert(`Game Over!\nWinner: ${data.winner ? data.winner.name : 'No one'}`);
  resetGame();
});

window.onPlayerDead((p) => {
  if (p.id === me.id) {
    alert('Kamu kalah!');
    resetGame();
  }
});

function resetGame() {
  pendingInputs = [];
  for (const id in players) delete players[id];
  me = null;
  lobby.classList.remove('hidden');
  gameDiv.classList.add('hidden');
  document.exitFullscreen?.();
}

// UI: join/create room
btnJoin.addEventListener('click', async () => {
  const roomId = roomInput.value.trim();
  const name = nameInput.value.trim() || 'Player';

  if (!roomId) {
    alert('Masukkan room id');
    return;
  }

  try {
    const resp = await window.createOrJoin(roomId, name);
    // resp: { me: {id,x,y,color}, players: [...] }
    me = {
      id: resp.me.id,
      x: resp.me.x,
      y: resp.me.y,
      color: resp.me.color,
      name,
      hp: resp.me.hp ?? 100,
      energy: resp.me.energy ?? 100
    };

    // populate players
    for (const p of resp.players) {
      players[p.id] = {
        id: p.id,
        x: p.x,
        y: p.y,
        color: p.color,
        name: p.name,
        hp: p.hp ?? 100,
        energy: p.energy ?? 100
      };
    }

    // show game
    lobby.classList.add('hidden');
    gameDiv.classList.remove('hidden');
    meNameDiv.innerText = `You: ${name}`;

    // request fullscreen
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {/* ignore */ });
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }

    // setup joystick & start loop
    setupJoystick();
    lastTime = performance.now();
    requestAnimationFrame(loop);

  } catch (err) {
    alert('Gagal join: ' + err);
  }
});
