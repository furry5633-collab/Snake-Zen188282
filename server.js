'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const WIDTH = 16;
const HEIGHT = 20;
const TICK_MS = 220;
const MAX_PLAYERS = 4;
const ROOM_CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_GRACE_MS = 45_000;
const LOBBY_GRACE_MS = 120_000;
const SKINS = new Set(['mint', 'citrus', 'berry', 'ocean', 'grape', 'gold']);
const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e6
});

const rooms = new Map();

app.disable('x-powered-by');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CLIENT_DIR = fs.existsSync(path.join(PUBLIC_DIR, 'index.html')) ? PUBLIC_DIR : __dirname;
const sendClientFile = (fileName) => (_req, res, next) => {
  res.sendFile(path.join(CLIENT_DIR, fileName), (error) => {
    if (error) next(error);
  });
};
app.get('/health', (_req, res) => res.json({ ok: true, service: 'serpiente-zen', rooms: rooms.size }));
app.get('/', sendClientFile('index.html'));
app.get('/index.html', sendClientFile('index.html'));
app.get('/styles.css', sendClientFile('styles.css'));
app.get('/app.js', sendClientFile('app.js'));
app.get('*', (_req, res) => res.status(404).type('text/plain').send('No encontrado'));

function cleanName(value) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 18);
  return cleaned || 'Jugador';
}

function cleanSkin(value) {
  const skin = String(value || 'mint').toLowerCase();
  return SKINS.has(skin) ? skin : 'mint';
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function makeRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function ackError(ack, error) {
  if (typeof ack === 'function') ack({ ok: false, error });
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostKey: room.hostKey,
    mode: 'zen',
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((player) => ({
      key: player.key,
      name: player.name,
      skin: player.skin,
      connected: player.connected
    }))
  };
}

function publicGame(room) {
  if (!room.game) return null;
  const snakes = {};
  for (const [key, snake] of Object.entries(room.game.snakes)) {
    snakes[key] = {
      body: snake.body.map(({ x, y }) => ({ x, y })),
      direction: snake.direction
    };
  }
  return {
    width: room.game.width,
    height: room.game.height,
    tickMs: room.game.tickMs,
    apple: room.game.apple ? { ...room.game.apple } : null,
    snakes,
    scores: { ...room.game.scores },
    totalApples: room.game.totalApples,
    status: room.game.status,
    result: room.game.result ? { ...room.game.result } : null
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', publicRoom(room));
}

function broadcastGame(room) {
  io.to(room.code).emit('game:state', publicGame(room));
}

function sendCurrentState(socket, room, player) {
  socket.emit('room:state', {
    room: publicRoom(room),
    selfId: player.key,
    token: player.token,
    game: publicGame(room)
  });
}

function clearRoomTimer(room) {
  if (room.tickTimer) clearInterval(room.tickTimer);
  room.tickTimer = null;
}

function clearPlayerTimer(player) {
  if (player.cleanupTimer) clearTimeout(player.cleanupTimer);
  player.cleanupTimer = null;
}

function clearDisconnectTimer(room) {
  if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
  room.disconnectTimer = null;
}

function removeRoomIfEmpty(room) {
  if (room.players.length !== 0) return false;
  clearRoomTimer(room);
  clearDisconnectTimer(room);
  rooms.delete(room.code);
  return true;
}

function getSocketPlayer(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) return null;
  const player = room.players.find((candidate) => candidate.key === socket.data.playerKey);
  if (!player || player.socketId !== socket.id) return null;
  return { room, player };
}

function attachPlayer(socket, room, player) {
  clearPlayerTimer(player);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerKey = player.key;
  player.connected = true;
  player.socketId = socket.id;
}

function newPlayer(key, name, skin) {
  return {
    key,
    token: makeToken(),
    name: cleanName(name),
    skin: cleanSkin(skin),
    connected: false,
    socketId: null,
    cleanupTimer: null
  };
}

function makeRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    hostKey: 'p1',
    phase: 'lobby',
    players: [],
    game: null,
    tickTimer: null,
    disconnectTimer: null
  };
  rooms.set(code, room);
  return room;
}

