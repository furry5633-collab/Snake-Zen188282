'use strict';

const SKINS = {
  mint: { name: 'Menta', price: 0, color: '#a7e773', dark: '#56a45b', head: '#d3fa89', soft: '#e3f5c9', emoji: '🌿' },
  citrus: { name: 'Cítrico', price: 0, color: '#ffb765', dark: '#e98245', head: '#ffe08b', soft: '#fff0d6', emoji: '🍊' },
  berry: { name: 'Frambuesa', price: 12, color: '#f08ab0', dark: '#c9527a', head: '#ffc2d4', soft: '#fae1eb', emoji: '🍓' },
  ocean: { name: 'Laguna', price: 24, color: '#73cce0', dark: '#348ca6', head: '#b5edf0', soft: '#d9f1f2', emoji: '🌊' },
  grape: { name: 'Uva', price: 36, color: '#b39af2', dark: '#7956bd', head: '#d9caff', soft: '#ece5fa', emoji: '🍇' },
  gold: { name: 'Dorada', price: 50, color: '#f3d263', dark: '#b3922e', head: '#ffeda2', soft: '#f8f0cf', emoji: '✨' }
};
const BASE_PROFILE = { seeds: 0, unlocked: ['mint', 'citrus'], equipped: 'mint' };
const PROFILE_KEY = 'snakezen.profile.v1';
const NAME_KEY = 'snakezen.playerName.v1';
const SESSION_KEY = 'snakezen.activeRoom.v1';
const VALID_DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return { ...BASE_PROFILE, unlocked: [...BASE_PROFILE.unlocked] };
    const unlocked = new Set(BASE_PROFILE.unlocked);
    if (Array.isArray(parsed.unlocked)) {
      parsed.unlocked.forEach((skin) => { if (Object.hasOwn(SKINS, skin)) unlocked.add(skin); });
    }
    const equipped = Object.hasOwn(SKINS, parsed.equipped) && unlocked.has(parsed.equipped) ? parsed.equipped : 'mint';
    return {
      seeds: Number.isFinite(Number(parsed.seeds)) ? Math.max(0, Math.floor(Number(parsed.seeds))) : 0,
      unlocked: [...unlocked],
      equipped
    };
  } catch (_error) {
    return { ...BASE_PROFILE, unlocked: [...BASE_PROFILE.unlocked] };
  }
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved && typeof saved.code === 'string' && typeof saved.token === 'string') return saved;
  } catch (_error) { /* A corrupt local session can safely be discarded. */ }
  return null;
}

function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (_error) { /* Storage may be disabled. */ }
}

function saveSession(code, token) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ code, token })); } catch (_error) { /* Storage may be disabled. */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_error) { /* Storage may be disabled. */ }
}

let profile = loadProfile();
let room = null;
let selfId = null;
let game = null;
let socketConnected = false;
let resumePending = false;
let actionBusy = false;
let pendingDirection = null;
let toastTimeout = null;
let applesSinceToast = 0;
const socket = io();

const $ = (selector) => document.querySelector(selector);
const homeView = $('#homeView');
const roomView = $('#roomView');
const gameView = $('#gameView');
const gameCanvas = $('#gameCanvas');
const gameContext = gameCanvas.getContext('2d');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function emitAck(eventName, payload = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error('No hay conexión con el servidor. Espera un momento y vuelve a probar.'));
      return;
    }
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('El servidor tarda en responder. Comprueba la conexión e inténtalo otra vez.'));
      }
    }, timeoutMs);
    socket.emit(eventName, payload, (response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (response && response.ok) resolve(response);
      else reject(new Error(response?.error || 'Ha ocurrido un error. Inténtalo de nuevo.'));
    });
  });
}

function showToast(message, duration = 2800) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('is-visible');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => node.classList.remove('is-visible'), duration);
}

