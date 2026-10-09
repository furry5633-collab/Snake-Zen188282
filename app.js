'use strict';

const SKINS = {
  mint: { name: 'Menta', price: 0, color: '#a7e773', dark: '#56a45b', head: '#d3fa89', soft: '#e3f5c9', emoji: '🌿' },
  citrus: { name: 'Cítrico', price: 0, color: '#ffb765', dark: '#e98245', head: '#ffe08b', soft: '#fff0d6', emoji: '🍊' },
  berry: { name: 'Frambuesa', price: 12, color: '#f08ab0', dark: '#c9527a', head: '#ffc2d4', soft: '#fae1eb', emoji: '🍓' },
  ocean: { name: 'Laguna', price: 24, color: '#73cce0', dark: '#348ca6', head: '#b5edf0', soft: '#d9f1f2', emoji: '🌊' },
  grape: { name: 'Uva', price: 36, color: '#b39af2', dark: '#7956bd', head: '#d9caff', soft: '#ece5fa', emoji: '🍇' },
  gold: { name: 'Dorada', price: 50, color: '#f3d263', dark: '#b3922e', head: '#ffeda2', soft: '#f8f0cf', emoji: '✨' },
  lava: { name: 'Lava', price: 62, color: '#ff775c', dark: '#c94e3b', head: '#ffb07c', soft: '#ffe0d7', emoji: '🌋' },
  bamboo: { name: 'Bambú', price: 74, color: '#78b976', dark: '#4b8952', head: '#b8e38f', soft: '#e1f0dc', emoji: '🎋' },
  midnight: { name: 'Medianoche', price: 88, color: '#7884cf', dark: '#4e5ba7', head: '#bac6ff', soft: '#e2e6fb', emoji: '🌙' },
  coral: { name: 'Coral', price: 102, color: '#ff8b79', dark: '#d45d5e', head: '#ffc1a7', soft: '#ffe5df', emoji: '🪸' },
  cloud: { name: 'Nube', price: 116, color: '#b9cde9', dark: '#708db3', head: '#e4f0ff', soft: '#e9f0fa', emoji: '☁️' },
  neon: { name: 'Neón', price: 132, color: '#5fdbbe', dark: '#278e7d', head: '#b0ffe1', soft: '#d9f5ed', emoji: '💠' }
};
const BOARD_THEMES = {
  garden: { name: 'Jardín', price: 0, base: '#163d30', tile: 'rgba(208,242,186,.035)', grid: 'rgba(217,241,205,.085)', accent: '#d8f2c2', preview: '#163d30' },
  ocean: { name: 'Laguna', price: 25, base: '#123b4d', tile: 'rgba(122,218,224,.09)', grid: 'rgba(181,239,241,.14)', accent: '#b5eff1', preview: '#123b4d' },
  sunset: { name: 'Atardecer', price: 55, base: '#513345', tile: 'rgba(255,190,154,.085)', grid: 'rgba(255,218,190,.14)', accent: '#ffdabe', preview: '#513345' },
  moon: { name: 'Luna', price: 85, base: '#202a4b', tile: 'rgba(172,190,255,.085)', grid: 'rgba(209,220,255,.14)', accent: '#d1dcff', preview: '#202a4b' }
};
const BASE_PROFILE = { seeds: 0, unlocked: ['mint', 'citrus'], equipped: 'mint', boardTheme: 'garden', unlockedBoardThemes: ['garden'] };
const PROFILE_KEY = 'snakezen.profile.v1';
const SETTINGS_KEY = 'snakezen.settings.v1';
const NAME_KEY = 'snakezen.playerName.v1';
const SESSION_KEY = 'snakezen.activeRoom.v1';
const VALID_DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const DEFAULT_SETTINGS = { sound: false, vibration: false };

