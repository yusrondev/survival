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

let me = null;
const players = {}; // other players and me: {id:{x,y,color,name}}
let lastServerStateTs = 0;

// prediction data
let inputSeq = 0;
let pendingInputs = []; // inputs not yet acked by server
let lastTime = performance.now();
let joystickManager = null;
let axis = { x: 0, y: 0 }; // current joystick axis [-1..1]
const MAX_SPEED = 150; // px/s

// setup joystick using nipplejs
function setupJoystick() {
    const mgr = nipplejs.create({
        zone: document.getElementById('joystickArea'),
        mode: 'static',
        position: { left: '80px', top: '80px' },
        color: 'white',
        size: 120
    });

    mgr.on('move', (evt, data) => {
        if (!data || !data.vector) return;
        axis.x = data.vector.x; // -1 .. 1
        axis.y = data.vector.y * -1; // invert so up = negative y in screen coords
    });
    mgr.on('end', () => {
        axis.x = 0; axis.y = 0;
    });

    joystickManager = mgr;
}

// drawing
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const lerpFactor = 0.25; // dari 0.15 ke 0.25 biar respon lebih cepat

  for (const id in players) {
    const p = players[id];
    if (id !== me?.id) {
      // interpolate posisi pemain lain
      if (p.targetX !== undefined && p.targetY !== undefined) {
        p.x += (p.targetX - p.x) * lerpFactor;
        p.y += (p.targetY - p.y) * lerpFactor;
      }
    }

    ctx.fillStyle = p.color || '#fff';
    const size = 32;
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);

    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText(p.name || 'Player', p.x - size / 2, p.y - size / 2 - 6);
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
          const speed = inp.speed || MAX_SPEED;
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
        const input = { seq, dt, ax, ay, speed: MAX_SPEED };

        // apply locally (prediction)
        me.x += ax * MAX_SPEED * dt;
        me.y += ay * MAX_SPEED * dt;

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

// handle state updates
window.onState((data) => {
    handleServerState(data);
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
            players[p.id] = { id: p.id, x: p.x, y: p.y, color: p.color, name: p.name };
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