function currentName() {
  const input = $('#playerName');
  const name = input.value.trim().slice(0, 18);
  if (name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (_error) { /* Optional preference. */ }
  }
  return name || 'Jugador';
}

function setBusy(value) {
  actionBusy = value;
  renderConnection();
}

function renderConnection() {
  const chip = $('#connectionChip');
  chip.classList.toggle('is-online', socketConnected);
  chip.classList.toggle('is-offline', !socketConnected && !resumePending);
  const label = $('#connectionLabel');
  if (resumePending) label.textContent = 'Recuperando sala';
  else label.textContent = socketConnected ? 'En línea' : 'Reconectando';
  $('#createRoom').disabled = !socketConnected || actionBusy || resumePending;
  $('#joinForm').querySelector('button[type="submit"]').disabled = !socketConnected || actionBusy || resumePending;
  $('#openShop').disabled = false;
}

function updateWallet() {
  $('#seedCount').textContent = String(profile.seeds);
  $('#shopSeedCount').textContent = String(profile.seeds);
}

function applyRoomState(data) {
  if (!data || !data.room) return;
  room = data.room;
  if (data.selfId) selfId = data.selfId;
  if (Object.hasOwn(data, 'game')) game = data.game;
  if (data.token) saveSession(data.room.code, data.token);
  resumePending = false;
  pendingDirection = null;
  renderAll();
}

function renderAll() {
  const inRoom = Boolean(room);
  const inLobby = inRoom && room.phase === 'lobby';
  homeView.hidden = inRoom;
  roomView.hidden = !inLobby;
  gameView.hidden = !inRoom || inLobby;
  renderConnection();
  updateWallet();
  renderRoom();
  if (inRoom && !inLobby) renderGame();
  if (shopOpen) renderShop();
}

function renderRoom() {
  if (!room) return;
  $('#roomCodeDisplay').textContent = room.code;
  $('#gameRoomCode').textContent = room.code;
  const sorted = [...room.players].sort((a, b) => a.key.localeCompare(b.key));
  $('#playerCountLabel').textContent = `${sorted.filter((player) => player.connected).length} DE 2`;
  const slots = sorted.map((player) => {
    const skin = SKINS[player.skin] || SKINS.mint;
    const isSelf = player.key === selfId;
    const host = room.hostKey === player.key;
    return `<div class="player-slot">
      <div class="player-avatar ${player.connected ? '' : 'is-offline'}" style="background:${skin.soft};color:${skin.dark}">${skin.emoji}</div>
      <div class="player-slot-info">
        <div class="player-slot-name">${escapeHtml(player.name)}${isSelf ? ' <span>(tú)</span>' : ''}</div>
        <div class="player-slot-sub">${player.connected ? 'Conectado · ' + escapeHtml(skin.name) : 'Reconectando…'}</div>
      </div>
      ${host ? '<span class="host-pill">ANFITRIÓN</span>' : ''}
    </div>`;
  });
  if (sorted.length < 2) {
    slots.push(`<div class="player-slot empty-slot">
      <span class="empty-plus">＋</span>
      <div class="player-slot-info"><div class="player-slot-name">Esperando a alguien</div><div class="player-slot-sub">Comparte el código de arriba</div></div>
    </div>`);
  }
  $('#playerSlots').innerHTML = slots.join('');
  const ready = sorted.length === 2 && sorted.every((player) => player.connected);
  const isHost = room.hostKey === selfId;
  const start = $('#startGame');
  start.disabled = !isHost || !ready || actionBusy;
  start.innerHTML = isHost && ready
    ? 'Empezar juntos <span aria-hidden="true">→</span>'
    : isHost
      ? 'Esperando al segundo jugador <span aria-hidden="true">→</span>'
      : 'Esperando al anfitrión <span aria-hidden="true">→</span>';
  $('#hostNote').textContent = isHost
    ? (ready ? 'Todo listo. Al pulsar, empezará el modo Zen para los dos.' : 'Al crear la sala, tú eres quien puede iniciar la partida.')
    : 'La persona que creó la sala iniciará la partida.';
  $('#roomHint').innerHTML = ready
    ? '<span class="hint-icon">✦</span><span>¡Ya estáis los dos! El anfitrión puede empezar cuando quiera.</span>'
    : '<span class="hint-icon">✦</span><span>Cuando llegue tu amigo, podréis empezar la partida juntos.</span>';
}

