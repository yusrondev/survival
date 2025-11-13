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
const minimap = document.getElementById('minimap');
const ctxMini = minimap.getContext('2d');
const hud = document.getElementById('hud');
let hpBar, energyBar;

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 400;

let speedEffectActive = false;

let loots = [];
let matchTime = 0;

let me = null;
const players = {}; // other players and me: {id:{x,y,color,name}}
let lastServerStateTs = 0;

// Camera
const camera = {
  x: 0,
  y: 0,
  zoom: 1.2,  // zoom > 1 = zoom in, <1 = zoom out
  smoothness: 0.1
};

const effects = []; // simpan efek sementara

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

function spawnDamageEffect(x, y) {
  effects.push({
    x,
    y,
    img: damageEffectImg,
    size: 85,                  // ukuran efek
    alpha: 1,
    duration: 500,
    startTime: performance.now(),
    rotation: Math.random() * 2 * Math.PI // sudut acak antara 0 ~ 360 derajat
  });
}

window.spawnDamageEffect = spawnDamageEffect;

function drawMinimapFromMain() {
  ctxMini.clearRect(0, 0, minimap.width, minimap.height);

  // tentukan skala dari world size ke minimap size
  const worldWidth = canvas.width;
  const worldHeight = canvas.height;
  const scaleX = minimap.width / worldWidth;
  const scaleY = minimap.height / worldHeight;

  // gambar loot
  for (const loot of loots) {
    ctxMini.fillStyle = loot.type === 'hp' ? '#4cd137' : '#f1c40f';
    ctxMini.beginPath();
    ctxMini.arc(loot.x * scaleX, loot.y * scaleY, 5, 0, Math.PI * 2);
    ctxMini.fill();
  }

  // gambar pemain
  for (const id in players) {
    const p = players[id];
    ctxMini.fillStyle = p.color || '#fff';
    ctxMini.fillRect(
      p.x * scaleX - 4, // setengah ukuran minimap
      p.y * scaleY - 4,
      8, 8
    );
  }

  // gambar posisi kita
  if (me) {
    ctxMini.strokeStyle = '#fff';
    ctxMini.lineWidth = 2;
    ctxMini.strokeRect(me.x * scaleX - 5, me.y * scaleY - 5, 10, 10);
  }
}

const bgImage = new Image();
bgImage.src = '/img/bg-black.avif';  // path relatif terhadap public

const damageEffectImg = new Image();
damageEffectImg.src = '/img/damage2.png'; // path PNG efek damage

// drawing
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (me) {
    // Smooth follow camera ke posisi player
    camera.x += (me.x - camera.x) * camera.smoothness;
    camera.y += (me.y - camera.y) * camera.smoothness;
  }

  // Terapkan transformasi kamera (translate & zoom)
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2); // pusatkan
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Gambar background mengikuti kamera
  if (bgImage.complete) {
    ctx.drawImage(bgImage, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  } else {
    ctx.fillStyle = "#99cc99";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  const lerpFactor = 0.25;

  for (const id in players) {
    const p = players[id];
    if (id !== me?.id && p.targetX !== undefined && p.targetY !== undefined) {
      p.x += (p.targetX - p.x) * lerpFactor;
      p.y += (p.targetY - p.y) * lerpFactor;
    }

    const size = 32;

    // efek speed
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

    // HP bar dan nama
    if (id !== me?.id) {
      const barWidth = 40;
      const barHeight = 5;
      const hpPercent = Math.max(0, Math.min(1, (p.hp ?? 100) / 100));
      const barX = p.x - barWidth / 2;
      const barY = p.y - size / 2 - 10;

      ctx.fillStyle = '#555';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = `hsl(${hpPercent * 120}, 100%, 50%)`;
      ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(barX, barY, barWidth, barHeight);

      ctx.font = '12px Arial';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(p.name || 'Player', p.x, barY - 5);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name || 'Player', p.x, p.y - size / 2 - 10);
    }

    ctx.shadowBlur = 0;
  }

  // gambar loot (juga ikut kamera)
  for (const loot of loots) {
    ctx.fillStyle = loot.type === 'hp' ? '#4cd137' : '#f1c40f';
    ctx.beginPath();
    ctx.arc(loot.x, loot.y, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  const now = performance.now();
  for (let i = effects.length - 1; i >= 0; i--) {
    const eff = effects[i];
    const elapsed = now - eff.startTime;
    if (elapsed > eff.duration) {
      effects.splice(i, 1);
      continue;
    }
    const alpha = 1 - elapsed / eff.duration; // fade out
    ctx.globalAlpha = alpha;

    ctx.save();
    ctx.translate(eff.x, eff.y);          // pindah ke pusat efek
    ctx.rotate(eff.rotation);             // rotasi sesuai random
    ctx.drawImage(eff.img, -eff.size / 2, -eff.size / 2, eff.size, eff.size);
    ctx.restore();

    ctx.globalAlpha = 1; // reset alpha
  }

  ctx.restore(); // reset transformasi kamera
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
  drawMinimapFromMain();
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
  matchTime = 0;  // Reset the timer when the game ends
  document.getElementById('timer').innerText = `Time: ${matchTime}s`;  // Update the displayed timer
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

function resizeCanvas() {
  canvas.width = WORLD_WIDTH;
  canvas.height = WORLD_HEIGHT;

  minimap.width = Math.min(200, window.innerWidth / 4);
  minimap.height = Math.min(150, window.innerHeight / 4);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();