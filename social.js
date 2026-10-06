'use strict';

(() => {
  const AUTH_KEY = 'snakezen.auth.v1';
  const SKINS = {
    mint: { name: 'Menta', emoji: '🌿' }, citrus: { name: 'Cítrico', emoji: '🍊' },
    berry: { name: 'Frambuesa', emoji: '🍓' }, ocean: { name: 'Laguna', emoji: '🌊' },
    grape: { name: 'Uva', emoji: '🍇' }, gold: { name: 'Dorada', emoji: '✨' },
    lava: { name: 'Lava', emoji: '🌋' }, bamboo: { name: 'Bambú', emoji: '🎋' },
    midnight: { name: 'Medianoche', emoji: '🌙' }, coral: { name: 'Coral', emoji: '🪸' },
    cloud: { name: 'Nube', emoji: '☁️' }, neon: { name: 'Neón', emoji: '💠' }
  };
  let config = { supabaseConfigured: false, supabaseUrl: '', supabaseAnonKey: '' };
  let session = null;
  let user = null;
  let cloudProfile = null;
  let profileError = '';
  let appActions = {};
  let authChanged = () => {};
  let accountMode = 'login';
  let socialTab = 'leaderboard';
  let notificationRows = [];
  let notificationTimer = null;
  let expiryTimer = null;
  let lastNotificationIds = null;
  let friendSearchTerm = '';
  let profileModalUserId = null;
  let loadingSocial = false;

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const skinInfo = (key) => SKINS[key] || SKINS.mint;
  const emojiFor = (key) => skinInfo(key).emoji;
  const toast = (message, duration) => window.SnakeZenApp?.showToast?.(message, duration);
  const currentUid = () => user?.id || '';
  const hasSession = () => Boolean(session?.access_token && user?.id);

  function localSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      return saved && typeof saved.access_token === 'string' && typeof saved.refresh_token === 'string' ? saved : null;
    } catch (_error) { return null; }
  }

  function sessionFromAuthRedirect() {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (!access || !refresh) return null;
    const expiresAt = Number(params.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(params.get('expires_in')) || 3600);
    const redirectedSession = { access_token: access, refresh_token: refresh, expires_at: expiresAt, token_type: params.get('token_type') || 'bearer' };
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(redirectedSession)); } catch (_error) { /* optional */ }
    return redirectedSession;
  }

  function saveSession() {
    try {
      if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      else localStorage.removeItem(AUTH_KEY);
    } catch (_error) { /* El juego sigue disponible aunque el navegador bloquee el almacenamiento. */ }
  }

  function normalizedSession(data) {
    if (!data?.access_token || !data?.refresh_token) throw new Error('Supabase no devolvió una sesión válida.');
    const expiresIn = Math.max(60, Number(data.expires_in) || 3600);
    const expiresAt = Number(data.expires_at) || Math.floor(Date.now() / 1000) + expiresIn;
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt, token_type: data.token_type || 'bearer' };
  }

  function friendlyError(message, status = 0) {
    const text = String(message || 'Error desconocido');
    if (/relation .* does not exist|could not find the table|schema cache|PGRST20[45]/i.test(text)) {
      return 'Falta instalar las tablas de Supabase. Ejecuta el archivo supabase/setup.sql.';
    }
    if (/invalid login credentials|invalid email or password/i.test(text)) return 'El correo o la contraseña no son correctos.';
    if (/email not confirmed/i.test(text)) return 'Confirma el correo desde el mensaje que te envió Supabase y vuelve a entrar.';
    if (/user already registered/i.test(text)) return 'Ese correo ya tiene una cuenta. Prueba a iniciar sesión.';
    if (/password should be at least|weak password/i.test(text)) return 'La contraseña debe tener al menos 6 caracteres.';
    if (/duplicate key|unique constraint/i.test(text)) return 'Ya existe una solicitud o amistad entre estas cuentas.';
    if (/permission denied|row-level security|violates row-level/i.test(text)) return 'Supabase ha bloqueado la operación. Comprueba que setup.sql se ejecutó completo.';
    if (status === 429) return 'Hay demasiados intentos. Espera un momento y vuelve a probar.';
    if (status === 0) return 'No se pudo conectar con Supabase. Comprueba la conexión.';
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (_error) { return text; }
  }

  async function authRequest(path, body, bearer = '') {
    const headers = { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let response;
    try {
      response = await fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
        method: 'POST', headers, body: JSON.stringify(body || {})
      });
    } catch (error) {
      throw new Error(friendlyError(error.message, 0));
    }
    const data = await readJson(response);
    if (!response.ok) throw new Error(friendlyError(data?.msg || data?.message || data?.error_description || data?.error || response.statusText, response.status));
    return data;
  }

  async function apiRequest(resource, options = {}, allowRefresh = true) {
    if (!config.supabaseConfigured) throw new Error('Las cuentas todavía no están conectadas. Configura Supabase para activar esta función.');
    const headers = { apikey: config.supabaseAnonKey, Authorization: `Bearer ${session?.access_token || config.supabaseAnonKey}` };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.headers) Object.assign(headers, options.headers);
    let response;
    try {
      response = await fetch(`${config.supabaseUrl}/rest/v1/${resource}`, {
        method: options.method || 'GET', headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      throw new Error(friendlyError(error.message, 0));
    }
    const data = await readJson(response);
    if (!response.ok) {
      if (response.status === 401 && allowRefresh && session?.refresh_token) {
        try {
          await refreshAuthSession();
          return apiRequest(resource, options, false);
        } catch (_error) {
          session = null;
          user = null;
          cloudProfile = null;
          saveSession();
          notifyAuthChanged();
          throw new Error('La sesión caducó. Inicia sesión otra vez.');
        }
      }
      throw new Error(friendlyError(data?.message || data?.details || data?.hint || data?.error || response.statusText, response.status));
    }
    return data;
  }

  async function fetchOwnProfile() {
    if (!hasSession()) return null;
    const query = new URLSearchParams({ select: 'id,display_name,current_skin,seeds,unlocked_skins,total_apples,games_played,games_won,best_solo,created_at', id: `eq.${user.id}`, limit: '1' });
    const rows = await apiRequest(`profiles?${query}`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function ensureProfile(fallback = {}) {
    if (!hasSession()) return null;
    profileError = '';
    try {
      let existing = await fetchOwnProfile();
      if (existing) {
        cloudProfile = existing;
        return cloudProfile;
      }
      const name = String(fallback.display_name || fallback.name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Jugador').trim().slice(0, 18) || 'Jugador';
      const local = fallback.localProfile || {};
      const payload = {
        id: user.id,
        display_name: name,
        current_skin: Object.hasOwn(SKINS, local.equipped) ? local.equipped : 'mint',
        seeds: Math.max(0, Math.floor(Number(local.seeds) || 0)),
        unlocked_skins: Array.isArray(local.unlocked) ? [...new Set(['mint', 'citrus', ...local.unlocked.filter((skin) => Object.hasOwn(SKINS, skin))])] : ['mint', 'citrus']
      };
      const inserted = await apiRequest('profiles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: payload });
      cloudProfile = Array.isArray(inserted) ? inserted[0] || payload : payload;
      return cloudProfile;
    } catch (error) {
      profileError = error.message;
      cloudProfile = null;
      throw error;
    }
  }

  async function refreshAuthSession() {
    if (!session?.refresh_token || !config.supabaseConfigured) throw new Error('La sesión ha caducado. Inicia sesión otra vez.');
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    session = normalizedSession(data);
    user = data.user || user;
    saveSession();
    notifyAuthChanged();
    scheduleExpiryRefresh();
    return session;
  }

  function notifyAuthChanged() {
    renderAccount();
    try { authChanged({ session, user, profile: cloudProfile, profileError, configured: config.supabaseConfigured }); }
    catch (error) { console.error('No se pudo actualizar la cuenta en el juego:', error); }
  }

  function scheduleExpiryRefresh() {
    window.clearTimeout(expiryTimer);
    if (!session?.expires_at) return;
    const ms = Math.max(20_000, Number(session.expires_at) * 1000 - Date.now() - 90_000);
    expiryTimer = window.setTimeout(() => {
      refreshAuthSession().catch((error) => {
        setAuthStatus(error.message, true);
        session = null;
        user = null;
        cloudProfile = null;
        saveSession();
        notifyAuthChanged();
      });
    }, Math.min(ms, 2_147_000_000));
  }

  function setAuthStatus(message = '', isError = false) {
    const status = $('#authStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(isError));
  }

  function renderAccount() {
    const signedIn = hasSession();
    const name = cloudProfile?.display_name || user?.email?.split('@')[0] || 'Perfil';
    const skin = skinInfo(cloudProfile?.current_skin);
    const label = $('#accountLabel');
    const avatar = $('#accountAvatar');
    if (label) label.textContent = signedIn ? name : 'Entrar';
    if (avatar) avatar.textContent = signedIn ? skin.emoji : '☺';
    const configNotice = $('#accountConfigNotice');
    const authPane = $('#authPane');
    const signedPane = $('#signedInPane');
    const form = $('#authForm');
    if (configNotice) {
      configNotice.hidden = config.supabaseConfigured;
      configNotice.innerHTML = 'Para activar cuentas necesitas crear un proyecto gratuito en Supabase, ejecutar <b>supabase/setup.sql</b> y configurar <b>SUPABASE_URL</b> y <b>SUPABASE_ANON_KEY</b> en el servidor. No se necesita una clave secreta.';
    }
    if (authPane) authPane.hidden = signedIn;
    if (signedPane) signedPane.hidden = !signedIn;
    if (form) form.querySelectorAll('input,button').forEach((element) => { element.disabled = !config.supabaseConfigured; });
    const nameLabel = $('#authNameLabel');
    if (nameLabel) nameLabel.hidden = accountMode !== 'signup';
    const submit = $('#authSubmit');
    if (submit) submit.textContent = accountMode === 'signup' ? 'Crear cuenta' : 'Entrar';
    const toggle = $('#authModeToggle');
    if (toggle) toggle.textContent = accountMode === 'signup' ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Crear cuenta';
    if ($('#signedInName')) $('#signedInName').textContent = cloudProfile?.display_name || 'Jugador';
    if ($('#signedInEmail')) $('#signedInEmail').textContent = user?.email || '';
    if ($('#signedInAvatar')) $('#signedInAvatar').textContent = skin.emoji;
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.hidden = true;
    if ([...document.querySelectorAll('.modal-backdrop')].every((item) => item.hidden)) document.body.style.overflow = '';
  }

  function openAccount() {
    setAuthStatus('');
    renderAccount();
    openModal('accountModal');
    if (!hasSession()) $('#authEmail')?.focus();
    else $('#closeAccount')?.focus();
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (appActions.isInRoom?.()) {
      setAuthStatus('Sal de la sala antes de cambiar de cuenta.');
      return;
    }
    if (!config.supabaseConfigured) {
      setAuthStatus('Las cuentas se activan al configurar el proyecto Supabase del servidor.', true);
      return;
    }
    const email = String($('#authEmail').value || '').trim().toLowerCase();
    const password = String($('#authPassword').value || '');
    const displayName = String($('#authName').value || '').trim().slice(0, 18);
    const submit = $('#authSubmit');
    submit.disabled = true;
    setAuthStatus(accountMode === 'signup' ? 'Creando la cuenta…' : 'Entrando…');
    try {
      if (accountMode === 'signup') {
        const data = await authRequest('signup', { email, password, data: { display_name: displayName || 'Jugador' } });
        if (!data.access_token) {
          setAuthStatus('Cuenta creada. Revisa tu correo y confirma la dirección. Al volver a Snake Zen, la sesión debería abrirse automáticamente; si no, inicia sesión.');
          accountMode = 'login';
          renderAccount();
          return;
        }
        session = normalizedSession(data);
        user = data.user || null;
        saveSession();
        try {
          await ensureProfile({ display_name: displayName, localProfile: appActions.getLocalProfile?.() || {} });
          await syncOtherProfileFields(displayName);
        } catch (error) { profileError = error.message; }
      } else {
        const data = await authRequest('token?grant_type=password', { email, password });
        session = normalizedSession(data);
        user = data.user || null;
        saveSession();
        try { await ensureProfile({ localProfile: appActions.getLocalProfile?.() || {} }); }
        catch (error) { profileError = error.message; }
      }
      scheduleExpiryRefresh();
      notifyAuthChanged();
      closeModal('accountModal');
      toast(cloudProfile ? `¡Hola, ${cloudProfile.display_name}! Tu perfil está activo.` : 'Has iniciado sesión; revisa la configuración de las tablas si falta tu perfil.');
      $('#authPassword').value = '';
      refreshNotifications(true).catch(() => {});
    } catch (error) {
      setAuthStatus(error.message, true);
    } finally {
      submit.disabled = !config.supabaseConfigured;
    }
  }

  async function syncOtherProfileFields(displayName = '') {
    if (!cloudProfile || !hasSession()) return;
    const local = appActions.getLocalProfile?.() || {};
    const patch = {
      current_skin: Object.hasOwn(SKINS, local.equipped) ? local.equipped : cloudProfile.current_skin,
      seeds: Math.max(0, Math.floor(Number(local.seeds) || 0)),
      unlocked_skins: Array.isArray(local.unlocked) ? [...new Set(['mint', 'citrus', ...local.unlocked.filter((skin) => Object.hasOwn(SKINS, skin))])] : cloudProfile.unlocked_skins
    };
    if (displayName) patch.display_name = displayName.slice(0, 18);
    await updateProfile(patch);
  }

  async function signOut() {
    if (appActions.isInRoom?.()) {
      toast('Sal de la sala antes de cerrar sesión.');
      return;
    }
    try {
      if (session?.access_token && config.supabaseConfigured) await authRequest('logout', {}, session.access_token);
    } catch (_error) { /* La sesión local se borra igualmente. */ }
    session = null;
    user = null;
    cloudProfile = null;
    profileError = '';
    notificationRows = [];
    lastNotificationIds = null;
    saveSession();
    window.clearTimeout(expiryTimer);
    window.clearInterval(notificationTimer);
    notifyAuthChanged();
    closeModal('accountModal');
    updateNotificationBadge(0);
    toast('Has cerrado sesión.');
  }

  async function updateProfile(patch = {}) {
    if (!hasSession() || !cloudProfile) return false;
    const allowed = {};
    if (typeof patch.display_name === 'string') allowed.display_name = patch.display_name.trim().slice(0, 18) || 'Jugador';
    if (Object.hasOwn(patch, 'current_skin') && Object.hasOwn(SKINS, patch.current_skin)) allowed.current_skin = patch.current_skin;
    if (Object.hasOwn(patch, 'seeds')) allowed.seeds = Math.max(0, Math.floor(Number(patch.seeds) || 0));
    if (Array.isArray(patch.unlocked_skins)) allowed.unlocked_skins = [...new Set(['mint', 'citrus', ...patch.unlocked_skins.filter((skin) => Object.hasOwn(SKINS, skin))])];
    if (!Object.keys(allowed).length) return true;
    const query = new URLSearchParams({ id: `eq.${user.id}` });
    await apiRequest(`profiles?${query}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: allowed });
    cloudProfile = { ...cloudProfile, ...allowed };
    notifyAuthChanged();
    return true;
  }

  async function updateDisplayName(name) {
    if (!hasSession() || !cloudProfile) return false;
    return updateProfile({ display_name: name });
  }

  async function recordGameResult(game, room) {
    if (!hasSession() || !game?.gameId || !game?.result || !room?.players?.length) return false;
    const memberIds = [...new Set(room.players.map((player) => player.userId).filter((id) => typeof id === 'string'))].sort();
    if (memberIds.length !== room.players.length || !memberIds.includes(user.id)) return false;
    const mode = memberIds.length === 1 ? 'solo' : 'team';
    await apiRequest('rpc/record_game_result', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: {
        p_game_id: game.gameId,
        p_mode: mode,
        p_member_ids: memberIds,
        p_score: Math.max(0, Math.floor(Number(game.totalApples) || 0)),
        p_result_type: game.result.type
      }
    });
    try {
      const refreshed = await fetchOwnProfile();
      if (refreshed) cloudProfile = refreshed;
      notifyAuthChanged();
    } catch (_error) { /* El récord se guardó aunque falle la actualización visual. */ }
    return true;
  }

  async function getProfilesByIds(ids) {
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
    if (!unique.length) return [];
    const params = new URLSearchParams({
      select: 'id,display_name,current_skin,seeds,total_apples,games_played,games_won,best_solo',
      id: `in.(${unique.join(',')})`
    });
    const rows = await apiRequest(`profiles?${params}`);
    return Array.isArray(rows) ? rows : [];
  }

  function openSocial(tab = 'leaderboard') {
    socialTab = tab;
    openModal('socialModal');
    renderSocialTabs();
    renderSocialContent();
    if (hasSession()) refreshNotifications(true).catch(() => {});
  }

  function renderSocialTabs() {
    document.querySelectorAll('[data-social-tab]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.socialTab === socialTab);
    });
    const configByTab = {
      leaderboard: ['Clasificación', 'Récords por equipo y modo solitario.'],
      friends: ['Amigos', 'Busca perfiles, acepta solicitudes e invita a una partida.'],
      inbox: ['Notificaciones', 'Solicitudes e invitaciones que te han enviado.']
    };
    const [title, subtitle] = configByTab[socialTab] || configByTab.leaderboard;
    $('#socialTitle').textContent = title;
    $('#socialSubtitle').textContent = subtitle;
  }

  function loginRequiredHtml(text = 'Inicia sesión para usar perfiles, amistades y récords compartidos.') {
    const message = config.supabaseConfigured
      ? text
      : 'La pantalla está lista, pero las cuentas aún no están conectadas. Configura las variables de Supabase en el servidor para activarla.';
    return `<div class="social-state"><span style="font-size:26px">🔐</span><strong>Hace falta una cuenta</strong><p>${escapeHtml(message)}</p><button class="button button-primary" type="button" data-social-login>Entrar o crear cuenta</button></div>`;
  }

  function databaseErrorHtml(error) {
    return `<div class="social-state"><span style="font-size:25px">🌱</span><strong>No se han podido cargar los datos</strong><p>${escapeHtml(error.message || 'Inténtalo de nuevo.')}</p><button class="button button-secondary" type="button" data-social-retry>Reintentar</button></div>`;
  }

  async function renderSocialContent() {
    const node = $('#socialContent');
    if (!node) return;
    if (loadingSocial) return;
    loadingSocial = true;
    node.innerHTML = '<div class="social-state"><span>✳</span><strong>Cargando…</strong></div>';
    try {
      if (!hasSession()) {
        node.innerHTML = loginRequiredHtml();
        return;
      }
      if (socialTab === 'leaderboard') await renderLeaderboard(node);
      else if (socialTab === 'friends') await renderFriends(node);
      else await renderInbox(node);
    } catch (error) {
      node.innerHTML = databaseErrorHtml(error);
    } finally {
      loadingSocial = false;
    }
  }

  async function renderLeaderboard(node) {
    const params = new URLSearchParams({ select: 'team_key,mode,member_ids,score,updated_at', order: 'score.desc,updated_at.asc', limit: '30' });
    const records = await apiRequest(`team_records?${params}`);
    const rows = Array.isArray(records) ? records.slice() : [];
    rows.sort((a, b) => Number(b.score) - Number(a.score) || new Date(a.updated_at) - new Date(b.updated_at));
    if (!rows.length) {
      node.innerHTML = `<div class="social-toolbar"><p>Cada equipo conserva su récord propio. Al cambiar la skin, aquí aparece la actual.</p></div><div class="social-state"><span style="font-size:26px">🏆</span><strong>Aún no hay récords</strong><p>Inicia sesión y termina una partida para estrenar la clasificación.</p></div>`;
      return;
    }
    const profiles = await getProfilesByIds(rows.flatMap((row) => row.member_ids || []));
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const html = rows.map((row, index) => {
      const members = (row.member_ids || []).map((id) => byId.get(id) || { id, display_name: 'Jugador', current_skin: 'mint' });
      const icons = members.map((member) => `<button class="social-user-icon" type="button" data-profile-id="${escapeHtml(member.id)}" aria-label="Ver el perfil de ${escapeHtml(member.display_name)}" title="${escapeHtml(member.display_name)}" style="background:${skinColor(member.current_skin)}">${emojiFor(member.current_skin)}</button>`).join('');
      const names = members.map((member) => `<button class="team-member-button" type="button" data-profile-id="${escapeHtml(member.id)}">${escapeHtml(member.display_name)}</button>`).join('<span aria-hidden="true">·</span>');
      const mode = row.mode === 'solo' ? 'Modo solitario' : `Equipo · ${members.length} jugadores`;
      const date = formatDate(row.updated_at);
      return `<article class="leaderboard-row"><div class="leaderboard-place">${String(index + 1).padStart(2, '0')}</div><div class="team-avatars">${icons}</div><div class="leaderboard-team"><div class="leaderboard-team-name">${names}</div><div class="leaderboard-team-sub">${mode} · récord actualizado ${date}</div></div><div class="leaderboard-score">${Number(row.score) || 0}<small>🍎 puntos</small></div></article>`;
    }).join('');
    node.innerHTML = `<div class="social-toolbar"><p>Cada combinación de cuentas tiene su propio récord.<br>Los iconos abren el perfil y muestran la skin actual.</p><button class="mini-button" type="button" data-social-retry>Actualizar</button></div><div class="social-list">${html}</div>`;
  }

  function skinColor(key) {
    const colors = {
      mint: '#e3f5c9', citrus: '#fff0d6', berry: '#fae1eb', ocean: '#d9f1f2', grape: '#ece5fa', gold: '#f8f0cf',
      lava: '#ffe0d7', bamboo: '#e1f0dc', midnight: '#e2e6fb', coral: '#ffe5df', cloud: '#e9f0fa', neon: '#d9f5ed'
    };
    return colors[key] || colors.mint;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'hoy';
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function profileQueryById(id, select = 'id,display_name,current_skin,seeds,total_apples,games_played,games_won,best_solo,created_at') {
    return new URLSearchParams({ select, id: `eq.${id}`, limit: '1' });
  }

  async function getRelationships() {
    const params = new URLSearchParams({
      select: 'id,user_id,friend_id,status,created_at',
      or: `(user_id.eq.${currentUid()},friend_id.eq.${currentUid()})`,
      order: 'created_at.desc'
    });
    const rows = await apiRequest(`friendships?${params}`);
    return Array.isArray(rows) ? rows : [];
  }

  function relationshipFor(targetId, relationships) {
    return relationships.find((row) => (row.user_id === targetId && row.friend_id === currentUid()) || (row.friend_id === targetId && row.user_id === currentUid())) || null;
  }

  async function renderFriends(node) {
    const relationships = await getRelationships();
    const relevantIds = [...new Set(relationships.map((row) => row.user_id === currentUid() ? row.friend_id : row.user_id))];
    const friendProfiles = await getProfilesByIds(relevantIds);
    const byId = new Map(friendProfiles.map((profile) => [profile.id, profile]));
    let foundProfiles = [];
    if (friendSearchTerm.length >= 2) {
      const params = new URLSearchParams({
        select: 'id,display_name,current_skin,games_played,total_apples,games_won',
        display_name: `ilike.*${friendSearchTerm}*`,
        id: `neq.${currentUid()}`,
        limit: '10'
      });
      foundProfiles = await apiRequest(`profiles?${params}`);
      if (!Array.isArray(foundProfiles)) foundProfiles = [];
    }
    const accepted = relationships.filter((row) => row.status === 'accepted');
    const incoming = relationships.filter((row) => row.status === 'pending' && row.friend_id === currentUid());
    const outgoing = relationships.filter((row) => row.status === 'pending' && row.user_id === currentUid());
    const searchCards = foundProfiles.map((person) => {
      const relationship = relationshipFor(person.id, relationships);
      let action = `<button class="mini-button" data-social-action="add-friend" data-user-id="${escapeHtml(person.id)}">Añadir</button>`;
      if (relationship?.status === 'accepted') action = '<span class="inbox-kind">♡ AMIGOS</span>';
      else if (relationship?.status === 'pending' && relationship.user_id === currentUid()) action = '<span class="inbox-kind">SOLICITUD ENVIADA</span>';
      else if (relationship?.status === 'pending') action = `<button class="mini-button" data-social-action="accept-friend" data-friendship-id="${escapeHtml(relationship.id)}" data-sender-id="${escapeHtml(person.id)}">Aceptar</button>`;
      return personCard(person, `<div class="social-card-actions">${action}</div>`);
    }).join('');
    const friendCards = accepted.map((row) => {
      const friendId = row.user_id === currentUid() ? row.friend_id : row.user_id;
      const person = byId.get(friendId) || { id: friendId, display_name: 'Jugador', current_skin: 'mint' };
      return personCard(person, `<div class="social-card-actions"><button class="mini-button" data-social-action="view-profile" data-user-id="${escapeHtml(friendId)}">Perfil</button><button class="mini-button" data-social-action="invite-game" data-user-id="${escapeHtml(friendId)}" ${canInvite() ? '' : 'disabled'}>Invitar</button></div>`);
    }).join('');
    const incomingCards = incoming.map((row) => {
      const person = byId.get(row.user_id) || { id: row.user_id, display_name: 'Jugador', current_skin: 'mint' };
      return personCard(person, `<div class="social-card-actions"><button class="mini-button" data-social-action="accept-friend" data-friendship-id="${escapeHtml(row.id)}" data-sender-id="${escapeHtml(row.user_id)}">Aceptar</button><button class="mini-button is-danger" data-social-action="reject-friend" data-friendship-id="${escapeHtml(row.id)}">Ignorar</button></div>`, 'Te ha enviado una solicitud de amistad');
    }).join('');
    const outgoingCards = outgoing.map((row) => {
      const person = byId.get(row.friend_id) || { id: row.friend_id, display_name: 'Jugador', current_skin: 'mint' };
      return personCard(person, '<span class="inbox-kind">PENDIENTE</span>', 'Solicitud enviada');
    }).join('');
    const searchMessage = friendSearchTerm.length < 2
      ? 'Escribe al menos dos letras para buscar perfiles por nombre.'
      : foundProfiles.length ? '' : 'No encontramos perfiles con ese nombre.';
    node.innerHTML = `<form class="friend-search" id="friendSearchForm"><label class="sr-only" for="friendSearchInput">Buscar jugadores</label><input id="friendSearchInput" maxlength="30" value="${escapeHtml(friendSearchTerm)}" placeholder="Buscar por nombre…"><button class="button button-secondary" type="submit">Buscar</button></form>
      ${searchMessage ? `<div class="social-state friend-search-empty"><p>${escapeHtml(searchMessage)}</p></div>` : `<div class="social-list friend-search-results">${searchCards}</div>`}
      ${incomingCards ? `<h3 class="profile-section-title">SOLICITUDES RECIBIDAS</h3><div class="social-list">${incomingCards}</div>` : ''}
      ${accepted.length ? `<h3 class="profile-section-title">TUS AMIGOS · ${accepted.length}</h3><div class="social-list">${friendCards}</div>` : `<h3 class="profile-section-title">TUS AMIGOS</h3><div class="social-state"><p>Aún no tienes amigos añadidos. Busca un perfil por nombre.</p></div>`}
      ${outgoingCards ? `<h3 class="profile-section-title">SOLICITUDES ENVIADAS</h3><div class="social-list">${outgoingCards}</div>` : ''}`;
  }

  function personCard(person, actionsHtml = '', subtext = '') {
    return `<article class="social-card"><button class="social-user-icon" type="button" data-profile-id="${escapeHtml(person.id)}" aria-label="Abrir perfil de ${escapeHtml(person.display_name)}" style="background:${skinColor(person.current_skin)}">${emojiFor(person.current_skin)}</button><div class="social-card-main"><div class="social-card-title"><span>${escapeHtml(person.display_name || 'Jugador')}</span></div><div class="social-card-sub">${escapeHtml(subtext || `${Number(person.games_played) || 0} partidas · skin ${skinInfo(person.current_skin).name}`)}</div></div>${actionsHtml}</article>`;
  }

  function canInvite() {
    const room = appActions.getRoom?.();
    return Boolean(room?.phase === 'lobby');
  }

  async function renderInbox(node) {
    const rows = await fetchNotifications();
    if (!rows.length) {
      node.innerHTML = '<div class="social-state"><span style="font-size:26px">✉</span><strong>No hay avisos</strong><p>Las solicitudes de amistad y de partida aparecerán aquí.</p></div>';
      return;
    }
    const senders = await getProfilesByIds(rows.map((row) => row.sender_id));
    const byId = new Map(senders.map((profile) => [profile.id, profile]));
    node.innerHTML = `<div class="social-list">${rows.map((row) => {
      const sender = byId.get(row.sender_id) || { id: row.sender_id, display_name: 'Jugador', current_skin: 'mint' };
      const unreadClass = row.read_at ? '' : 'inbox-new';
      let description = '';
      let actions = '';
      const kindLabel = {
        friend_request: 'SOLICITUD DE AMISTAD', friend_accepted: 'AMISTAD ACEPTADA',
        game_invite: 'INVITACIÓN A JUGAR', game_accepted: 'INVITACIÓN ACEPTADA'
      }[row.kind] || 'AVISO';
      if (row.kind === 'friend_request') {
        description = 'quiere añadirte como amigo.';
        actions = `<button class="mini-button" data-inbox-action="accept-friend" data-notification-id="${escapeHtml(row.id)}" data-friendship-id="${escapeHtml(row.data?.friendship_id || '')}" data-sender-id="${escapeHtml(row.sender_id)}">Aceptar</button><button class="mini-button is-danger" data-inbox-action="reject-friend" data-notification-id="${escapeHtml(row.id)}" data-friendship-id="${escapeHtml(row.data?.friendship_id || '')}">Ignorar</button>`;
      } else if (row.kind === 'friend_accepted') {
        description = 'ha aceptado tu solicitud de amistad.';
        actions = `<button class="mini-button" data-profile-id="${escapeHtml(row.sender_id)}">Ver perfil</button>`;
      } else if (row.kind === 'game_invite') {
        description = `te invita a la sala ${escapeHtml(row.data?.room_code || '—')}.`;
        actions = `<button class="mini-button" data-inbox-action="join-game" data-notification-id="${escapeHtml(row.id)}" data-sender-id="${escapeHtml(row.sender_id)}" data-room-code="${escapeHtml(row.data?.room_code || '')}">Unirme</button>`;
      } else if (row.kind === 'game_accepted') {
        description = `se ha unido a la invitación de la sala ${escapeHtml(row.data?.room_code || '—')}.`;
        actions = `<button class="mini-button" data-inbox-action="join-game" data-notification-id="${escapeHtml(row.id)}" data-sender-id="${escapeHtml(row.sender_id)}" data-room-code="${escapeHtml(row.data?.room_code || '')}">Abrir sala</button>`;
      }
      if (row.read_at) actions = '<span class="inbox-kind">LEÍDO</span>';
      else if (!actions) actions = `<button class="mini-button is-muted" data-inbox-action="mark-read" data-notification-id="${escapeHtml(row.id)}">Leído</button>`;
      return `<article class="social-card ${unreadClass}"><button class="social-user-icon" type="button" data-profile-id="${escapeHtml(sender.id)}" style="background:${skinColor(sender.current_skin)}">${emojiFor(sender.current_skin)}</button><div class="social-card-main"><div class="inbox-kind">${kindLabel}</div><div class="social-card-sub"><b>${escapeHtml(sender.display_name)}</b> ${description}</div><div class="social-card-sub">${formatDate(row.created_at)}</div></div><div class="social-card-actions">${actions}</div></article>`;
    }).join('')}</div>`;
  }

  async function fetchNotifications() {
    if (!hasSession()) return [];
    const params = new URLSearchParams({ select: 'id,recipient_id,sender_id,kind,data,read_at,created_at', recipient_id: `eq.${currentUid()}`, order: 'created_at.desc', limit: '30' });
    const rows = await apiRequest(`notifications?${params}`);
    notificationRows = Array.isArray(rows) ? rows : [];
    updateNotificationBadge(notificationRows.filter((row) => !row.read_at).length);
    return notificationRows;
  }

  function updateNotificationBadge(count) {
    const badge = $('#notificationBadge');
    const tabCount = $('#inboxTabCount');
    if (badge) {
      badge.hidden = count <= 0;
      badge.textContent = count > 9 ? '9+' : String(count);
    }
    if (tabCount) {
      tabCount.hidden = count <= 0;
      tabCount.textContent = count > 9 ? '9+' : String(count);
    }
  }

  async function refreshNotifications(silent = false) {
    if (!hasSession()) {
      updateNotificationBadge(0);
      return [];
    }
    const rows = await fetchNotifications();
    const ids = new Set(rows.filter((row) => !row.read_at).map((row) => row.id));
    if (lastNotificationIds && !silent && [...ids].some((id) => !lastNotificationIds.has(id))) toast('Tienes una notificación nueva.');
    lastNotificationIds = ids;
    if (socialTab === 'inbox' && !$('#socialModal').hidden) renderSocialContent();
    return rows;
  }

  async function createNotification(recipientId, kind, data = {}) {
    if (!hasSession() || !recipientId || recipientId === currentUid()) throw new Error('No se pudo crear el aviso.');
    await apiRequest('notifications', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: { recipient_id: recipientId, sender_id: currentUid(), kind, data }
    });
    return true;
  }

  async function markNotificationRead(id) {
    if (!id || !hasSession()) return;
    const params = new URLSearchParams({ id: `eq.${id}`, recipient_id: `eq.${currentUid()}` });
    await apiRequest(`notifications?${params}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { read_at: new Date().toISOString() } });
  }

  async function addFriend(targetId) {
    if (!hasSession() || !targetId || targetId === currentUid()) return;
    const params = new URLSearchParams({ select: 'id,user_id,friend_id,status', limit: '1' });
    const filter = `(user_id.eq.${currentUid()},friend_id.eq.${currentUid()})`;
    params.set('or', filter);
    const existing = await apiRequest(`friendships?${params}`);
    const match = (Array.isArray(existing) ? existing : []).find((row) => (row.user_id === targetId && row.friend_id === currentUid()) || (row.friend_id === targetId && row.user_id === currentUid()));
    if (match?.status === 'accepted') { toast('Ya sois amigos.'); return; }
    if (match?.status === 'pending' && match.user_id === currentUid()) { toast('La solicitud ya está enviada.'); return; }
    if (match?.status === 'pending') {
      await acceptFriendship(match.id, targetId);
      return;
    }
    const inserted = await apiRequest('friendships', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: { user_id: currentUid(), friend_id: targetId, status: 'pending' }
    });
    const friendship = Array.isArray(inserted) ? inserted[0] : null;
    await createNotification(targetId, 'friend_request', { friendship_id: friendship?.id || null });
    toast('Solicitud de amistad enviada.');
    await renderSocialContent();
  }

  async function acceptFriendship(friendshipId, senderId, notificationId = '') {
    if (!friendshipId || !hasSession()) throw new Error('No se encontró esa solicitud.');
    const params = new URLSearchParams({ id: `eq.${friendshipId}` });
    await apiRequest(`friendships?${params}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'accepted' } });
    if (senderId && senderId !== currentUid()) await createNotification(senderId, 'friend_accepted', {});
    if (notificationId) await markNotificationRead(notificationId);
    toast('¡Ya sois amigos!');
    await renderSocialContent();
    refreshNotifications(true).catch(() => {});
  }

  async function rejectFriendship(friendshipId, notificationId = '') {
    if (friendshipId) {
      const params = new URLSearchParams({ id: `eq.${friendshipId}` });
      await apiRequest(`friendships?${params}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
    if (notificationId) await markNotificationRead(notificationId);
    toast('Solicitud descartada.');
    await renderSocialContent();
    refreshNotifications(true).catch(() => {});
  }

  async function sendGameInvite(targetId) {
    const room = appActions.getRoom?.();
    if (!room || room.phase !== 'lobby') {
      toast('Crea o únete a una sala antes de invitar.');
      return;
    }
    await createNotification(targetId, 'game_invite', { room_code: room.code });
    toast('Invitación de juego enviada.');
  }

  async function openProfile(profileId) {
    if (!hasSession() || !profileId) {
      openAccount();
      return;
    }
    profileModalUserId = profileId;
    closeModal('socialModal');
    closeModal('accountModal');
    $('#profileModalContent').innerHTML = '<div class="social-state"><span>✳</span><strong>Cargando perfil…</strong></div>';
    openModal('profileModal');
    try {
      const isOwn = profileId === currentUid();
      let profile = null;
      if (isOwn) {
        profile = await fetchOwnProfile();
        if (profile) {
          cloudProfile = profile;
          notifyAuthChanged();
        }
      } else {
        const rows = await apiRequest(`profiles?${profileQueryById(profileId)}`);
        profile = Array.isArray(rows) ? rows[0] : null;
      }
      if (!profile) throw new Error('No encontramos ese perfil.');
      const [history, relationships] = await Promise.all([
        apiRequest(`game_results?${new URLSearchParams({ select: 'game_id,mode,score,result_type,created_at,member_ids', player_id: `eq.${profileId}`, order: 'created_at.desc', limit: '12' })}`),
        isOwn ? Promise.resolve([]) : getRelationships()
      ]);
      renderProfile(profile, Array.isArray(history) ? history : [], relationships, isOwn);
    } catch (error) {
      $('#profileModalContent').innerHTML = databaseErrorHtml(error);
    }
  }

  function renderProfile(profile, history, relationships, isOwn) {
    const id = profile.id;
    const emoji = emojiFor(profile.current_skin);
    const skin = skinInfo(profile.current_skin);
    let actions = '';
    if (!isOwn) {
      const relation = relationshipFor(id, relationships);
      let friendshipButton = `<button class="button button-secondary" data-profile-action="add-friend" data-user-id="${escapeHtml(id)}">Añadir amigo</button>`;
      if (relation?.status === 'accepted') friendshipButton = '<button class="button button-secondary" disabled>♡ Ya sois amigos</button>';
      else if (relation?.status === 'pending' && relation.user_id === currentUid()) friendshipButton = '<button class="button button-secondary" disabled>Solicitud enviada</button>';
      else if (relation?.status === 'pending') friendshipButton = `<button class="button button-secondary" data-profile-action="accept-friend" data-friendship-id="${escapeHtml(relation.id)}" data-sender-id="${escapeHtml(id)}">Aceptar solicitud</button>`;
      const inviteButton = canInvite()
        ? `<button class="button button-primary" data-profile-action="invite-game" data-user-id="${escapeHtml(id)}">Invitar a jugar</button>`
        : '<button class="button button-primary" disabled>Invitar a jugar</button>';
      actions = `<div class="profile-actions">${friendshipButton}${inviteButton}</div>${!canInvite() ? '<p class="modal-footnote">Para enviar una invitación de juego, crea una sala y vuelve a este perfil.</p>' : ''}`;
    }
    const historyHtml = history.length ? history.map((game) => {
      const outcome = game.result_type === 'board-full' ? 'Jardín completo' : game.result_type === 'collision' ? 'Choque' : game.result_type === 'draw' ? 'Empate' : 'Ronda terminada';
      return `<div class="profile-history-row"><span>${game.mode === 'solo' ? 'Solitario' : 'Equipo'} · ${outcome}<br><small>${formatDate(game.created_at)}</small></span><b>${Number(game.score) || 0} 🍎</b></div>`;
    }).join('') : '<div class="social-state"><p>Aún no hay partidas guardadas.</p></div>';
    $('#profileModalContent').innerHTML = `<div class="profile-hero"><span class="profile-avatar-large" style="background:${skinColor(profile.current_skin)}">${emoji}</span><div class="profile-hero-main"><h3>${escapeHtml(profile.display_name || 'Jugador')}</h3><p>${escapeHtml(skin.name)} · ${isOwn ? 'Tu perfil' : 'Perfil público'}</p></div></div>
      <div class="profile-stats"><div class="profile-stat"><b>${Number(profile.games_played) || 0}</b><small>Partidas</small></div><div class="profile-stat"><b>${Number(profile.total_apples) || 0}</b><small>Manzanas</small></div><div class="profile-stat"><b>${Number(profile.games_won) || 0}</b><small>Jardines</small></div><div class="profile-stat"><b>${Number(profile.best_solo) || 0}</b><small>Récord solo</small></div></div>
      <h3 class="profile-section-title">ÚLTIMAS PARTIDAS</h3><div class="profile-history">${historyHtml}</div>${actions}`;
  }

  async function handleSocialAction(event) {
    const profileButton = event.target.closest('[data-profile-id]');
    if (profileButton) {
      openProfile(profileButton.dataset.profileId);
      return;
    }
    const loginButton = event.target.closest('[data-social-login]');
    if (loginButton) { openAccount(); return; }
    const retryButton = event.target.closest('[data-social-retry]');
    if (retryButton) { renderSocialContent(); return; }
    const action = event.target.closest('[data-social-action]');
    if (!action) return;
    action.disabled = true;
    try {
      if (action.dataset.socialAction === 'add-friend') await addFriend(action.dataset.userId);
      else if (action.dataset.socialAction === 'accept-friend') await acceptFriendship(action.dataset.friendshipId, action.dataset.senderId);
      else if (action.dataset.socialAction === 'reject-friend') await rejectFriendship(action.dataset.friendshipId);
      else if (action.dataset.socialAction === 'view-profile') await openProfile(action.dataset.userId);
      else if (action.dataset.socialAction === 'invite-game') await sendGameInvite(action.dataset.userId);
    } catch (error) { toast(error.message, 3800); }
    finally { action.disabled = false; }
  }

  async function handleInboxAction(event) {
    const button = event.target.closest('[data-inbox-action]');
    if (!button) return;
    button.disabled = true;
    const action = button.dataset.inboxAction;
    try {
      if (action === 'accept-friend') {
        await acceptFriendship(button.dataset.friendshipId, button.dataset.senderId, button.dataset.notificationId);
      } else if (action === 'reject-friend') {
        await rejectFriendship(button.dataset.friendshipId, button.dataset.notificationId);
      } else if (action === 'mark-read') {
        await markNotificationRead(button.dataset.notificationId);
        await renderSocialContent();
        refreshNotifications(true).catch(() => {});
      } else if (action === 'join-game') {
        const code = String(button.dataset.roomCode || '').toUpperCase();
        const senderId = button.dataset.senderId;
        const notificationId = button.dataset.notificationId;
        await markNotificationRead(notificationId);
        closeModal('socialModal');
        const joined = await appActions.joinRoom?.(code);
        if (joined) {
          await createNotification(senderId, 'game_accepted', { room_code: code });
          toast('Te has unido a la sala.');
        }
        refreshNotifications(true).catch(() => {});
      }
    } catch (error) { toast(error.message, 3800); }
    finally { button.disabled = false; }
  }

  async function handleProfileAction(event) {
    const button = event.target.closest('[data-profile-action]');
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.profileAction === 'add-friend') {
        await addFriend(button.dataset.userId);
        await openProfile(profileModalUserId);
      } else if (button.dataset.profileAction === 'accept-friend') {
        await acceptFriendship(button.dataset.friendshipId, button.dataset.senderId);
        await openProfile(profileModalUserId);
      } else if (button.dataset.profileAction === 'invite-game') {
        await sendGameInvite(button.dataset.userId);
      }
    } catch (error) { toast(error.message, 3800); }
    finally { button.disabled = false; }
  }

  async function searchFriends(event) {
    if (event.target.id !== 'friendSearchForm') return;
    event.preventDefault();
    friendSearchTerm = String($('#friendSearchInput')?.value || '').trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 30);
    await renderSocialContent();
  }

  async function initialize(options = {}) {
    appActions = options.actions || {};
    authChanged = typeof options.onAuthChanged === 'function' ? options.onAuthChanged : () => {};
    document.body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-profile-id]');
      if (!button || button.closest('#socialContent') || button.closest('#profileModalContent')) return;
      openProfile(button.dataset.profileId);
    });
    $('#socialContent').addEventListener('click', handleSocialAction);
    $('#socialContent').addEventListener('click', handleInboxAction);
    $('#socialContent').addEventListener('submit', searchFriends);
    $('#profileModalContent').addEventListener('click', handleProfileAction);
    $('#profileModalContent').addEventListener('click', (event) => {
      const profileButton = event.target.closest('[data-profile-id]');
      if (profileButton) openProfile(profileButton.dataset.profileId);
    });
    $('#accountButton').addEventListener('click', openAccount);
    $('#notificationsButton').addEventListener('click', () => openSocial('inbox'));
    $('#openLeaderboard').addEventListener('click', () => openSocial('leaderboard'));
    $('#openFriends').addEventListener('click', () => openSocial('friends'));
    $('#closeAccount').addEventListener('click', () => closeModal('accountModal'));
    $('#closeSocial').addEventListener('click', () => closeModal('socialModal'));
    $('#closeProfile').addEventListener('click', () => closeModal('profileModal'));
    $('#accountModal').addEventListener('click', (event) => { if (event.target === $('#accountModal')) closeModal('accountModal'); });
    $('#socialModal').addEventListener('click', (event) => { if (event.target === $('#socialModal')) closeModal('socialModal'); });
    $('#profileModal').addEventListener('click', (event) => { if (event.target === $('#profileModal')) closeModal('profileModal'); });
    $('#authForm').addEventListener('submit', submitAuth);
    $('#authModeToggle').addEventListener('click', () => {
      accountMode = accountMode === 'login' ? 'signup' : 'login';
      setAuthStatus('');
      renderAccount();
    });
    $('#openOwnProfile').addEventListener('click', () => openProfile(currentUid()));
    $('#signOutButton').addEventListener('click', signOut);
    document.querySelectorAll('[data-social-tab]').forEach((button) => button.addEventListener('click', () => {
      socialTab = button.dataset.socialTab;
      friendSearchTerm = '';
      renderSocialTabs();
      renderSocialContent();
    }));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      for (const id of ['profileModal', 'socialModal', 'accountModal']) {
        if (!$(`#${id}`).hidden) { closeModal(id); break; }
      }
    });

    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (response.ok) config = { ...config, ...(await response.json()) };
    } catch (_error) { /* El modo de juego funciona incluso si no hay conexión con Supabase. */ }

    const saved = sessionFromAuthRedirect() || localSession();
    if (saved && config.supabaseConfigured) {
      session = saved;
      try {
        const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
          headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${session.access_token}` }
        });
        if (response.ok) user = await response.json();
        else {
          await refreshAuthSession();
          const refreshed = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
            headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${session.access_token}` }
          });
          if (refreshed.ok) user = await refreshed.json();
          else throw new Error('La sesión ya no es válida.');
        }
        await ensureProfile({ localProfile: options.localProfile || {} });
      } catch (error) {
        profileError = error.message;
        if (!user) {
          session = null;
          user = null;
          cloudProfile = null;
          saveSession();
        }
      }
    } else if (saved && !config.supabaseConfigured) {
      session = null;
      saveSession();
    }
    renderAccount();
    notifyAuthChanged();
    scheduleExpiryRefresh();
    if (hasSession()) {
      refreshNotifications(true).catch(() => {});
      notificationTimer = window.setInterval(() => refreshNotifications(false).catch(() => {}), 20_000);
    }
  }

  window.SnakeSocial = {
    init: initialize,
    getSession: () => session,
    getUser: () => user,
    getProfile: () => cloudProfile,
    isConfigured: () => config.supabaseConfigured,
    isSignedIn: hasSession,
    updateProfile,
    updateDisplayName,
    recordGameResult,
    refreshNotifications,
    openProfile,
    openAccount,
    openSocial,
    getLocalError: () => profileError
  };
})();