function renderScoreboard() {
  if (!room) return;
  const orderedPlayers = ['p1', 'p2'].map((key) => room.players.find((player) => player.key === key)).filter(Boolean);
  const cards = orderedPlayers.map((player) => {
    const skin = SKINS[player.skin] || SKINS.mint;
    const apples = game?.scores?.[player.key] ?? 0;
    return `<div class="score-card">
      <div class="score-snake" style="background:${skin.color};box-shadow:inset 0 -4px 0 ${skin.dark}55"></div>
      <div class="score-player-info"><div class="score-player-name">${escapeHtml(player.name)}${player.key === selfId ? ' · tú' : ''}</div><div class="score-player-tag">${escapeHtml(skin.name.toUpperCase())}</div></div>
      <div class="score-value">${apples}<small>🍎</small></div>
    </div>`;
  });
  $('#scoreboard').innerHTML = cards.join('');
}

function updateProgress() {
  const width = game?.width || 22;
  const height = game?.height || 16;
  const total = width * height;
  const occupied = game?.snakes
    ? Object.values(game.snakes).reduce((sum, snake) => sum + (snake?.body?.length || 0), 0)
    : 6;
  const percent = Math.min(100, Math.floor(occupied / total * 100));
  $('#fillPercent').textContent = `${percent}%`;
  $('#occupiedCount').textContent = String(occupied);
  $('#boardCellCount').textContent = `/ ${total} casillas`;
  $('#progressFill').style.width = `${percent}%`;
}

function resultCopy() {
  const result = game?.result;
  if (!result) return null;
  if (result.type === 'board-full') {
    return { emoji: '🌳', kicker: 'LO HABÉIS HECHO EN EQUIPO', title: '¡Jardín completo!', body: `Habéis ocupado las ${game.width * game.height} casillas. Qué buena pareja de serpientes.` };
  }
  if (result.type === 'draw') {
    return { emoji: '💫', kicker: 'CHOQUE SIMULTÁNEO', title: '¡Vaya giro!', body: 'Las dos serpientes chocaron a la vez. ¿Probáis otra vez con más coordinación?' };
  }
  if (result.type === 'collision') {
    if (result.winnerId === selfId) {
      const loser = room.players.find((player) => player.key === result.loserId);
      return { emoji: '🏅', kicker: 'FIN DE LA RONDA', title: '¡Sigues en pie!', body: `${escapeHtml(loser?.name || 'La otra serpiente')} chocó. Puedes invitarle a una revancha.` };
    }
    return { emoji: '🌱', kicker: 'FIN DE LA RONDA', title: 'Has chocado.', body: 'La partida termina al tocar una cola. Respira y probad otra vez: no hay prisa.' };
  }
  if (result.type === 'forfeit') {
    if (result.winnerId === selfId) return { emoji: '🏅', kicker: 'FIN DE LA RONDA', title: 'La ronda es tuya.', body: 'La otra persona salió de la sala. Cuando volváis a estar juntos, podréis empezar de nuevo.' };
    return { emoji: '🌿', kicker: 'FIN DE LA RONDA', title: 'Sala desconectada.', body: 'La otra persona salió de la sala. Puedes volver al inicio y crear un grupo nuevo.' };
  }
  return { emoji: '🌿', kicker: 'CONEXIÓN CERRADA', title: 'La partida se ha pausado.', body: 'No se pudo recuperar la conexión a tiempo. Volved a reuniros en la sala para jugar otra vez.' };
}