function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return { ...BASE_PROFILE, unlocked: [...BASE_PROFILE.unlocked], unlockedBoardThemes: [...BASE_PROFILE.unlockedBoardThemes] };
    const unlocked = new Set(BASE_PROFILE.unlocked);
    if (Array.isArray(parsed.unlocked)) {
      parsed.unlocked.forEach((skin) => { if (Object.hasOwn(SKINS, skin)) unlocked.add(skin); });
    }
    const equipped = Object.hasOwn(SKINS, parsed.equipped) && unlocked.has(parsed.equipped) ? parsed.equipped : 'mint';
    const unlockedBoardThemes = new Set(['garden']);
    if (Array.isArray(parsed.unlockedBoardThemes)) {
      parsed.unlockedBoardThemes.forEach((theme) => { if (Object.hasOwn(BOARD_THEMES, theme)) unlockedBoardThemes.add(theme); });
    }
    const boardTheme = Object.hasOwn(BOARD_THEMES, parsed.boardTheme) && unlockedBoardThemes.has(parsed.boardTheme) ? parsed.boardTheme : 'garden';
    return {
      seeds: Number.isFinite(Number(parsed.seeds)) ? Math.max(0, Math.floor(Number(parsed.seeds))) : 0,
      unlocked: [...unlocked],
      equipped,
      boardTheme,
      unlockedBoardThemes: [...unlockedBoardThemes]
    };
  } catch (_error) {
    return { ...BASE_PROFILE, unlocked: [...BASE_PROFILE.unlocked], unlockedBoardThemes: [...BASE_PROFILE.unlockedBoardThemes] };
  }
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return { sound: Boolean(parsed?.sound), vibration: Boolean(parsed?.vibration) };
  } catch (_error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_error) { /* Settings remain usable for this session. */ }
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
let settings = loadSettings();
let room = null;
let selfId = null;
let watching = false;
let lastSoundGameId = null;
let lastSoundAppleCount = 0;
let lastSoundGameStatus = null;
let audioContext = null;
let activeShopTab = 'skins';
let game = null;
let socketConnected = false;
let resumePending = false;
let actionBusy = false;
let pendingDirection = null;
let toastTimeout = null;
let applesSinceToast = 0;
let currentScreen = 'home';
let nameSyncTimeout = null;
let profileSyncTimeout = null;
let lastRecordedGameId = null;
let socketAccessToken;
let lastCloudProfileName = null;
let lastCloudProfileUserId = null;
const socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
  upgrade: true,
  reconnectionDelay: 250,
  reconnectionDelayMax: 1500,
  timeout: 8000
});

const $ = (selector) => document.querySelector(selector);
const homeView = $('#homeView');
const playView = $('#playView');
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

function playSound(kind = 'apple') {
  if (!settings.sound) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    audioContext ||= new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const isFinish = kind === 'finish';
    oscillator.type = isFinish ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(isFinish ? 260 : 620, now);
    if (isFinish) oscillator.frequency.exponentialRampToValueAtTime(150, now + .16);
    volume.gain.setValueAtTime(.0001, now);
    volume.gain.exponentialRampToValueAtTime(.055, now + .012);
    volume.gain.exponentialRampToValueAtTime(.0001, now + (isFinish ? .18 : .09));
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + (isFinish ? .19 : .1));
  } catch (_error) { /* El navegador puede bloquear el audio sin afectar la partida. */ }
}

function triggerVibration(pattern) {
  if (!settings.vibration || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(pattern); } catch (_error) { /* La vibración es opcional. */ }
}

function handleGameFeedback(updatedGame) {
  if (!updatedGame?.gameId) return;
  const appleCount = Math.max(0, Number(updatedGame.totalApples) || 0);
  if (lastSoundGameId !== updatedGame.gameId) {
    lastSoundGameId = updatedGame.gameId;
    lastSoundAppleCount = appleCount;
    lastSoundGameStatus = updatedGame.status;
    return;
  }
  if (appleCount > lastSoundAppleCount) {
    playSound('apple');
    triggerVibration(24);
  }
  if (lastSoundGameStatus !== 'finished' && updatedGame.status === 'finished') {
    playSound('finish');
    triggerVibration([35, 45, 75]);
  }
  lastSoundAppleCount = appleCount;
  lastSoundGameStatus = updatedGame.status;
}

function syncSettingsControls() {
  $('#soundToggle').checked = settings.sound;
  const vibrationSupported = typeof navigator.vibrate === 'function';
  $('#vibrationToggle').checked = settings.vibration && vibrationSupported;
  $('#vibrationToggle').disabled = !vibrationSupported;
  $('#vibrationHelp').textContent = vibrationSupported
    ? 'Un toque breve en dispositivos compatibles.'
    : 'Este navegador no ofrece vibración.';
}

function openSettings() {
  syncSettingsControls();
  $('#settingsModal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#closeSettings').focus();
}

function closeSettings() {
  $('#settingsModal').hidden = true;
  document.body.style.overflow = '';
}

function currentName() {
  const input = $('#playerName');
  const name = input.value.trim().slice(0, 18);
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch (_error) { /* Optional preference. */ }
  if (window.SnakeSocial?.isSignedIn?.()) {
    window.clearTimeout(nameSyncTimeout);
    nameSyncTimeout = window.setTimeout(() => {
      window.SnakeSocial.updateDisplayName(name).catch((error) => showToast(error.message, 3800));
    }, 700);
  }
  return name;
}

function requirePlayerName() {
  const name = currentName();
  if (name) return name;
  const input = $('#playerName');
  input.focus();
  showToast('Escribe tu nombre para que el grupo sepa quién está jugando.');
  return '';
}

