// public/js/net.js
window.socket = io();

window.createOrJoin = function(roomId, name) {
  return new Promise((resolve, reject) => {
    window.socket.emit('create_or_join', { roomId, name }, (resp) => {
      if (resp && resp.ok) resolve(resp);
      else reject(resp && resp.error ? resp.error : 'Failed to join');
    });
  });
};

window.sendInput = function(input) {
  window.socket.emit('input', input);
};

window.useSkill = function(skill) {
  window.socket.emit('use_skill', skill);
};

// listener
window.onGameOver = function(cb) { window.socket.on('game_over', cb); };
window.onPlayerDead = function(cb) { window.socket.on('player_dead', cb); };
window.onState = function(cb) { window.socket.on('state', cb); };
window.onPlayerJoined = function(cb) { window.socket.on('player_joined', cb); };
window.onPlayerLeft = function(cb) { window.socket.on('player_left', cb); };