function renderOverlay() {
  const overlay = $('#gameOverlay');
  if (!room || room.phase === 'lobby') {
    overlay.hidden = true;
    overlay.innerHTML = '';
    return;
  }
  if (!socketConnected) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="overlay-card overlay-waiting"><div class="overlay-spinner"></div><span class="section-kicker">RECUPERANDO CONEXIÓN</span><h2>Volvemos enseguida.</h2><p>La partida está pausada mientras recuperamos la conexión.</p></div>`;
    return;
  }
  if (room.phase === 'paused' || game?.status === 'paused') {
    const disconnected = room.players.find((player) => !player.connected);
    overlay.hidden = false;
    overlay.innerHTML = `<div class="overlay-card overlay-waiting"><div class="overlay-spinner"></div><span class="section-kicker">PAUSA ZEN</span><h2>Esperando a ${escapeHtml(disconnected?.name || 'tu compañero')}.</h2><p>La partida se reanudará si vuelve a conectarse.</p></div>`;
    return;
  }
  const result = resultCopy();
  if (room.phase === 'finished' || game?.status === 'finished') {
    if (!result) {
      overlay.hidden = false;
      overlay.innerHTML = `<div class="overlay-card"><div class="overlay-emoji">🌿</div><h2>La ronda ha terminado.</h2></div>`;
      return;
    }
    const bothConnected = room.players.length === 2 && room.players.every((player) => player.connected);
    const canRematch = bothConnected && room.hostKey === selfId;
    const waitingHost = bothConnected && room.hostKey !== selfId;
    const button = canRematch
      ? '<button class="button button-lime" data-action="rematch" type="button">Otra partida <span aria-hidden="true">→</span></button>'
      : waitingHost
        ? '<p class="overlay-footnote">El anfitrión puede iniciar la revancha.</p>'
        : '<p class="overlay-footnote">Puedes salir y crear otro grupo desde el inicio.</p>';
    overlay.hidden = false;
    overlay.innerHTML = `<div class="overlay-card"><div class="overlay-emoji">${result.emoji}</div><span class="section-kicker">${result.kicker}</span><h2>${result.title}</h2><p>${result.body}</p>${button}</div>`;
    return;
  }
  if (!game) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="overlay-card overlay-waiting"><div class="overlay-spinner"></div><span class="section-kicker">PREPARANDO EL JARDÍN</span><h2>Un momento…</h2></div>`;
    return;
  }
  overlay.hidden = true;
  overlay.innerHTML = '';
}

