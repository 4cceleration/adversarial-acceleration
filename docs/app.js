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
    const themeCss = ':root{color-scheme:light;--aa-background:#ffffff;--aa-foreground:#1b2b24;--aa-surface:#f5f6f2;--aa-muted:#788078;--aa-border:#e5e8e2}:root[data-aa-theme="dark"]{color-scheme:dark;--aa-background:#101511;--aa-foreground:#e5eae2;--aa-surface:#1d271f;--aa-muted:#a0ad9b;--aa-border:#354135}:root[data-aa-theme="dark"] body{background:var(--aa-background)!important;color:var(--aa-foreground)!important}';
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
  function showAuth() {
    $('account-dialog').classList.remove('wide');
    $('dialog-content').innerHTML = `<div class="auth-shell"><h1 id="dialog-title">Tu cuenta</h1><div class="auth-tabs" role="tablist"><button role="tab" data-auth="register" class="${authTab === 'register' ? 'active' : ''}" aria-selected="${authTab === 'register'}">Crear cuenta</button><button role="tab" data-auth="login" class="${authTab === 'login' ? 'active' : ''}" aria-selected="${authTab === 'login'}">Iniciar sesión</button></div><form id="auth-form">${authTab === 'register' ? '<div class="field"><label for="auth-name">Tu nombre</label><input id="auth-name" name="name" placeholder="Cómo te llamas" maxlength="60" autocomplete="name" required></div>' : ''}<div class="field"><label for="auth-username">Usuario</label><input id="auth-username" name="username" placeholder="tu_usuario" minlength="3" maxlength="32" pattern="[a-zA-Z0-9_\\-]{3,32}" autocomplete="username" autocapitalize="none" spellcheck="false" required></div><div class="field"><label for="auth-password">Contraseña</label><input id="auth-password" name="password" type="password" placeholder="Mínimo 10 caracteres" minlength="10" maxlength="200" autocomplete="${authTab === 'register' ? 'new-password' : 'current-password'}" required></div><p id="auth-error" class="form-error" role="alert"></p><button class="primary full" type="submit">${authTab === 'register' ? 'Crear mi cuenta' : 'Entrar'} <span class="arrow">↗</span></button></form></div>`;
    document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => { authTab = button.dataset.auth; showAuth(); }));
    $('auth-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true; $('auth-error').textContent = '';
      try {
        const input = Object.fromEntries(new FormData(event.target));
        const result = await request(`/api/auth/${authTab}`, { method: 'POST', data: input, auth: false });
        session = result.session; sessionStorage.setItem(sessionKey, session); user = result.profile; updateAccount(); panelTab = 'connections'; await showPanel();
      } catch (e) { if ($('auth-error')) $('auth-error').textContent = e.message; }
      finally { button.disabled = false; }
    });
  }
  function panelLayout(content) {
    $('account-dialog').classList.add('wide');
    $('dialog-content').innerHTML = `<div class="panel-shell"><aside class="panel-sidebar">${mark}<div class="user-card"><div class="avatar">${esc(user.name.slice(0,2))}</div><div><div class="user-name">${esc(user.name)}</div><div class="user-handle">@${esc(user.username)}</div></div></div><nav class="panel-nav" aria-label="Tu cuenta"><button data-panel="connections" class="${panelTab === 'connections' ? 'active' : ''}"><span>↗</span> Conexiones</button><button data-panel="editor" class="${panelTab === 'editor' ? 'active' : ''}"><span>⌘</span> Editar página</button><button data-panel="profile" class="${panelTab === 'profile' ? 'active' : ''}"><span>○</span> Mi cuenta</button></nav><div class="sidebar-foot">UN SOLO LIENZO.<br>VISIBLE PARA TODOS.<br><br>ADVERSARIAL ACCELERATION</div></aside><section class="panel-main">${content}</section></div>`;
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
    if (methodTab === 'mcp') return `<p class="tiny">Añade esta URL como servidor MCP remoto. En la autenticación o los encabezados del conector, usa <strong>Authorization: Bearer TU_TOKEN</strong>. Requiere un cliente que admita tokens o encabezados personalizados.</p><div class="copy-row"><code>${esc(mcpUrl)}</code><button class="secondary" id="copy-mcp">Copiar URL</button></div><div class="tool-tags"><code>get_landing</code><code>update_landing</code><code>clear_landing</code></div>`;
    if (methodTab === 'codex') return `<p class="tiny">Define AA_API_TOKEN en la terminal donde inicies Codex y agrega el servidor:</p><div class="code-box"><pre>export AA_API_TOKEN='TU_TOKEN'
codex mcp add adversarial \\
  --url ${esc(mcpUrl)} \\
  --bearer-token-env-var AA_API_TOKEN</pre></div><p class="tiny">Sustituye TU_TOKEN por el token recién creado. No lo publiques ni lo pegues en el contenido de la landing.</p>`;
    return `<p class="tiny">Lee primero la página para obtener la revisión actual. Después envía los campos que quieras reemplazar:</p><div class="code-box"><pre>GET ${esc(base)}/api/landing

PUT ${esc(base)}/api/landing
Authorization: Bearer TU_TOKEN
Content-Type: application/json

{
  "expectedRevision": ${Math.max(0, landing.revision)},
  "html": "&lt;h1&gt;Hola, mundo.&lt;/h1&gt;",
  "css": "body { padding: 80px; }",
  "js": ""
}</pre></div><p class="tiny">Si otra persona cambia la página antes, recibirás un conflicto. Vuelve a leerla para conservar sus cambios.</p>`;
  }
  async function showConnections() {
    panelLayout(`<p class="eyebrow">Conecta tu imaginación</p><h2 id="dialog-title">Tu agente. Esta página.</h2><p class="lede">Dale a tu asistente una conexión a este lienzo.<br>Lo que construya aparecerá aquí, para todos.</p><div class="section"><div class="section-head"><span class="step">1</span> Crea una llave de acceso</div><form id="token-form" class="token-form"><div class="field"><label for="token-name">Nombre de la conexión</label><input id="token-name" name="name" placeholder="Mi agente" maxlength="60" required></div><div class="field"><label for="token-scope">Permiso</label><select id="token-scope" name="scope"><option value="write">Leer y editar</option><option value="read">Solo lectura</option></select></div><button class="primary" type="submit">Crear token ↗</button></form><p id="token-error" class="form-error" role="alert"></p><div id="new-token"></div></div><div class="section"><div class="section-head"><span class="step">2</span> Conéctalo a tu agente</div><div class="method-tabs"><button data-method="mcp" class="${methodTab === 'mcp' ? 'active' : ''}">MCP remoto</button><button data-method="codex" class="${methodTab === 'codex' ? 'active' : ''}">Codex CLI</button><button data-method="api" class="${methodTab === 'api' ? 'active' : ''}">API HTTP</button></div><div id="instructions">${connectionInstructions()}</div></div><div class="section"><div class="section-head"><span class="step">3</span> Empieza con una idea</div><div class="copy-row"><code>Lee la landing y crea una página con una gráfica interactiva. Conserva el acceso a la cuenta.</code><button class="secondary" id="copy-prompt">Copiar</button></div></div><div class="section"><div class="section-head">Tus conexiones</div><div id="tokens-list" class="token-list"><p class="tiny">Cargando…</p></div></div>`);
    document.querySelectorAll('[data-method]').forEach(button => button.addEventListener('click', () => { methodTab = button.dataset.method; document.querySelectorAll('[data-method]').forEach(b => b.classList.toggle('active', b === button)); $('instructions').innerHTML = connectionInstructions(); bindCopyMcp(); }));
    bindCopyMcp();
    $('copy-prompt').addEventListener('click', () => copy('Usa el MCP de Adversarial Acceleration: lee la landing con get_landing y crea una página con una gráfica interactiva usando update_landing. Usa HTML, CSS y JavaScript autocontenidos, sin dependencias externas. Si usas datos de ejemplo, indícalo. Es una página pública compartida.'));
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
    $('new-token').innerHTML = `<div class="secret-box"><p><strong>Tu token está listo.</strong> Guárdalo ahora: solo se muestra una vez.</p><code>${esc(newToken)}</code><button class="secondary" id="copy-token">Copiar token</button></div>`;
    $('copy-token').addEventListener('click', () => copy(newToken));
  }
  async function loadTokens() {
    try {
      const result = await request('/api/tokens'); if (!$('tokens-list')) return;
      $('tokens-list').innerHTML = result.tokens.length ? result.tokens.map(t => `<div class="token-row"><div><strong>${esc(t.name)}</strong><small>•••• ${esc(t.suffix)} · ${t.scope === 'write' ? 'Lectura y edición' : 'Solo lectura'}</small></div><button class="text-button danger" data-revoke="${esc(t.id)}">Revocar</button></div>`).join('') : '<div class="empty">Todavía no tienes conexiones. Crea un token para darle acceso a tu agente.</div>';
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
    panelLayout(`<p class="eyebrow">Un cambio, para todos</p><h2 id="dialog-title">El lienzo es tuyo. Y de todos.</h2><p class="lede">Puedes editar aquí o pedirle a tu agente que lo haga.<br>La vista previa es privada; publicar cambia la página pública.</p><div class="section"><div class="field"><label for="page-title">Título de la página</label><input id="page-title" value="${esc(draft.title)}" maxlength="100" placeholder="Una nueva idea"></div><div class="editor-tabs"><button data-code="html" class="${editorTab === 'html' ? 'active' : ''}">HTML</button><button data-code="css" class="${editorTab === 'css' ? 'active' : ''}">CSS</button><button data-code="js" class="${editorTab === 'js' ? 'active' : ''}">JavaScript</button></div><label class="field-label" for="code-editor" hidden>Código de la landing</label><textarea id="code-editor" class="code-editor" aria-label="Código ${editorTab.toUpperCase()}" spellcheck="false" placeholder="${editorTab === 'html' ? '<main>Tu próxima idea empieza aquí.</main>' : editorTab === 'css' ? 'body { padding: 80px; }' : '// Haz tu página interactiva'}">${esc(draft[editorTab])}</textarea><p class="tiny">HTML, CSS y JS autocontenidos. El contenido se ejecuta aislado, sin acceso a cuentas ni recursos externos.</p><p id="editor-error" class="form-error" role="alert"></p><div class="action-row"><button id="preview-button" class="secondary">Vista previa</button><span class="spacer"></span><button id="publish-button" class="primary">Publicar cambios ↗</button></div><iframe id="preview-frame" class="preview" sandbox="allow-scripts" title="Vista previa privada" hidden></iframe><div class="action-row"><button id="reload-editor" class="text-button">Cargar página actual</button><button id="export-button" class="text-button">Exportar HTML</button><span class="spacer"></span><button id="clear-button" class="text-button danger">Dejar en blanco</button></div></div>`);
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
    panelLayout(`<p class="eyebrow">Tu acceso</p><h2 id="dialog-title">Mi cuenta</h2><p class="lede">Tus credenciales son personales.<br>El lienzo que editamos es compartido.</p><div class="section"><div class="account-detail"><span>Nombre</span><strong>${esc(user.name)}</strong></div><div class="account-detail"><span>Usuario</span><strong>@${esc(user.username)}</strong></div><div class="account-detail"><span>Acceso</span><strong>Landing compartida</strong></div></div><div class="notice">Los tokens se administran en Conexiones. Revoca los que ya no uses. Este prototipo no tiene recuperación automática de contraseña: conserva tu acceso.</div><div class="section"><button class="secondary" id="logout">Cerrar sesión</button></div>`);
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