function setBusy(value) {
  actionBusy = value;
  renderConnection();
  // La sala puede haberse dibujado mientras la petición seguía ocupada.
  // Al terminar de crearla, vuelve a calcular si se puede empezar en solitario.
  if (room?.phase === 'lobby') renderRoom();
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
  const footnote = $('#shopFootnote');
  if (footnote) footnote.textContent = window.SnakeSocial?.isSignedIn?.()
    ? 'Tus semillas, skins y tableros se sincronizan con tu perfil.'
    : 'Inicia sesión para guardar tus cosméticos y semillas en tu perfil.';
}

function syncCloudCosmetics() {
  if (!window.SnakeSocial?.isSignedIn?.()) return;
  window.clearTimeout(profileSyncTimeout);
  profileSyncTimeout = window.setTimeout(() => {
    window.SnakeSocial.updateProfile({
      current_skin: profile.equipped,
      seeds: profile.seeds,
      unlocked_skins: profile.unlocked,
      board_theme: profile.boardTheme,
      unlocked_board_themes: profile.unlockedBoardThemes
    }).catch((error) => showToast(`No se pudo sincronizar el perfil: ${error.message}`, 3800));
  }, 650);
}

function applyRoomState(data) {
  if (!data || !data.room) return;
  room = data.room;
  watching = data.role === 'spectator';
  selfId = watching ? null : (data.selfId || selfId);
  if (Object.hasOwn(data, 'game')) game = data.game;
  if (data.token) saveSession(data.room.code, data.token);
  else if (watching) clearSession();
  resumePending = false;
  pendingDirection = null;
  renderAll();
  maybeRecordGameResult();
}

function maybeRecordGameResult() {
  if (watching || !room || !game?.result || !game.gameId || lastRecordedGameId === game.gameId) return;
  lastRecordedGameId = game.gameId;
  if (!window.SnakeSocial?.isSignedIn?.()) return;
  if (room.players.some((player) => !player.userId)) {
    showToast('Para guardar el récord del equipo, todas las personas deben iniciar sesión.', 4200);
    return;
  }
  window.SnakeSocial.recordGameResult(game, room).then((saved) => {
    if (saved) showToast(`Récord guardado: ${game.totalApples} manzanas.`, 3000);
  }).catch((error) => showToast(`No se pudo guardar el récord: ${error.message}`, 4200));
}

function renderAll() {
  const inRoom = Boolean(room);
  const inLobby = inRoom && room.phase === 'lobby';
  homeView.hidden = inRoom || currentScreen !== 'home';
  playView.hidden = inRoom || currentScreen !== 'play';
  roomView.hidden = !inLobby;
  gameView.hidden = !inRoom || inLobby;
  document.body.classList.toggle('game-active', inRoom && !inLobby);
  document.body.classList.toggle('is-spectator', watching);
  $('#spectatorNotice').hidden = !watching;
  renderConnection();
  updateWallet();
  renderRoom();
  if (inRoom && !inLobby) renderGame();
  if (shopOpen) renderShop();
}