function drawApple(ctx, x, y, cell) {
  const cx = x * cell + cell / 2;
  const cy = y * cell + cell / 2 + 1;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .22)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 3;
  const gradient = ctx.createLinearGradient(cx - 11, cy - 13, cx + 10, cy + 12);
  gradient.addColorStop(0, '#ff8c70');
  gradient.addColorStop(.48, '#f45146');
  gradient.addColorStop(1, '#df3e3b');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 7);
  ctx.bezierCurveTo(cx - 10, cy - 15, cx - 17, cy - 5, cx - 10, cy + 7);
  ctx.bezierCurveTo(cx - 4, cy + 17, cx + 4, cy + 16, cx + 10, cy + 7);
  ctx.bezierCurveTo(cx + 17, cy - 4, cx + 9, cy - 14, cx, cy - 7);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#755c37';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.quadraticCurveTo(cx + 1, cy - 15, cx + 5, cy - 16);
  ctx.stroke();
  ctx.fillStyle = '#8fd475';
  ctx.beginPath();
  ctx.ellipse(cx + 8, cy - 13, 5, 2.5, -.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSnake(ctx, snake, skinKey, cell) {
  if (!snake?.body?.length) return;
  const skin = SKINS[skinKey] || SKINS.mint;
  for (let i = snake.body.length - 1; i >= 1; i -= 1) {
    const segment = snake.body[i];
    const inset = 3.5;
    ctx.save();
    ctx.fillStyle = i % 2 === 0 ? skin.dark : skin.color;
    ctx.globalAlpha = Math.max(.77, 1 - i * .00045);
    ctx.beginPath();
    ctx.roundRect(segment.x * cell + inset, segment.y * cell + inset, cell - inset * 2, cell - inset * 2, 10);
    ctx.fill();
    ctx.restore();
  }
  const head = snake.body[0];
  const hx = head.x * cell;
  const hy = head.y * cell;
  ctx.save();
  ctx.shadowColor = 'rgba(5, 19, 12, .22)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  const headGradient = ctx.createLinearGradient(hx + 3, hy + 3, hx + cell - 3, hy + cell - 3);
  headGradient.addColorStop(0, skin.head);
  headGradient.addColorStop(1, skin.color);
  ctx.fillStyle = headGradient;
  ctx.beginPath();
  ctx.roundRect(hx + 2.5, hy + 2.5, cell - 5, cell - 5, 12);
  ctx.fill();
  ctx.restore();

  const eyePositions = {
    right: [[hx + 28, hy + 13], [hx + 28, hy + 27]],
    left: [[hx + 12, hy + 13], [hx + 12, hy + 27]],
    up: [[hx + 13, hy + 12], [hx + 27, hy + 12]],
    down: [[hx + 13, hy + 28], [hx + 27, hy + 28]]
  }[snake.direction] || [[hx + 28, hy + 13], [hx + 28, hy + 27]];
  for (const [ex, ey] of eyePositions) {
    ctx.fillStyle = '#254432';
    ctx.beginPath();
    ctx.arc(ex, ey, 2.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath();
    ctx.arc(ex + .55, ey - .65, .75, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBoard() {
  if (!gameCanvas || gameCanvas.offsetParent === null) return;
  const wrapper = gameCanvas.parentElement;
  const cssWidth = Math.max(1, wrapper.clientWidth);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssHeight = cssWidth * 640 / 880;
  gameCanvas.style.width = `${cssWidth}px`;
  gameCanvas.style.height = `${cssHeight}px`;
  gameCanvas.width = Math.round(cssWidth * dpr);
  gameCanvas.height = Math.round(cssHeight * dpr);
  gameContext.setTransform(gameCanvas.width / 880, 0, 0, gameCanvas.height / 640, 0, 0);

  const ctx = gameContext;
  const width = game?.width || 22;
  const height = game?.height || 16;
  const cell = 880 / width;
  ctx.clearRect(0, 0, 880, 640);
  ctx.fillStyle = '#163d30';
  ctx.fillRect(0, 0, 880, 640);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(208, 242, 186, .018)';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  ctx.strokeStyle = 'rgba(217, 241, 205, .055)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < width; x += 1) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, 640); }
  for (let y = 1; y < height; y += 1) { ctx.moveTo(0, y * cell); ctx.lineTo(880, y * cell); }
  ctx.stroke();

  if (game?.apple) drawApple(ctx, game.apple.x, game.apple.y, cell);
  const playerByKey = Object.fromEntries((room?.players || []).map((player) => [player.key, player]));
  ['p2', 'p1'].forEach((key) => {
    const player = playerByKey[key];
    drawSnake(ctx, game?.snakes?.[key], player?.skin || (key === 'p1' ? 'mint' : 'citrus'), cell);
  });
}

function renderGame() {
  if (!room || room.phase === 'lobby') return;
  renderScoreboard();
  updateProgress();
  const status = $('#boardStatus');
  if (room.phase === 'paused') status.textContent = 'ESPERANDO CONEXIÓN';
  else if (room.phase === 'finished') status.textContent = 'RONDA TERMINADA';
  else status.textContent = 'A COMER MANZANAS';
  renderOverlay();
  window.requestAnimationFrame(drawBoard);
}

function renderShop() {
  updateWallet();
  const grid = $('#skinGrid');
  grid.innerHTML = Object.entries(SKINS).map(([id, skin]) => {
    const unlocked = profile.unlocked.includes(id);
    const equipped = profile.equipped === id;
    let label = 'Comprar';
    let stateClass = '';
    let disabled = false;
    if (equipped) {
      label = 'Equipada ✓';
      stateClass = 'is-equipped';
      disabled = true;
    } else if (unlocked) {
      label = 'Elegir skin';
      stateClass = 'is-buy';
    } else if (profile.seeds >= skin.price) {
      label = `Comprar · ${skin.price} ✦`;
      stateClass = 'is-buy';
    } else {
      label = `Faltan ${skin.price - profile.seeds} ✦`;
      stateClass = 'is-locked';
      disabled = true;
    }
    return `<article class="skin-card">
      <div class="skin-preview"><span class="skin-worm" style="--skin-color:${skin.color}"><i></i><i></i><i></i><i></i></span></div>
      <h3>${escapeHtml(skin.name)} ${skin.emoji}</h3>
      <p>${unlocked ? (skin.price === 0 ? 'Disponible' : 'Desbloqueada') : `${skin.price} semillas`}</p>
      <button class="skin-action button ${stateClass}" type="button" data-skin-id="${id}" ${disabled ? 'disabled' : ''}>${label}</button>
    </article>`;
  }).join('');
}

let shopOpen = false;
function openShop() {
  shopOpen = true;
  renderShop();
  $('#shopModal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#closeShop').focus();
}
function closeShop() {
  shopOpen = false;
  $('#shopModal').hidden = true;
  document.body.style.overflow = '';
}

function equipSkin(id) {
  if (!Object.hasOwn(SKINS, id)) return;
  const skin = SKINS[id];
  if (!profile.unlocked.includes(id)) {
    if (profile.seeds < skin.price) return;
    profile.seeds -= skin.price;
    profile.unlocked.push(id);
    showToast(`¡${skin.name} desbloqueada!`);
  }
  profile.equipped = id;
  saveProfile();
  updateWallet();
  renderShop();
  if (room && socketConnected) {
    socket.emit('player:skin', { skin: id });
  }
  renderAll();
}

async function createRoom() {
  if (actionBusy || !socketConnected || resumePending) return;
  setBusy(true);
  try {
    const response = await emitAck('room:create', { name: currentName(), skin: profile.equipped });
    applyRoomState(response);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function joinRoom(code) {
  if (actionBusy || !socketConnected || resumePending) return;
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (normalized.length !== 6) {
    showToast('El código de sala tiene seis caracteres.');
    return;
  }
  setBusy(true);
  try {
    const response = await emitAck('room:join', { code: normalized, name: currentName(), skin: profile.equipped });
    applyRoomState(response);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function startGame() {
  if (actionBusy) return;
  setBusy(true);
  try {
    await emitAck('room:start');
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function rematch() {
  if (actionBusy) return;
  setBusy(true);
  try {
    await emitAck('game:rematch');
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function leaveRoom() {
  if (socketConnected) {
    try { await emitAck('room:leave', {}, 2500); } catch (_error) { /* Local exit should still work offline. */ }
  }
  clearSession();
  room = null;
  selfId = null;
  game = null;
  resumePending = false;
  pendingDirection = null;
  setBusy(false);
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleDirection(direction) {
  if (!VALID_DIRECTIONS.has(direction) || !socketConnected || !room || room.phase !== 'playing' || !game) return;
  if (pendingDirection) return;
  const current = game.snakes?.[selfId]?.direction;
  const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
  if (!current || direction === current || direction === opposites[current]) return;
  pendingDirection = direction;
  socket.emit('game:turn', { direction });
}

function init() {
  $('#playerName').value = (() => {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (_error) { return ''; }
  })();
  $('#playerName').addEventListener('input', currentName);
  $('#createRoom').addEventListener('click', createRoom);
  $('#joinForm').addEventListener('submit', (event) => {
    event.preventDefault();
    joinRoom($('#roomCodeInput').value);
  });
  $('#roomCodeInput').addEventListener('input', (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  $('#startGame').addEventListener('click', startGame);
  $('#roomBack').addEventListener('click', leaveRoom);
  $('#gameLeave').addEventListener('click', leaveRoom);
  $('#brandHome').addEventListener('click', (event) => {
    event.preventDefault();
    if (room) showToast('Sal de la sala para volver al inicio.');
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#copyCode').addEventListener('click', async () => {
    if (!room?.code) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(room.code);
      else {
        const temporary = document.createElement('textarea');
        temporary.value = room.code;
        document.body.appendChild(temporary);
        temporary.select();
        document.execCommand('copy');
        temporary.remove();
      }
      showToast(`Código ${room.code} copiado.`);
    } catch (_error) {
      showToast(`Comparte este código: ${room.code}`);
    }
  });
  $('#openShop').addEventListener('click', openShop);
  $('#closeShop').addEventListener('click', closeShop);
  $('#shopModal').addEventListener('click', (event) => {
    if (event.target === $('#shopModal')) closeShop();
  });
  $('#skinGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-skin-id]');
    if (button && !button.disabled) equipSkin(button.dataset.skinId);
  });
  $('#gameOverlay').addEventListener('click', (event) => {
    if (event.target.closest('[data-action="rematch"]')) rematch();
  });
  document.querySelectorAll('[data-direction]').forEach((button) => {
    button.addEventListener('click', () => handleDirection(button.dataset.direction));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shopOpen) closeShop();
    if (!room || room.phase !== 'playing' || shopOpen) return;
    const target = event.target;
    if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
    const key = event.key.toLowerCase();
    const directions = {
      arrowup: 'up', w: 'up',
      arrowdown: 'down', s: 'down',
      arrowleft: 'left', a: 'left',
      arrowright: 'right', d: 'right'
    };
    if (directions[key]) {
      event.preventDefault();
      handleDirection(directions[key]);
    }
  });
  window.addEventListener('resize', () => window.requestAnimationFrame(drawBoard));

  socket.on('connect', async () => {
    socketConnected = true;
    renderConnection();
    const saved = loadSession();
    if (saved) {
      resumePending = true;
      renderAll();
      try {
        const response = await emitAck('room:resume', saved);
        applyRoomState(response);
      } catch (error) {
        clearSession();
        room = null;
        selfId = null;
        game = null;
        resumePending = false;
        renderAll();
        showToast(error.message, 3600);
      }
    } else {
      resumePending = false;
      renderConnection();
    }
  });
  socket.on('disconnect', () => {
    socketConnected = false;
    renderConnection();
    if (room) renderGame();
  });
  socket.on('connect_error', () => {
    socketConnected = false;
    renderConnection();
  });
  socket.on('room:state', (payload) => applyRoomState(payload));
  socket.on('room:update', (updatedRoom) => {
    if (!room || updatedRoom.code !== room.code) return;
    room = updatedRoom;
    renderAll();
  });
  socket.on('game:state', (updatedGame) => {
    game = updatedGame;
    pendingDirection = null;
    renderGame();
  });
  socket.on('game:reward', (reward) => {
    const amount = Math.max(0, Math.floor(Number(reward?.amount) || 0));
    if (!amount) return;
    profile.seeds += amount;
    saveProfile();
    updateWallet();
    if (shopOpen) renderShop();
    applesSinceToast += amount;
    if (applesSinceToast >= 5) {
      showToast(`¡Buena cosecha! +${applesSinceToast} semillas`);
      applesSinceToast = 0;
    }
  });

  renderConnection();
  updateWallet();
  renderAll();
}

init();
