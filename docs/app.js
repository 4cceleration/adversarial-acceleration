(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = window.AA_API_BASE;
  const sessionKey = 'aa-shared-landing-session-v1';
  let theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  let session = sessionStorage.getItem(sessionKey) || '';
  let user = null, landing = { title: '', html: '', css: '', js: '', revision: -1 }, timer, toastTimer, pollBusy = false;
  let panelTab = 'connections', authTab = 'register', methodTab = 'mcp', editorTab = 'html', draft = null, editorDirty = false, newToken = '';
  let registrationUsername = '';
  const mark = '<div class="wordmark"><div class="mark">a↗</div><span>Adversarial<br>Acceleration</span></div>';
  async function request(path, { method = 'GET', data, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && session) headers.Authorization = `Bearer ${session}`;
    let response;
    try { response = await fetch(`${base}${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.'); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && auth && session) { session = ''; sessionStorage.removeItem(sessionKey); user = null; updateAccount(); }
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
    for (const frame of [$('landing-frame'), $('preview-frame')]) frame?.contentWindow?.postMessage({ type: 'aa:theme', theme }, '*');
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
    $('avatar').textContent = user ? user.name.slice(0, 2).toUpperCase() : '↗';
  }
  function generateUsername() {
    return 'user' + Array.from(crypto.getRandomValues(new Uint8Array(5)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function showAuth() {
    if (authTab === 'register' && !registrationUsername) registrationUsername = generateUsername();
    let suggestedUsername = registrationUsername;
    if (authTab === 'login') { try { suggestedUsername = localStorage.getItem('aa-last-user') || ''; } catch { suggestedUsername = ''; } }
    $('account-dialog').classList.remove('wide');
    $('dialog-content').innerHTML = `<div class="auth-shell"><h1 id="dialog-title">Tu cuenta</h1><div class="auth-tabs" role="tablist"><button role="tab" data-auth="register" class="${authTab === 'register' ? 'active' : ''}" aria-selected="${authTab === 'register'}">Crear cuenta</button><button role="tab" data-auth="login" class="${authTab === 'login' ? 'active' : ''}" aria-selected="${authTab === 'login'}">Iniciar sesión</button></div><form id="auth-form"><div class="field"><label for="auth-username">Usuario</label><div class="input-with-action"><input id="auth-username" name="username" value="${esc(suggestedUsername)}" placeholder="Tu usuario" minlength="3" maxlength="32" pattern="[a-zA-Z0-9_\\-]{3,32}" autocomplete="username" autocapitalize="none" spellcheck="false" required>${authTab === 'register' ? '<button id="regenerate-username" class="input-action" type="button" aria-label="Generar otro usuario" title="Generar otro usuario"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/></svg></button>' : ''}</div></div><div class="field"><label for="auth-password">Contraseña</label><div class="input-with-action"><input id="auth-password" name="password" type="password" placeholder="Mínimo 10 caracteres" minlength="10" maxlength="200" autocomplete="${authTab === 'register' ? 'new-password' : 'current-password'}" required><button id="toggle-password" class="input-action" type="button" aria-label="Mostrar contraseña" title="Mostrar contraseña" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div><p id="auth-error" class="form-error" role="alert"></p><button class="primary full" type="submit">${authTab === 'register' ? 'Crear mi cuenta' : 'Entrar'} <span class="arrow">↗</span></button></form></div>`;
    document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => { authTab = button.dataset.auth; showAuth(); }));
    $('auth-username').addEventListener('input', () => { if (authTab === 'register') registrationUsername = $('auth-username').value; });
    $('regenerate-username')?.addEventListener('click', () => { registrationUsername = generateUsername(); $('auth-username').value = registrationUsername; });
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
        session = result.session; sessionStorage.setItem(sessionKey, session); user = result.profile; try { localStorage.setItem('aa-last-user', user.username); } catch {} registrationUsername = ''; updateAccount(); panelTab = 'connections'; await showPanel();
      } catch (e) { if ($('auth-error')) $('auth-error').textContent = e.message; }
      finally { button.disabled = false; }
    });
  }
  function panelLayout(content) {
    $('account-dialog').classList.add('wide');
    $('dialog-content').innerHTML = `<div class="panel-shell"><aside class="panel-sidebar"><div class="user-card"><div class="avatar">${esc(user.name.slice(0,2))}</div><div><div class="user-name">${esc(user.username)}</div></div></div><nav class="panel-nav" aria-label="Tu cuenta"><button data-panel="connections" class="${panelTab === 'connections' ? 'active' : ''}"><span>↗</span> Conexiones</button><button data-panel="editor" class="${panelTab === 'editor' ? 'active' : ''}"><span>⌘</span> Editar página</button><button data-panel="profile" class="${panelTab === 'profile' ? 'active' : ''}"><span>○</span> Mi cuenta</button></nav></aside><section class="panel-main">${content}</section></div>`;
    document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', async () => {
      if (editorDirty && !confirm('Tienes cambios sin publicar. ¿Descartarlos?')) return;
      editorDirty = false; draft = null; newToken = ''; panelTab = button.dataset.panel; await showPanel();
    }));
  }
  async function showPanel() {
    if (!user) { showAuth(); return; }
    if (panelTab === 'connections') await showConnections();
    else if (panelTab === 'editor') await showEditor();
    else showProfile();
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado'); }
    catch { toast('No se pudo copiar. Selecciona el texto y cópialo manualmente.'); }
  }
  function connectionInstructions() {
    const mcpUrl = `${base}/api/mcp`;
    if (methodTab === 'mcp') return `<p class="field-label connection-label">URL del servidor</p><div class="copy-row"><code>${esc(mcpUrl)}</code><button class="secondary" id="copy-mcp">Copiar URL</button></div><p class="tiny">Authorization: Bearer TU_TOKEN</p>`;
    if (methodTab === 'codex') return `<div class="code-box"><pre>export AA_API_TOKEN='TU_TOKEN'
codex mcp add adversarial \\
  --url ${esc(mcpUrl)} \\
  --bearer-token-env-var AA_API_TOKEN</pre></div>`;
    return `<div class="code-box"><pre>GET ${esc(base)}/api/landing

PUT ${esc(base)}/api/landing
Authorization: Bearer TU_TOKEN
Content-Type: application/json

{
  "expectedRevision": ${Math.max(0, landing.revision)},
  "html": "&lt;h1&gt;Hola, mundo.&lt;/h1&gt;",
  "css": "body { padding: 80px; }",
  "js": ""
}</pre></div>`;
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
    panelLayout(`<h2 id="dialog-title">Conexiones</h2><div class="agent-connect"><div><strong>Conectar un agente</strong><p>El agente crea su propia cuenta y token.</p></div><button id="copy-agent-guide" class="primary">Copiar texto para LLM ↗</button><details class="agent-guide"><summary>Ver instrucciones</summary><pre>${esc(agentPrompt())}</pre></details></div><div class="section"><form id="token-form" class="token-form"><div class="field"><label for="token-name">Nombre de la conexión</label><input id="token-name" name="name" placeholder="Mi agente" maxlength="60" required></div><div class="field"><label for="token-scope">Permiso</label><select id="token-scope" name="scope"><option value="write">Leer y editar</option><option value="read">Solo lectura</option></select></div><button class="primary" type="submit">Crear token ↗</button></form><p id="token-error" class="form-error" role="alert"></p><div id="new-token"></div></div><div class="section"><div class="method-tabs"><button data-method="mcp" class="${methodTab === 'mcp' ? 'active' : ''}">MCP remoto</button><button data-method="codex" class="${methodTab === 'codex' ? 'active' : ''}">Codex CLI</button><button data-method="api" class="${methodTab === 'api' ? 'active' : ''}">API HTTP</button></div><div id="instructions">${connectionInstructions()}</div></div><div class="section"><div class="section-head">Tokens activos</div><div id="tokens-list" class="token-list"><p class="tiny">Cargando…</p></div></div>`);
    $('copy-agent-guide').addEventListener('click', () => copy(agentPrompt()));
    document.querySelectorAll('[data-method]').forEach(button => button.addEventListener('click', () => { methodTab = button.dataset.method; document.querySelectorAll('[data-method]').forEach(b => b.classList.toggle('active', b === button)); $('instructions').innerHTML = connectionInstructions(); bindCopyMcp(); }));
    bindCopyMcp();
    $('token-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; $('token-error').textContent = '';
      try {
        const result = await request('/api/tokens', { method: 'POST', data: Object.fromEntries(new FormData(event.target)) });
        newToken = result.token; showSecret(); event.target.reset(); await loadTokens();
      } catch (e) { $('token-error').textContent = e.message; }
      finally { button.disabled = false; }
    });
    showSecret(); await loadTokens();
  }
  function bindCopyMcp() { $('copy-mcp')?.addEventListener('click', () => copy(`${base}/api/mcp`)); }
  function showSecret() {
    if (!newToken || !$('new-token')) return;
    $('new-token').innerHTML = `<div class="secret-box"><p>Token creado · solo se muestra una vez</p><code>${esc(newToken)}</code><div class="action-row"><button class="secondary" id="copy-token">Copiar token</button><button class="secondary" id="copy-token-guide">Copiar conexión para LLM</button></div><p class="tiny">La conexión copiada incluye este token.</p></div>`;
    $('copy-token').addEventListener('click', () => copy(newToken));
    $('copy-token-guide').addEventListener('click', () => copy(agentPrompt(newToken)));
  }
  async function loadTokens() {
    try {
      const result = await request('/api/tokens'); if (!$('tokens-list')) return;
      $('tokens-list').innerHTML = result.tokens.length ? result.tokens.map(t => `<div class="token-row"><div><strong>${esc(t.name)}</strong><small>•••• ${esc(t.suffix)} · ${t.scope === 'write' ? 'Lectura y edición' : 'Solo lectura'}</small></div><button class="text-button danger" data-revoke="${esc(t.id)}">Revocar</button></div>`).join('') : '<div class="empty">Sin tokens activos</div>';
      document.querySelectorAll('[data-revoke]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('¿Revocar este token? El agente perderá el acceso.')) return;
        button.disabled = true;
        try { await request(`/api/tokens/${button.dataset.revoke}/revoke`, { method: 'POST', data: {} }); newToken = ''; if ($('new-token')) $('new-token').innerHTML = ''; await loadTokens(); toast('Token revocado'); }
        catch (e) { toast(e.message); button.disabled = false; }
      }));
    } catch (e) { if ($('tokens-list')) $('tokens-list').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }
  async function showEditor() {
    if (!draft) {
      try { draft = await request('/api/landing', { auth: false }); }
      catch (e) { toast(e.message); return; }
    }
    panelLayout(`<h2 id="dialog-title">Editar página</h2><div class="section"><div class="field"><label for="page-title">Título de la página</label><input id="page-title" value="${esc(draft.title)}" maxlength="100" placeholder="Una nueva idea"></div><div class="editor-tabs"><button data-code="html" class="${editorTab === 'html' ? 'active' : ''}">HTML</button><button data-code="css" class="${editorTab === 'css' ? 'active' : ''}">CSS</button><button data-code="js" class="${editorTab === 'js' ? 'active' : ''}">JavaScript</button></div><label class="field-label" for="code-editor" hidden>Código de la landing</label><textarea id="code-editor" class="code-editor" aria-label="Código ${editorTab.toUpperCase()}" spellcheck="false" placeholder="${editorTab === 'html' ? '<main>Tu próxima idea empieza aquí.</main>' : editorTab === 'css' ? 'body { padding: 80px; }' : '// Haz tu página interactiva'}">${esc(draft[editorTab])}</textarea><p id="editor-error" class="form-error" role="alert"></p><div class="action-row"><button id="preview-button" class="secondary">Vista previa</button><span class="spacer"></span><button id="publish-button" class="primary">Publicar cambios ↗</button></div><iframe id="preview-frame" class="preview" sandbox="allow-scripts" title="Vista previa privada" hidden></iframe><div class="action-row"><button id="reload-editor" class="text-button">Cargar página actual</button><button id="export-button" class="text-button">Exportar HTML</button><span class="spacer"></span><button id="clear-button" class="text-button danger">Dejar en blanco</button></div></div>`);
    $('code-editor').addEventListener('input', () => { draft[editorTab] = $('code-editor').value; editorDirty = true; });
    $('page-title').addEventListener('input', () => { draft.title = $('page-title').value; editorDirty = true; });
    document.querySelectorAll('[data-code]').forEach(button => button.addEventListener('click', () => { editorTab = button.dataset.code; document.querySelectorAll('[data-code]').forEach(b => b.classList.toggle('active', b === button)); $('code-editor').value = draft[editorTab]; $('code-editor').setAttribute('aria-label', `Código ${editorTab.toUpperCase()}`); }));
    $('preview-button').addEventListener('click', () => { $('preview-frame').hidden = false; $('preview-frame').srcdoc = frameDocument(draft); });
    $('publish-button').addEventListener('click', publish);
    $('reload-editor').addEventListener('click', async () => { if (editorDirty && !confirm('¿Descartar tus cambios y cargar la página actual?')) return; draft = null; editorDirty = false; await showEditor(); });
    $('export-button').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([frameDocument(draft)], { type: 'text/html;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'landing.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('clear-button').addEventListener('click', async () => {
      if (!confirm('La landing quedará en blanco para todos. ¿Continuar?')) return;
      try { const next = await request('/api/landing/clear', { method: 'POST', data: { expectedRevision: draft.revision } }); editorDirty = false; draft = null; renderLanding(next); $('account-dialog').close(); toast('Landing en blanco'); }
      catch (e) { $('editor-error').textContent = e.message; }
    });
  }
  async function publish() {
    if (!$('publish-button') || $('publish-button').disabled) return;
    $('publish-button').disabled = true; $('editor-error').textContent = '';
    try {
      const next = await request('/api/landing', { method: 'PUT', data: { title: draft.title, html: draft.html, css: draft.css, js: draft.js, expectedRevision: draft.revision } });
      renderLanding(next); editorDirty = false; draft = null; $('account-dialog').close(); toast('Página actualizada para todos');
    } catch (e) { $('editor-error').textContent = e.message; }
    finally { if ($('publish-button')) $('publish-button').disabled = false; }
  }
  function showProfile() {
    panelLayout(`<h2 id="dialog-title">Mi cuenta</h2><div class="section"><div class="account-detail"><span>Usuario</span><strong>@${esc(user.username)}</strong></div><div class="account-detail"><span>Acceso</span><strong>Landing compartida</strong></div></div><div class="section"><button class="secondary" id="logout">Cerrar sesión</button></div>`);
    $('logout').addEventListener('click', async () => {
      try { await request('/api/auth/logout', { method: 'POST', data: {} }); }
      catch (e) { if (e.status !== 401) { toast(e.message); return; } }
      session = ''; sessionStorage.removeItem(sessionKey); user = null; newToken = ''; draft = null; editorDirty = false; updateAccount(); authTab = 'login'; showAuth();
    });
  }
  $('account-trigger').addEventListener('click', async () => {
    $('account-dialog').showModal();
    if (session && !user) {
      $('dialog-content').innerHTML = '<div class="dialog-loading">Abriendo tu cuenta…</div>';
      try { user = (await request('/api/me')).profile; updateAccount(); } catch (e) { if (e.status !== 401) { toast(e.message); $('account-dialog').close(); return; } }
    }
    await showPanel();
  });
  function mayClose(event) { if (editorDirty && !confirm('¿Cerrar sin publicar tus cambios?')) { event?.preventDefault(); return; } editorDirty = false; draft = null; newToken = ''; $('account-dialog').close(); }
  $('close-dialog').addEventListener('click', mayClose);
  $('account-dialog').addEventListener('cancel', mayClose);
  $('account-dialog').addEventListener('close', () => { newToken = ''; $('dialog-content').innerHTML = ''; });
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 's' && $('account-dialog').open && panelTab === 'editor' && user) { event.preventDefault(); publish(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  $('theme-toggle').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
  $('landing-frame').addEventListener('load', () => applyTheme(theme));
  applyTheme(theme);
  poll(); timer = setInterval(poll, 5000);
  if (session) request('/api/me').then(result => { user = result.profile; updateAccount(); }).catch(() => {});
})();
