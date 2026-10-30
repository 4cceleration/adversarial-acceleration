import { generateUsername, generatePassword } from './identity.js';

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = window.AA_API_BASE;
  const sessionKey = 'aa-shared-landing-session-v1';
  let theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  let session = sessionStorage.getItem(sessionKey) || '';
  let user = null, landing = { title: '', html: '', css: '', js: '', revision: -1 }, timer, toastTimer, pollBusy = false;
  let authTab = 'register', newToken = '', newTokenName = '';
  let registrationUsername = '', registrationPassword = '';
  let oauthRequestId = new URLSearchParams(location.hash.slice(1)).get('authorize') || '';
  if (!/^[a-f0-9]{64}$/.test(oauthRequestId)) oauthRequestId = '';
  function icon(name) {
    const paths = {
      user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      random: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'
    };
    return `<svg class="ui-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  }
  async function request(path, { method = 'GET', data, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && session) headers.Authorization = `Bearer ${session}`;
    let response;
    try { response = await fetch(`${base}${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.'); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && auth && session) { session = ''; sessionStorage.removeItem(sessionKey); user = null; newToken = ''; newTokenName = ''; updateAccount(); showSecret(); }
      const error = new Error(result.error || `Error ${response.status}`); error.status = response.status; throw error;
    }
    return result;
  }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200); }
  function applyTheme(next) {
    theme = next === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('aa-theme', theme); } catch {}
    const button = $('theme-toggle');
    const label = theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro';
    button.setAttribute('aria-label', label); button.title = label; button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${theme === 'dark' ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>' : '<path d="M20.7 13.3A9 9 0 0 1 10.7 3.3a9 9 0 1 0 10 10Z"/>'}</svg>`;
    // Send only a visual preference. Do not reload the iframe or reset its state.
    $('landing-frame')?.contentWindow?.postMessage({ type: 'aa:theme', theme }, '*');
  }
  function applyAppearance(value = {}) {
    const style = document.documentElement.style;
    for (const [field, variable] of [['accentColor', '--aa-accent-light'], ['darkAccentColor', '--aa-accent-dark']]) {
      if (/^#[a-fA-F0-9]{6}$/.test(value[field] || '')) style.setProperty(variable, value[field]); else style.removeProperty(variable);
    }
    if (Number.isFinite(value.buttonRadius) && value.buttonRadius >= 4 && value.buttonRadius <= 24) style.setProperty('--aa-control-radius', `${value.buttonRadius}px`);
    else style.removeProperty('--aa-control-radius');
  }
  function frameDocument(value) {
    const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const themeCss = ':root{color-scheme:light;--aa-background:#ffffff;--aa-foreground:#15204a;--aa-surface:#f3f5ff;--aa-muted:#798299;--aa-border:#e5e9f2}:root[data-aa-theme="dark"]{color-scheme:dark;--aa-background:#080e24;--aa-foreground:#eef2ff;--aa-surface:#121e40;--aa-muted:#a3afcc;--aa-border:#2a375e}:root[data-aa-theme="dark"] body{background:var(--aa-background)!important;color:var(--aa-foreground)!important}';
    const themeBridge = 'addEventListener("message",function(e){if(e.source!==parent||e.data?.type!=="aa:theme"||!["light","dark"].includes(e.data.theme))return;document.documentElement.dataset.aaTheme=e.data.theme;});';
    return `<!doctype html><html lang="es" data-aa-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${esc(value.title || 'Página compartida')}</title><style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif}body{background:var(--aa-background);color:var(--aa-foreground)}*{box-sizing:border-box}${value.css || ''}</style><style>${themeCss}</style></head><body>${value.html || ''}<script>${themeBridge}<\/script><script>${value.js || ''}<\/script></body></html>`;
  }
  function renderLanding(next) {
    if (next.revision === landing.revision) return;
    const contentChanged = landing.revision < 0 || ['html', 'css', 'js'].some(key => next[key] !== landing[key]);
    landing = next; applyAppearance(next.appearance);
    if (contentChanged) $('landing-frame').srcdoc = frameDocument(next);
    document.title = next.title ? `${next.title} · Adversarial Acceleration` : 'Adversarial Acceleration';
  }
  async function poll() {
    if (pollBusy || document.hidden) return;
    pollBusy = true;
    try { renderLanding(await request('/api/landing', { auth: false })); $('account-trigger').title = 'Abrir tu cuenta'; }
    catch { $('account-trigger').title = 'Sin conexión · intentando reconectar'; }
    finally { pollBusy = false; }
  }
  function updateAccount() {
    $('account-label').textContent = user ? user.username : 'Entrar';
    if (user) $('avatar').textContent = user.name.slice(0, 2).toUpperCase();
    else $('avatar').innerHTML = icon('user');
  }
  function showAuth() {
    if (authTab === 'register' && !registrationUsername) registrationUsername = generateUsername();
    if (authTab === 'register' && !registrationPassword) registrationPassword = generatePassword();
    let suggestedUsername = registrationUsername;
    if (authTab === 'login') { try { suggestedUsername = localStorage.getItem('aa-last-user') || ''; } catch { suggestedUsername = ''; } }
    $('account-dialog').classList.remove('wide');
    $('dialog-content').innerHTML = `<div class="auth-shell"><h1 id="dialog-title">Tu cuenta</h1><div class="auth-tabs" role="tablist"><button role="tab" data-auth="register" class="${authTab === 'register' ? 'active' : ''}" aria-selected="${authTab === 'register'}">Crear cuenta</button><button role="tab" data-auth="login" class="${authTab === 'login' ? 'active' : ''}" aria-selected="${authTab === 'login'}">Iniciar sesión</button></div><form id="auth-form"><div class="field"><label for="auth-username">Usuario</label><div class="input-with-action"><input id="auth-username" name="username" value="${esc(suggestedUsername)}" placeholder="Tu usuario" minlength="3" maxlength="32" pattern="[a-zA-Z0-9_\\-]{3,32}" autocomplete="username" autocapitalize="none" spellcheck="false" required>${authTab === 'register' ? `<button id="regenerate-username" class="input-action" type="button" aria-label="Generar otro usuario" title="Generar otro usuario">${icon('random')}</button>` : ''}</div></div><div class="field"><label for="auth-password">Contraseña</label><div class="input-with-action ${authTab === 'register' ? 'password-generated' : ''}"><input id="auth-password" name="password" type="password" value="${authTab === 'register' ? esc(registrationPassword) : ''}" autocapitalize="none" spellcheck="false" placeholder="Mínimo 10 caracteres" minlength="10" maxlength="200" autocomplete="${authTab === 'register' ? 'new-password' : 'current-password'}" required><div class="input-actions"><button id="toggle-password" class="input-action" type="button" aria-label="Mostrar contraseña" title="Mostrar contraseña" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>${authTab === 'register' ? `<button id="copy-password" class="input-action" type="button" aria-label="Copiar contraseña" title="Copiar contraseña">${icon('copy')}</button><button id="regenerate-password" class="input-action" type="button" aria-label="Generar otra contraseña" title="Generar otra contraseña">${icon('random')}</button>` : ''}</div></div>${authTab === 'register' ? '<small class="password-hint">Guárdala para volver a entrar.</small>' : ''}</div><p id="auth-error" class="form-error" role="alert"></p><button class="primary full" type="submit">${authTab === 'register' ? 'Crear mi cuenta' : 'Entrar'}</button></form></div>`;
    document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => { authTab = button.dataset.auth; showAuth(); }));
    $('auth-username').addEventListener('input', () => { if (authTab === 'register') registrationUsername = $('auth-username').value; });
    $('regenerate-username')?.addEventListener('click', () => { registrationUsername = generateUsername(); $('auth-username').value = registrationUsername; });
    $('auth-password').addEventListener('input', () => { if (authTab === 'register') registrationPassword = $('auth-password').value; });
    $('regenerate-password')?.addEventListener('click', () => { registrationPassword = generatePassword(); $('auth-password').value = registrationPassword; });
    $('copy-password')?.addEventListener('click', () => copy($('auth-password').value));
    $('toggle-password').addEventListener('click', () => {
      const input = $('auth-password'), button = $('toggle-password');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      const label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
      button.setAttribute('aria-label', label); button.title = label; button.setAttribute('aria-pressed', String(visible));
      button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${visible ? '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.2 4.2M6.2 6.2A19 19 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5.8-1.7"/>' : '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'}</svg>`;
    });
    $('auth-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true; $('auth-error').textContent = '';
      try {
        const input = Object.fromEntries(new FormData(event.target));
        const result = await request(`/api/auth/${authTab}`, { method: 'POST', data: input, auth: false });
        session = result.session; sessionStorage.setItem(sessionKey, session); user = result.profile; newToken = ''; newTokenName = ''; try { localStorage.setItem('aa-last-user', user.username); } catch {} registrationUsername = ''; registrationPassword = ''; updateAccount(); await showPanel();
      } catch (e) { if ($('auth-error')) $('auth-error').textContent = e.message; }
      finally { button.disabled = false; }
    });
  }
  function accountLayout(content) {
    $('account-dialog').classList.add('wide');
    $('dialog-content').innerHTML = `<div class="account-shell">
      <header class="account-header"><div class="avatar">${esc(user.name.slice(0,2))}</div><div class="account-identity"><span>Tu cuenta</span><strong title="${esc(user.username)}">${esc(user.username)}</strong></div></header>
      <section class="account-content">${content}</section>
      <footer class="account-footer"><a class="agent-help" href="./llms.txt" target="_blank" rel="noopener">Guía de uso</a><button class="text-button" id="logout">Cerrar sesión</button></footer>
    </div>`;
    $('logout').addEventListener('click', logout);
  }
  async function showPanel() {
    if (!user) { showAuth(); return; }
    if (oauthRequestId) await showConsent();
    else await showConnections();
  }
  function clearAuthorizationRequest() {
    oauthRequestId = '';
    history.replaceState(null, '', location.pathname + location.search);
  }
  async function showConsent() {
    accountLayout('<h2 id="dialog-title">Conectar agente</h2><p class="tiny">Cargando solicitud…</p>');
    try {
      const info = await request(`/api/oauth/request?id=${encodeURIComponent(oauthRequestId)}`);
      accountLayout(`<h2 id="dialog-title">Conectar agente</h2>
        <div class="consent-card"><strong>${esc(info.name)}</strong><p>Solicita permiso para ${info.scope === 'write' ? 'leer y editar' : 'leer'} la página compartida.</p><small>${esc(info.destination)}</small></div>
        <div class="consent-actions"><button class="secondary" id="deny-connection">Cancelar</button><button class="primary" id="allow-connection">Autorizar</button></div>
        <p id="consent-error" class="form-error" role="alert"></p>`);
      const decide = async allow => {
        const buttons = [$('allow-connection'), $('deny-connection')];
        buttons.forEach(button => button.disabled = true);
        try {
          const result = await request('/api/oauth/consent', { method: 'POST', data: { requestId: oauthRequestId, allow } });
          clearAuthorizationRequest(); location.assign(result.redirect);
        } catch (e) { if (!user) { showAuth(); return; } if ($('consent-error')) $('consent-error').textContent = e.message; buttons.forEach(button => button.disabled = false); }
      };
      $('allow-connection').addEventListener('click', () => decide(true));
      $('deny-connection').addEventListener('click', () => decide(false));
    } catch (e) {
      if (!user) { showAuth(); return; }
      accountLayout(`<h2 id="dialog-title">Conectar agente</h2><p class="form-error consent-message">${esc(e.message)}</p><button class="secondary" id="back-to-account">Volver a mi cuenta</button>`);
      $('back-to-account').addEventListener('click', () => { clearAuthorizationRequest(); showPanel(); });
    }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado'); }
    catch { toast('No se pudo copiar. Selecciona el texto y cópialo manualmente.'); }
  }
  function agentPrompt(token = '') {
    const guideUrl = new URL('./llms.txt', location.href).href;
    return `Conecta tu agente a Adversarial Acceleration.

Guía: ${guideUrl}
API: ${base}
MCP remoto (Streamable HTTP): ${base}/api/mcp

${token ? `Usa este token existente. No crees otra cuenta.
Authorization: Bearer ${token}` : 'Lee la guía. Reutiliza una conexión existente si ya tienes una. Si no, crea tu propia cuenta técnica y genera un token por API siguiendo el flujo de registro de la guía. No necesito copiarte un token manualmente.'}

Guarda las credenciales de forma privada, fuera del repositorio y de la página. Nunca las muestres en tu respuesta.
Configura el MCP remoto. Si tu entorno no admite conectores MCP pero sí peticiones HTTP, usa la API como alternativa e indícalo.
Solo conecta y lee la landing para confirmar el acceso. No modifiques, limpies ni publiques contenido de prueba. Espera a que yo te diga qué crear.
Al terminar dime el nombre de la conexión y el usuario asociado, sin revelar secretos.`;
  }
  async function showConnections() {
    accountLayout(`<h2 id="dialog-title">Conexiones</h2>
      <div id="new-token"></div>
      <details id="create-connection" class="create-connection" ${newToken ? '' : 'open'}>
        <summary>Nueva conexión</summary>
        <form id="token-form" class="token-form">
          <div class="field"><label for="token-name">Nombre</label><input id="token-name" name="name" value="Mi agente" maxlength="60" required></div>
          <div class="field"><label for="token-scope">Permiso</label><select id="token-scope" name="scope"><option value="write">Leer y editar</option><option value="read">Solo lectura</option></select></div>
          <button class="primary" type="submit">Crear conexión</button>
        </form>
        <p id="token-error" class="form-error" role="alert"></p>
      </details>
      <div class="section"><div class="section-head">Tus conexiones</div><div id="tokens-list" class="token-list"><p class="tiny">Cargando…</p></div></div>`);
    showSecret();
    $('token-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; $('token-error').textContent = '';
      try {
        const result = await request('/api/tokens', { method: 'POST', data: Object.fromEntries(new FormData(event.target)) });
        newToken = result.token; newTokenName = result.name; showSecret(); event.target.reset();
        if ($('create-connection')) $('create-connection').open = false;
        $('copy-token-guide')?.focus();
        await loadTokens();
      } catch (e) { if ($('token-error')) $('token-error').textContent = e.message; }
      finally { button.disabled = false; }
    });
    await loadTokens();
  }
  function showSecret() {
    if (!$('new-token')) return;
    if (!newToken) { $('new-token').innerHTML = ''; return; }
    $('new-token').innerHTML = `<section class="connection-ready">
      <div class="connection-ready-heading"><span class="ready-icon">${icon('check')}</span><div><strong>${esc(newTokenName || 'Mi agente')}</strong><p>Acceso listo</p></div></div>
      <button class="primary full" id="copy-token-guide">${icon('copy')} Copiar para mi agente</button>
      <p class="tiny">Pega el texto en tu agente. Guarda el acceso antes de recargar.</p>
    </section>`;
    $('copy-token-guide').addEventListener('click', () => copy(agentPrompt(newToken)));
  }
  async function loadTokens() {
    try {
      const result = await request('/api/tokens'); if (!$('tokens-list')) return;
      $('tokens-list').innerHTML = result.tokens.length ? result.tokens.map(t => `<div class="token-row"><div><strong>${esc(t.name)}</strong><small>•••• ${esc(t.suffix)} · ${t.scope === 'write' ? 'Lectura y edición' : 'Solo lectura'}</small></div><button class="text-button danger" data-revoke="${esc(t.id)}" data-suffix="${esc(t.suffix)}">Revocar</button></div>`).join('') : '<div class="empty">Aún no tienes conexiones</div>';
      document.querySelectorAll('[data-revoke]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('¿Revocar esta conexión? El agente perderá el acceso.')) return;
        button.disabled = true;
        try { await request(`/api/tokens/${button.dataset.revoke}/revoke`, { method: 'POST', data: {} }); if (newToken && button.dataset.suffix === newToken.slice(-6)) { newToken = ''; newTokenName = ''; showSecret(); if ($('create-connection')) $('create-connection').open = true; } await loadTokens(); toast('Conexión revocada'); }
        catch (e) { toast(e.message); button.disabled = false; }
      }));
    } catch (e) { if ($('tokens-list')) $('tokens-list').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }
  async function logout() {
    const button = $('logout'); button.disabled = true;
    try { await request('/api/auth/logout', { method: 'POST', data: {} }); }
    catch (e) { if (e.status !== 401) { toast(e.message); button.disabled = false; return; } }
    session = ''; sessionStorage.removeItem(sessionKey); user = null; newToken = ''; newTokenName = ''; updateAccount(); authTab = 'login'; showAuth();
  }
  $('account-trigger').addEventListener('click', async () => {
    $('account-dialog').showModal();
    if (session && !user) {
      $('dialog-content').innerHTML = '<div class="dialog-loading">Abriendo tu cuenta…</div>';
      try { user = (await request('/api/me')).profile; updateAccount(); } catch (e) { if (e.status !== 401) { toast(e.message); $('account-dialog').close(); return; } }
    }
    await showPanel();
  });
  $('close-dialog').addEventListener('click', () => $('account-dialog').close());
  $('account-dialog').addEventListener('close', () => { $('dialog-content').innerHTML = ''; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  $('theme-toggle').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
  $('landing-frame').addEventListener('load', () => applyTheme(theme));
  applyTheme(theme);
  poll(); timer = setInterval(poll, 5000);
  async function initializeAccount() {
    if (session) { try { user = (await request('/api/me')).profile; updateAccount(); } catch {} }
    if (oauthRequestId) {
      try { if (localStorage.getItem('aa-last-user')) authTab = 'login'; } catch {}
      if (!$('account-dialog').open) $('account-dialog').showModal();
      await showPanel();
    }
  }
  initializeAccount();
})();