function renderRoom() {
  if (!room) {
    $('#spectatorCount').textContent = '0';
    return;
  }
  $('#roomCodeDisplay').textContent = room.code;
  $('#gameRoomCode').textContent = room.code;
  $('#spectatorCount').textContent = String(Math.max(0, Number(room.spectatorCount) || 0));
  const sorted = [...room.players].sort((a, b) => a.key.localeCompare(b.key));
  const connectedCount = sorted.filter((player) => player.connected).length;
  $('#playerCountLabel').textContent = `${connectedCount} / 6`;
  const slots = sorted.map((player) => {
    const skin = SKINS[player.skin] || SKINS.mint;
    const isSelf = player.key === selfId;
    const host = room.hostKey === player.key;
    const avatar = player.userId
      ? `<button class="player-avatar ${player.connected ? '' : 'is-offline'}" data-profile-id="${escapeHtml(player.userId)}" aria-label="Ver perfil de ${escapeHtml(player.name)}" style="background:${skin.soft};color:${skin.dark}">${skin.emoji}</button>`
      : `<div class="player-avatar ${player.connected ? '' : 'is-offline'}" style="background:${skin.soft};color:${skin.dark}">${skin.emoji}</div>`;
    return `<div class="player-slot">
      ${avatar}
      <div class="player-slot-info">
        <div class="player-slot-name">${escapeHtml(player.name)}${isSelf ? ' <span>(tú)</span>' : ''}</div>
        <div class="player-slot-sub">${player.connected ? 'Conectado · ' + escapeHtml(skin.name) : 'Reconectando…'}</div>
      </div>
      ${host ? '<span class="host-pill">ANFITRIÓN</span>' : ''}
    </div>`;
  });
  for (let seat = sorted.length; seat < 6; seat += 1) {
    slots.push(`<div class="player-slot empty-slot"><span class="empty-plus">＋</span><div class="player-slot-info"><div class="player-slot-name">Asiento libre</div><div class="player-slot-sub">Invita con el código</div></div></div>`);
  }
  $('#playerSlots').innerHTML = slots.join('');
  const everyoneConnected = sorted.length >= 1 && sorted.every((player) => player.connected);
  const isHost = room.hostKey === selfId;
  const start = $('#startGame');
  start.disabled = !isHost || !everyoneConnected || actionBusy;
  start.innerHTML = isHost && everyoneConnected
    ? (sorted.length === 1 ? 'Empezar solo' : `Empezar juntos · ${sorted.length}`) + ' <span aria-hidden="true">→</span>'
    : isHost ? 'Esperando conexión… <span aria-hidden="true">→</span>' : 'Esperando al anfitrión <span aria-hidden="true">→</span>';
  $('#hostNote').textContent = !isHost
    ? 'El anfitrión puede empezar cuando quiera.'
    : !everyoneConnected
      ? 'Esperad a que todos los jugadores vuelvan a conectarse.'
      : sorted.length === 1
        ? 'Puedes esperar a alguien o empezar solo ahora.'
        : `Jugaréis en equipo con ${sorted.length} serpientes.`;
  $('#roomHint').innerHTML = sorted.length === 1
    ? '<span>✦</span><span>Puedes esperar hasta 6 jugadores o empezar en modo solitario.</span>'
    : sorted.length < 6
      ? `<span>✦</span><span>Hay ${sorted.length} jugadores. Podéis invitar hasta 6 y empezar cuando queráis.</span>`
      : '<span>✦</span><span>¡Grupo completo! El anfitrión puede empezar.</span>';
}

function renderScoreboard() {
  if (!room) return;
  const players = [...room.players].sort((a, b) => a.key.localeCompare(b.key));
  const avatars = players.map((player) => {
    const skin = SKINS[player.skin] || SKINS.mint;
    return player.userId
      ? `<button class="team-avatar" title="Ver perfil de ${escapeHtml(player.name)}" aria-label="Ver perfil de ${escapeHtml(player.name)}" data-profile-id="${escapeHtml(player.userId)}" style="background:${skin.soft};color:${skin.dark}">${skin.emoji}</button>`
      : `<span class="team-avatar" title="${escapeHtml(player.name)}" style="background:${skin.soft};color:${skin.dark}">${skin.emoji}</span>`;
  }).join('');
  const playerNames = players.map((player) => `${player.name}${player.connected ? '' : ' (sin conexión)'}`).join(' · ');
  const sharedPoints = game?.totalApples ?? 0;
  $('#scoreboard').innerHTML = `<div class="team-score-card"><div class="team-score-top"><div class="team-avatars" aria-label="Serpientes del equipo">${avatars}</div><div class="team-score-meta"><small>PUNTOS DEL EQUIPO</small><b>${sharedPoints}<span>🍎</span></b></div></div><div class="team-player-names" title="${escapeHtml(playerNames)}">${escapeHtml(playerNames || 'Equipo')}</div></div>`;
}

function updateProgress() {
  const width = game?.width || 18;
  const height = game?.height || 22;
  const total = width * height;
  const occupied = game?.snakes
    ? Object.values(game.snakes).reduce((sum, snake) => sum + (snake?.body?.length || 0), 0)
    : 6;
  const percent = Math.min(100, Math.round(occupied / total * 100));
  $('#fillPercent').textContent = `${percent}%`;
  $('#occupiedCount').textContent = String(occupied);
  $('#boardCellCount').textContent = `/ ${total} casillas`;
  $('#progressFill').style.width = `${percent}%`;
  $('#mobileFillPercent').textContent = `${percent}%`;
  $('#mobileOccupiedCount').textContent = String(occupied);
  $('#mobileBoardCellCount').textContent = String(total);
  $('#mobileProgressFill').style.width = `${percent}%`;
}