function randomEmptyCell(game) {
  const occupied = new Set();
  for (const snake of Object.values(game.snakes)) {
    for (const segment of snake.body) occupied.add(`${segment.x},${segment.y}`);
  }
  const freeCount = game.width * game.height - occupied.size;
  if (freeCount <= 0) return null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const cell = {
      x: crypto.randomInt(game.width),
      y: crypto.randomInt(game.height)
    };
    if (!occupied.has(`${cell.x},${cell.y}`)) return cell;
  }

  const free = [];
  for (let y = 0; y < game.height; y += 1) {
    for (let x = 0; x < game.width; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  return free[crypto.randomInt(free.length)];
}

function createGame(room) {
  const spawnPoints = {
    p1: { head: { x: 2, y: 2 }, direction: 'right', body: [{ x: 1, y: 2 }, { x: 0, y: 2 }] },
    p2: { head: { x: WIDTH - 3, y: HEIGHT - 3 }, direction: 'left', body: [{ x: WIDTH - 2, y: HEIGHT - 3 }, { x: WIDTH - 1, y: HEIGHT - 3 }] },
    p3: { head: { x: 2, y: 10 }, direction: 'down', body: [{ x: 2, y: 9 }, { x: 2, y: 8 }] },
    p4: { head: { x: WIDTH - 3, y: 9 }, direction: 'up', body: [{ x: WIDTH - 3, y: 10 }, { x: WIDTH - 3, y: 11 }] }
  };
  const activePlayers = room.players.filter((player) => player.connected);
  const snakes = {};
  const scores = {};
  for (const player of activePlayers) {
    const spawn = spawnPoints[player.key];
    snakes[player.key] = {
      body: [{ ...spawn.head }, ...spawn.body.map((segment) => ({ ...segment }))],
      direction: spawn.direction,
      nextDirection: null
    };
    scores[player.key] = 0;
  }
  const game = {
    width: WIDTH,
    height: HEIGHT,
    tickMs: TICK_MS,
    apple: null,
    snakes,
    scores,
    totalApples: 0,
    status: 'running',
    result: null
  };
  game.apple = randomEmptyCell(game);
  return game;
}

function startGame(room) {
  clearRoomTimer(room);
  clearDisconnectTimer(room);
  room.game = createGame(room);
  room.phase = 'playing';
  startTicking(room);
  broadcastRoom(room);
  broadcastGame(room);
}

function finishGame(room, type, winnerId = null, loserId = null) {
  clearRoomTimer(room);
  clearDisconnectTimer(room);
  room.phase = 'finished';
  if (room.game) {
    room.game.status = 'finished';
    room.game.result = { type, winnerId, loserId };
  }
  broadcastRoom(room);
  broadcastGame(room);
}

function isOpposite(a, b) {
  return (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left');
}

function wrap(value, max) {
  return (value + max) % max;
}

function tickRoom(room) {
  if (room.phase !== 'playing' || !room.game) return;
  const game = room.game;
  const keys = Object.keys(game.snakes);
  const nextHeads = {};
  const eatsApple = {};

  for (const key of keys) {
    const snake = game.snakes[key];
    if (snake.nextDirection) {
      snake.direction = snake.nextDirection;
      snake.nextDirection = null;
    }
    const vector = DIRECTIONS[snake.direction];
    const head = snake.body[0];
    nextHeads[key] = {
      x: wrap(head.x + vector.x, game.width),
      y: wrap(head.y + vector.y, game.height)
    };
    eatsApple[key] = Boolean(game.apple && nextHeads[key].x === game.apple.x && nextHeads[key].y === game.apple.y);
  }

  const occupied = new Set();
  for (const key of keys) {
    const body = game.snakes[key].body;
    const end = eatsApple[key] ? body.length : body.length - 1;
    for (let i = 0; i < end; i += 1) occupied.add(`${body[i].x},${body[i].y}`);
  }

  const crashed = new Set();
  for (const key of keys) {
    const head = nextHeads[key];
    if (occupied.has(`${head.x},${head.y}`)) crashed.add(key);
  }
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = nextHeads[keys[i]];
      const b = nextHeads[keys[j]];
      if (a.x === b.x && a.y === b.y) {
        crashed.add(keys[i]);
        crashed.add(keys[j]);
      }
    }
  }

  if (crashed.size > 0) {
    finishGame(room, 'collision', null, [...crashed]);
    return;
  }

  let appleEater = null;
  for (const key of keys) {
    const snake = game.snakes[key];
    snake.body.unshift(nextHeads[key]);
    if (!eatsApple[key]) snake.body.pop();
    else {
      appleEater = key;
      game.totalApples += 1;
    }
  }

  if (appleEater) {
    // Cooperative score: every player sees exactly the same team total.
    for (const key of keys) game.scores[key] = game.totalApples;
    const player = room.players.find((candidate) => candidate.key === appleEater);
    if (player && player.socketId) io.to(player.socketId).emit('game:reward', { amount: 1, total: game.totalApples });
    game.apple = randomEmptyCell(game);
  }
  if (!game.apple) {
    finishGame(room, 'board-full');
    return;
  }
  broadcastGame(room);
}