function resultCopy() {
  const result = game?.result;
  if (!result) return null;
  if (result.type === 'board-full') {
    const solo = room?.players.length === 1;
    return { emoji: '🌳', kicker: solo ? 'META COMPLETADA' : 'LO HABÉIS HECHO EN EQUIPO', title: '¡Jardín completo!', body: solo ? `Has ocupado las ${game.width * game.height} casillas. ¡Qué buen trabajo!` : `Habéis ocupado las ${game.width * game.height} casillas. ¡Gran trabajo en equipo!` };
  }
  if (result.type === 'draw') {
    return { emoji: '💫', kicker: 'CHOQUE SIMULTÁNEO', title: '¡Vaya giro!', body: 'Varias serpientes chocaron a la vez. ¿Probáis otra vez en equipo?' };
  }
  if (result.type === 'collision') {
    const solo = room?.players.length === 1;
    return { emoji: '🌱', kicker: 'FIN DE LA RONDA', title: '¡Cuidado con las colas!', body: solo ? 'La serpiente chocó. ¡Puedes volver a intentarlo!' : 'Una serpiente chocó y la ronda termina para todo el equipo. Volved a intentarlo juntos.' };
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
    overlay.innerHTML = `<div class="overlay-card overlay-waiting"><div class="overlay-spinner"></div><span class="section-kicker">RECUPERANDO CONEXIÓN</span><h2>Volvemos enseguida.</h2><p>La partida sigue en marcha; el tablero se actualizará cuando vuelvas.</p></div>`;
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
    const allConnected = room.players.length >= 1 && room.players.every((player) => player.connected);
    const button = watching
      ? '<p class="overlay-footnote">Estás mirando la partida. Los jugadores pueden iniciar una revancha.</p>'
      : allConnected
        ? '<button class="button button-primary" data-action="rematch" type="button">Revancha rápida <span aria-hidden="true">→</span></button>'
        : '<p class="overlay-footnote">Esperad a que vuelvan todos los jugadores para la revancha.</p>';
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
  const WORLD_WIDTH = 720;
  const WORLD_HEIGHT = 880;
  const wrapper = gameCanvas.parentElement;
  wrapper.style.width = '100%';
  wrapper.style.height = 'auto';
  const availableWidth = Math.max(1, wrapper.clientWidth);
  const mobile = window.matchMedia('(max-width: 780px)').matches;
  const tabletLandscape = window.matchMedia('(min-width: 781px) and (max-width: 1360px) and (orientation: landscape)').matches;
  let maxHeight;
  if (mobile) {
    const reserved = $('#gameToolbar').offsetHeight + $('#scoreboard').offsetHeight +
      $('#mobileProgress').offsetHeight + $('#mobileControls').offsetHeight + 98;
    maxHeight = Math.max(170, Math.min(window.innerHeight * 0.72, window.innerHeight - reserved));
  } else if (tabletLandscape) {
    const reserved = $('#gameToolbar').offsetHeight + $('#scoreboard').offsetHeight + 82;
    maxHeight = Math.max(220, Math.min(window.innerHeight * 0.94, window.innerHeight - reserved));
  } else {
    maxHeight = Math.min(window.innerHeight * 0.78, 850);
  }
  const cssWidth = Math.max(1, Math.min(availableWidth, maxHeight * WORLD_WIDTH / WORLD_HEIGHT));
  const cssHeight = cssWidth * WORLD_HEIGHT / WORLD_WIDTH;
  wrapper.style.width = `${cssWidth}px`;
  wrapper.style.height = `${cssHeight}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  gameCanvas.style.width = `${cssWidth}px`;
  gameCanvas.style.height = `${cssHeight}px`;
  gameCanvas.width = Math.round(cssWidth * dpr);
  gameCanvas.height = Math.round(cssHeight * dpr);
  gameContext.setTransform(gameCanvas.width / WORLD_WIDTH, 0, 0, gameCanvas.height / WORLD_HEIGHT, 0, 0);

  const ctx = gameContext;
  const width = game?.width || 18;
  const height = game?.height || 22;
  const cell = WORLD_WIDTH / width;
  ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  const boardTheme = BOARD_THEMES[profile.boardTheme] || BOARD_THEMES.garden;
  ctx.fillStyle = boardTheme.base;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = boardTheme.tile;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  ctx.strokeStyle = boardTheme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < width; x += 1) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, WORLD_HEIGHT); }
  for (let y = 1; y < height; y += 1) { ctx.moveTo(0, y * cell); ctx.lineTo(WORLD_WIDTH, y * cell); }
  ctx.stroke();

  if (game?.apple) drawApple(ctx, game.apple.x, game.apple.y, cell);
  const playerByKey = Object.fromEntries((room?.players || []).map((player) => [player.key, player]));
  Object.keys(game?.snakes || {}).reverse().forEach((key) => {
    const player = playerByKey[key];
    const fallback = ['mint', 'citrus', 'berry', 'ocean'][Number(key.slice(1)) - 1] || 'mint';
    drawSnake(ctx, game?.snakes?.[key], player?.skin || fallback, cell);
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
  $('#themeGrid').innerHTML = Object.entries(BOARD_THEMES).map(([id, theme]) => {
    const unlocked = profile.unlockedBoardThemes.includes(id);
    const equipped = profile.boardTheme === id;
    let label = 'Desbloquear';
    let stateClass = '';
    let disabled = false;
    if (equipped) {
      label = 'En uso ✓';
      stateClass = 'is-equipped';
      disabled = true;
    } else if (unlocked) {
      label = 'Usar tablero';
      stateClass = 'is-buy';
    } else if (profile.seeds >= theme.price) {
      label = `Desbloquear · ${theme.price} ✦`;
      stateClass = 'is-buy';
    } else {
      label = `Faltan ${theme.price - profile.seeds} ✦`;
      stateClass = 'is-locked';
      disabled = true;
    }
    return `<article class="theme-card">
      <div class="theme-preview" style="--theme-preview:${theme.preview};--theme-accent:${theme.accent}"></div>
      <h3>${escapeHtml(theme.name)} ${id === 'garden' ? '🌿' : id === 'ocean' ? '🌊' : id === 'sunset' ? '🌅' : '🌙'}</h3>
      <p>${unlocked ? (theme.price === 0 ? 'Disponible' : 'Desbloqueado') : `${theme.price} semillas`}</p>
      <button class="skin-action button ${stateClass}" type="button" data-theme-id="${id}" ${disabled ? 'disabled' : ''}>${label}</button>
    </article>`;
  }).join('');
  $('#skinGrid').hidden = activeShopTab !== 'skins';
  $('#themeGrid').hidden = activeShopTab !== 'themes';
  document.querySelectorAll('[data-shop-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.shopTab === activeShopTab);
    button.setAttribute('aria-selected', String(button.dataset.shopTab === activeShopTab));
  });
}

function setShopTab(tab) {
  activeShopTab = tab === 'themes' ? 'themes' : 'skins';
  renderShop();
}

function selectBoardTheme(id) {
  const theme = BOARD_THEMES[id];
  if (!theme) return;
  if (!profile.unlockedBoardThemes.includes(id)) {
    if (profile.seeds < theme.price) {
      showToast(`Te faltan ${theme.price - profile.seeds} semillas para desbloquear ${theme.name}.`);
      return;
    }
    profile.seeds -= theme.price;
    profile.unlockedBoardThemes.push(id);
    showToast(`¡Tablero ${theme.name} desbloqueado!`);
  }
  profile.boardTheme = id;
  saveProfile();
  syncCloudCosmetics();
  updateWallet();
  renderShop();
  renderGame();
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
  syncCloudCosmetics();
  updateWallet();
  renderShop();
  if (room && socketConnected) {
    socket.emit('player:skin', { skin: id });
  }
  renderAll();
}

async function createRoom() {
  if (actionBusy || !socketConnected || resumePending) return;
  const name = requirePlayerName();
  if (!name) return;
  if (window.SnakeSocial?.isSignedIn?.()) window.SnakeSocial.updateDisplayName(name).catch((error) => showToast(error.message, 3800));
  setBusy(true);
  try {
    const response = await emitAck('room:create', { name, skin: profile.equipped });
    applyRoomState(response);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function joinRoom(code, asSpectator = false) {
  if (actionBusy || !socketConnected || resumePending) return false;
  const name = requirePlayerName();
  if (!name) return false;
  if (window.SnakeSocial?.isSignedIn?.()) window.SnakeSocial.updateDisplayName(name).catch((error) => showToast(error.message, 3800));
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (normalized.length !== 6) {
    showToast('El código de sala tiene seis caracteres.');
    return false;
  }
  setBusy(true);
  try {
    const response = await emitAck('room:join', { code: normalized, name, skin: profile.equipped, spectator: Boolean(asSpectator) });
    applyRoomState(response);
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
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
  if (watching || actionBusy) return;
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
  watching = false;
  game = null;
  currentScreen = 'home';
  resumePending = false;
  pendingDirection = null;
  setBusy(false);
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleDirection(direction) {
  if (watching || !selfId || !VALID_DIRECTIONS.has(direction) || !socketConnected || !room || room.phase !== 'playing' || !game) return;
  if (pendingDirection) return;
  const snake = game.snakes?.[selfId];
  const current = snake?.direction;
  const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
  if (!current || direction === current || direction === opposites[current]) return;
  pendingDirection = direction;
  socket.emit('game:turn', { direction });
  // Give immediate visual feedback while the authoritative tick travels over the network.
  snake.direction = direction;
  window.requestAnimationFrame(drawBoard);
}

function init() {
  $('#playerName').value = (() => {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (_error) { return ''; }
  })();
  $('#playerName').addEventListener('input', currentName);
  $('#playNow').addEventListener('click', () => {
    currentScreen = 'play';
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#backToMenu').addEventListener('click', () => {
    currentScreen = 'home';
    renderAll();
  });
  $('#shopFromMenu').addEventListener('click', openShop);
  $('#rulesFromMenu').addEventListener('click', () => {
    $('#rulesModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#closeRules').focus();
  });
  const closeRules = () => {
    $('#rulesModal').hidden = true;
    document.body.style.overflow = '';
  };
  $('#closeRules').addEventListener('click', closeRules);
  $('#rulesDone').addEventListener('click', closeRules);
  $('#rulesModal').addEventListener('click', (event) => {
    if (event.target === $('#rulesModal')) closeRules();
  });
  $('#createRoom').addEventListener('click', createRoom);
  $('#joinForm').addEventListener('submit', (event) => {
    event.preventDefault();
    joinRoom($('#roomCodeInput').value, $('#spectatorMode').checked);
  });
  $('#roomCodeInput').addEventListener('input', (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  $('#startGame').addEventListener('click', startGame);
  $('#roomBack').addEventListener('click', leaveRoom);
  $('#gameLeave').addEventListener('click', leaveRoom);
  const fullscreenToggle = $('#fullscreenToggle');
  const isAppFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const updateFullscreenButton = () => {
    const active = isAppFullscreen();
    fullscreenToggle.setAttribute('aria-label', active ? 'Salir de pantalla completa' : 'Activar pantalla completa');
    fullscreenToggle.title = active ? 'Salir de pantalla completa' : 'Pantalla completa';
    const label = fullscreenToggle.querySelector('.fullscreen-label');
    if (label) label.textContent = active ? 'Salir' : 'Pantalla completa';
    window.requestAnimationFrame(drawBoard);
  };
  fullscreenToggle.addEventListener('click', async () => {
    try {
      if (isAppFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch (_optionsError) {
          await document.documentElement.requestFullscreen();
        }
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      } else {
        showToast('Este navegador no ofrece pantalla completa.');
      }
    } catch (_error) {
      showToast('No se pudo activar pantalla completa. Prueba el menú ⋮ del navegador.');
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  $('#brandHome').addEventListener('click', (event) => {
    event.preventDefault();
    if (room) showToast('Sal de la sala para volver al menú.');
    else {
      currentScreen = 'home';
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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
  $('#openSettings').addEventListener('click', openSettings);
  $('#openSettingsGame').addEventListener('click', openSettings);
  $('#closeSettings').addEventListener('click', closeSettings);
  $('#settingsModal').addEventListener('click', (event) => { if (event.target === $('#settingsModal')) closeSettings(); });
  $('#soundToggle').addEventListener('change', () => {
    settings.sound = $('#soundToggle').checked;
    saveSettings();
    if (settings.sound) playSound('apple');
  });
  $('#vibrationToggle').addEventListener('change', () => {
    settings.vibration = $('#vibrationToggle').checked && typeof navigator.vibrate === 'function';
    saveSettings();
    if (settings.vibration) triggerVibration(18);
  });
  $('#shopModal').addEventListener('click', (event) => {
    if (event.target === $('#shopModal')) closeShop();
  });
  $('#skinGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-skin-id]');
    if (button && !button.disabled) equipSkin(button.dataset.skinId);
  });
  $('#themeGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-id]');
    if (button && !button.disabled) selectBoardTheme(button.dataset.themeId);
  });
  document.querySelectorAll('[data-shop-tab]').forEach((button) => button.addEventListener('click', () => setShopTab(button.dataset.shopTab)));
  $('#gameOverlay').addEventListener('click', (event) => {
    if (event.target.closest('[data-action="rematch"]')) rematch();
  });
  document.querySelectorAll('[data-direction]').forEach((button) => {
    const inputEvent = window.PointerEvent ? 'pointerdown' : 'click';
    button.addEventListener(inputEvent, (event) => {
      event.preventDefault();
      handleDirection(button.dataset.direction);
    }, { passive: false });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shopOpen) closeShop();
    if (event.key === 'Escape' && !$('#settingsModal').hidden) closeSettings();
    if (event.key === 'Escape' && !$('#rulesModal').hidden) {
      $('#rulesModal').hidden = true;
      document.body.style.overflow = '';
    }
    if (!room || room.phase !== 'playing' || shopOpen || !$('#settingsModal').hidden || !$('#rulesModal').hidden) return;
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
  document.addEventListener('touchmove', (event) => {
    if (document.body.classList.contains('game-active')) event.preventDefault();
  }, { passive: false });

  socket.on('connect', async () => {
    socketConnected = true;
    renderConnection();
    if (watching && room?.code) {
      const watchedCode = room.code;
      resumePending = true;
      renderAll();
      try {
        const response = await emitAck('room:join', { code: watchedCode, name: currentName() || 'Espectador', skin: profile.equipped, spectator: true });
        applyRoomState(response);
      } catch (error) {
        clearSession();
        room = null;
        selfId = null;
        watching = false;
        game = null;
        resumePending = false;
        renderAll();
        showToast(error.message, 3600);
      }
      return;
    }
    const saved = loadSession();
    if (saved) {
      resumePending = true;
      renderAll();
      try {
        const response = await emitAck('room:resume', saved);
        applyRoomState(response);
        socket.emit('player:skin', { skin: profile.equipped });
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
  socket.on('presence:update', (presence) => {
    window.dispatchEvent(new CustomEvent('snakezen:presence', { detail: presence }));
  });
  socket.on('room:state', (payload) => applyRoomState(payload));
  socket.on('room:update', (updatedRoom) => {
    if (!room || updatedRoom.code !== room.code) return;
    const enteringGame = room.phase === 'lobby' && updatedRoom.phase !== 'lobby';
    room = updatedRoom;
    renderAll();
    if (enteringGame) window.scrollTo({ top: 0, behavior: 'auto' });
  });
  socket.on('game:state', (updatedGame) => {
    handleGameFeedback(updatedGame);
    game = updatedGame;
    pendingDirection = null;
    renderGame();
    maybeRecordGameResult();
  });
  socket.on('game:reward', (reward) => {
    const amount = Math.max(0, Math.floor(Number(reward?.amount) || 0));
    if (!amount) return;
    profile.seeds += amount;
    saveProfile();
    syncCloudCosmetics();
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

  window.SnakeZenApp = {
    getRoom: () => room,
    getLocalProfile: () => ({ seeds: profile.seeds, unlocked: [...profile.unlocked], equipped: profile.equipped, boardTheme: profile.boardTheme, unlockedBoardThemes: [...profile.unlockedBoardThemes] }),
    isInRoom: () => Boolean(room),
    joinRoom,
    leaveRoom,
    getFriendPresence: (userIds) => emitAck('presence:check', { userIds }, 5000),
    showToast
  };
  window.SnakeSocial.init({
    actions: window.SnakeZenApp,
    localProfile: { seeds: profile.seeds, unlocked: [...profile.unlocked], equipped: profile.equipped, boardTheme: profile.boardTheme, unlockedBoardThemes: [...profile.unlockedBoardThemes] },
    onAuthChanged: ({ session: authSession, profile: remoteProfile }) => {
      const accessToken = authSession?.access_token || '';
      if (remoteProfile) {
        const skinChanged = profile.equipped !== remoteProfile.current_skin;
        const unlocked = new Set(['mint', 'citrus']);
        if (Array.isArray(remoteProfile.unlocked_skins)) {
          remoteProfile.unlocked_skins.forEach((id) => { if (Object.hasOwn(SKINS, id)) unlocked.add(id); });
        }
        const unlockedThemes = new Set(['garden']);
        if (Array.isArray(remoteProfile.unlocked_board_themes)) {
          remoteProfile.unlocked_board_themes.forEach((id) => { if (Object.hasOwn(BOARD_THEMES, id)) unlockedThemes.add(id); });
        }
        const remoteTheme = remoteProfile.board_theme;
        profile = {
          seeds: Math.max(0, Math.floor(Number(remoteProfile.seeds) || 0)),
          unlocked: [...unlocked],
          equipped: Object.hasOwn(SKINS, remoteProfile.current_skin) && unlocked.has(remoteProfile.current_skin) ? remoteProfile.current_skin : 'mint',
          boardTheme: Object.hasOwn(BOARD_THEMES, remoteTheme) && unlockedThemes.has(remoteTheme) ? remoteTheme : 'garden',
          unlockedBoardThemes: [...unlockedThemes]
        };
        saveProfile();
        if (remoteProfile.display_name && (remoteProfile.display_name !== lastCloudProfileName || remoteProfile.id !== lastCloudProfileUserId)) {
          lastCloudProfileName = remoteProfile.display_name;
          lastCloudProfileUserId = remoteProfile.id;
          try { localStorage.setItem(NAME_KEY, remoteProfile.display_name); } catch (_error) { /* optional */ }
          if (document.activeElement !== $('#playerName')) $('#playerName').value = remoteProfile.display_name;
        }
        if (skinChanged && room && socketConnected) socket.emit('player:skin', { skin: profile.equipped });
      }
      updateWallet();
      if (shopOpen) renderShop();
      if (room) renderAll();
      if (socketAccessToken !== accessToken) {
        socketAccessToken = accessToken;
        socket.auth = accessToken ? { accessToken } : {};
        if (socket.connected) {
          socket.disconnect();
          socket.connect();
        } else if (!socket.active) {
          socket.connect();
        }
      }
    }
  });
}

init();