function startTicking(room) {
  clearRoomTimer(room);
  room.tickTimer = setInterval(() => tickRoom(room), TICK_MS);
}

function scheduleLobbyCleanup(room, player) {
  clearPlayerTimer(player);
  player.cleanupTimer = setTimeout(() => {
    if (player.connected || room.phase !== 'lobby') return;
    room.players = room.players.filter((candidate) => candidate !== player);
    if (room.hostKey === player.key && room.players.length) room.hostKey = room.players[0].key;
    if (!removeRoomIfEmpty(room)) broadcastRoom(room);
  }, LOBBY_GRACE_MS);
}

function scheduleDisconnectForfeit(room) {
  clearDisconnectTimer(room);
  room.disconnectTimer = setTimeout(() => {
    if (room.phase === 'paused') finishGame(room, 'disconnect');
  }, RECONNECT_GRACE_MS);
}

function detachForLeave(socket, room, player) {
  clearPlayerTimer(player);
  player.connected = false;
  player.socketId = null;
  socket.leave(room.code);
  socket.data.roomCode = null;
  socket.data.playerKey = null;

  if (room.phase === 'playing') {
    finishGame(room, 'disconnect');
  } else if (room.phase === 'lobby') {
    room.players = room.players.filter((candidate) => candidate !== player);
    if (room.hostKey === player.key && room.players.length) room.hostKey = room.players[0].key;
    if (!removeRoomIfEmpty(room)) broadcastRoom(room);
  } else {
    broadcastRoom(room);
  }
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.playerKey = null;

  socket.on('room:create', (payload = {}, ack) => {
    const existing = getSocketPlayer(socket);
    if (existing) detachForLeave(socket, existing.room, existing.player);
    try {
      const room = makeRoom();
      const player = newPlayer('p1', payload.name, payload.skin);
      room.players.push(player);
      attachPlayer(socket, room, player);
      sendCurrentState(socket, room, player);
      broadcastRoom(room);
      if (typeof ack === 'function') ack({ ok: true, code: room.code, token: player.token, selfId: player.key, room: publicRoom(room), game: null });
    } catch (error) {
      console.error('room:create error', error);
      ackError(ack, 'No se pudo crear la sala. Inténtalo otra vez.');
    }
  });

  socket.on('room:join', (payload = {}, ack) => {
    const code = String(payload.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
    const room = rooms.get(code);
    if (!room) return ackError(ack, 'No encontramos esa sala. Revisa el código.');
    if (room.phase !== 'lobby') return ackError(ack, 'La partida ya ha empezado o ha terminado.');
    if (room.players.length >= MAX_PLAYERS) return ackError(ack, 'Esta sala ya tiene cuatro jugadores.');

    const existing = getSocketPlayer(socket);
    if (existing && existing.room.code === room.code) return ackError(ack, 'Ya estás dentro de esta sala.');
    if (existing) detachForLeave(socket, existing.room, existing.player);
    try {
      const playerKey = ['p1', 'p2', 'p3', 'p4'].find((key) => !room.players.some((candidate) => candidate.key === key));
      if (!playerKey) return ackError(ack, 'Esta sala ya tiene cuatro jugadores.');
      const player = newPlayer(playerKey, payload.name, payload.skin);
      room.players.push(player);
      attachPlayer(socket, room, player);
      sendCurrentState(socket, room, player);
      broadcastRoom(room);
      if (typeof ack === 'function') ack({ ok: true, code: room.code, token: player.token, selfId: player.key, room: publicRoom(room), game: null });
    } catch (error) {
      console.error('room:join error', error);
      ackError(ack, 'No se pudo entrar en la sala. Inténtalo otra vez.');
    }
  });

  socket.on('room:resume', (payload = {}, ack) => {
    const code = String(payload.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
    const room = rooms.get(code);
    const token = String(payload.token || '');
    const player = room && room.players.find((candidate) => candidate.token === token);
    if (!room || !player) return ackError(ack, 'No se ha podido recuperar la sala. Crea o únete a otra.');

    if (player.socketId && player.socketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(player.socketId);
      if (oldSocket) oldSocket.disconnect(true);
    }
    attachPlayer(socket, room, player);

    if (room.phase === 'paused' && room.players.length > 0 && room.players.every((candidate) => candidate.connected)) {
      clearDisconnectTimer(room);
      room.phase = 'playing';
      room.game.status = 'running';
      startTicking(room);
    }
    sendCurrentState(socket, room, player);
    broadcastRoom(room);
    if (room.phase === 'playing') broadcastGame(room);
    if (typeof ack === 'function') ack({ ok: true, code: room.code, token: player.token, selfId: player.key, room: publicRoom(room), game: publicGame(room) });
  });

  socket.on('player:skin', (payload = {}, ack) => {
    const current = getSocketPlayer(socket);
    if (!current) return ackError(ack, 'No estás dentro de una sala.');
    current.player.skin = cleanSkin(payload.skin);
    broadcastRoom(current.room);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('room:start', (_payload, ack) => {
    const current = getSocketPlayer(socket);
    if (!current) return ackError(ack, 'No estás dentro de una sala.');
    const { room, player } = current;
    if (player.key !== room.hostKey) return ackError(ack, 'Solo quien creó la sala puede empezar.');
    if (room.phase !== 'lobby') return ackError(ack, 'La sala ya no está esperando para empezar.');
    if (room.players.length < 1 || room.players.some((candidate) => !candidate.connected)) {
      return ackError(ack, 'Esperad a que estén conectados todos los jugadores.');
    }
    startGame(room);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('game:rematch', (_payload, ack) => {
    const current = getSocketPlayer(socket);
    if (!current) return ackError(ack, 'No estás dentro de una sala.');
    const { room, player } = current;
    if (player.key !== room.hostKey) return ackError(ack, 'Solo quien creó la sala puede iniciar la revancha.');
    if (room.phase !== 'finished') return ackError(ack, 'La partida todavía no ha terminado.');
    if (room.players.length < 1 || room.players.some((candidate) => !candidate.connected)) {
      return ackError(ack, 'Todos los jugadores de la sala tienen que seguir conectados para la revancha.');
    }
    startGame(room);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('game:turn', (payload = {}) => {
    const current = getSocketPlayer(socket);
    if (!current || current.room.phase !== 'playing' || !current.room.game) return;
    const { room, player } = current;
    const snake = room.game.snakes[player.key];
    const direction = String(payload.direction || '');
    if (!snake || !Object.hasOwn(DIRECTIONS, direction)) return;
    // Allow at most one turn per server tick. This prevents two rapid inputs
    // from combining into a 180-degree reversal before the next move.
    if (snake.nextDirection || direction === snake.direction) return;
    if (isOpposite(snake.direction, direction)) return;
    snake.nextDirection = direction;
  });

  socket.on('room:leave', (_payload, ack) => {
    const current = getSocketPlayer(socket);
    if (!current) {
      if (typeof ack === 'function') ack({ ok: true });
      return;
    }
    detachForLeave(socket, current.room, current.player);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const current = getSocketPlayer(socket);
    if (!current) return;
    const { room, player } = current;
    player.connected = false;
    player.socketId = null;
    if (room.phase === 'playing') {
      clearRoomTimer(room);
      room.phase = 'paused';
      room.game.status = 'paused';
      scheduleDisconnectForfeit(room);
      broadcastRoom(room);
      broadcastGame(room);
    } else if (room.phase === 'lobby') {
      scheduleLobbyCleanup(room, player);
      broadcastRoom(room);
    } else {
      broadcastRoom(room);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serpiente Zen escuchando en el puerto ${PORT}`);
});
