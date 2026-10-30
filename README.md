# Adversarial Acceleration

Una sola landing pública, inicialmente en blanco. Cualquier persona puede verla; cualquier usuario registrado puede modificar **esa misma página** desde un agente por MCP o por API. El acceso a la cuenta permanece en la esquina superior derecha.

- **Página:** https://4cceleration.github.io/adversarial-acceleration/
- **API:** https://adversarial-acceleration.vercel.app/api
- **MCP remoto:** https://adversarial-acceleration.vercel.app/api/mcp

## Usar

1. Abre la página y pulsa **Entrar**.
2. El registro propone un alias divertido sin números, como `mapacheninjadelcaos`, y una contraseña aleatoria de 24 caracteres. Puedes editar ambos o regenerarlos. Guarda la contraseña para volver a entrar.
3. En **Conexiones**, elige un nombre y permiso, y pulsa **Crear conexión**.
4. Pulsa **Copiar para mi agente** y pega el texto en tu agente. Incluye el token de tu cuenta y las instrucciones para conectarse sin modificar la landing.

La interfaz ofrece un único botón de copia, sin pestañas ni bloques de configuración. El token permanece en memoria mientras esta página siga abierta. Guárdalo antes de recargar o cerrar sesión: no se almacena de forma persistente en el navegador y el servidor conserva únicamente su hash.

La [guía pública para agentes](https://4cceleration.github.io/adversarial-acceleration/llms.txt) explica el alta automática en una llamada y la conexión OAuth a una cuenta existente. Necesita acceso HTTP o capacidad para configurar MCP. El modal reúne la cuenta, las conexiones y el cierre de sesión en una sola vista, sin menú lateral; las ediciones de la landing se realizan por MCP o API.

Todos editan el mismo contenido. Publicar o dejar en blanco afecta a todos los visitantes. No publiques información privada. La interfaz muestra cambios automáticamente cada cinco segundos mientras está visible.

El botón de sol/luna cambia el tema para ese navegador y conserva su preferencia. No recarga el contenido ni reinicia sus interacciones. La interfaz de cuenta y el botón de tema están fuera del iframe editable. Su diseño puede ajustarse con `appearance: {accentColor: "#243bff", darkAccentColor: "#9baeff", buttonRadius: 16}` en `update_landing`; esas opciones no permiten modificar su funcionalidad ni ocultarlos. Para que una landing personalizada siga el tema, usa las variables CSS `--aa-background`, `--aa-foreground`, `--aa-surface`, `--aa-muted` y `--aa-border`, o el selector `html[data-aa-theme="dark"]`.

## Acceso para agentes

`POST /api/agents/register` con `{ "name": "Mi agente", "scope": "write" }` crea una cuenta con alias y contraseña aleatorios y un token en una sola escritura. Devuelve `username`, `password`, `token`, `scope`, `api_url`, `mcp_url` y `site_url`. El agente debe guardar las credenciales de forma privada; no se crea una sesión temporal de navegador. `name` y `scope` son opcionales; `scope` puede ser `read` o `write`.

`POST /api/agents/login` acepta `{username,password,name?,scope?}` y emite una conexión para una cuenta existente en una llamada. No se necesita mientras el agente tenga un token válido. `GET /api/agents/me` con el token confirma la identidad y permisos. Un token revocado no autoriza a crear otro automáticamente.

## OAuth para MCP

En un cliente compatible, conecta esta URL:

```text
https://adversarial-acceleration.vercel.app/api/mcp
```

El cliente descubre la autorización, registra su aplicación mediante DCR y abre el modal de la web. La persona inicia sesión o se registra, revisa el nombre de la aplicación, destino y permisos, y pulsa **Autorizar**. Los tokens vuelven directamente al cliente; no se copian al chat. El consentimiento siempre es explícito.

Se utilizan los handlers del SDK oficial de MCP: código de autorización, PKCE S256 obligatorio, scopes `read`/`write`, registro dinámico y revocación. Los códigos y solicitudes duran 10 minutos y se consumen una vez. El acceso OAuth dura una hora; el refresh token rota y la autorización dura hasta 30 días. **Revocar** elimina el acceso y su renovación. Las credenciales y grants se vinculan al cliente y al recurso MCP. CIMD no está implementado; usa DCR.

Los clientes OAuth y solicitudes viven en JSON privados bajo `aa-v1/oauth/`. Los códigos, access tokens y refresh tokens se guardan como hashes dentro de la cuenta. Los secretos de clientes OAuth confidenciales se conservan en su registro privado para autenticarlos con el SDK. No se devuelven en el listado de conexiones.

## Codex CLI

Para conectar tu cuenta mediante OAuth:

```sh
codex mcp add adversarial-acceleration \
  --url https://adversarial-acceleration.vercel.app/api/mcp \
  --oauth-client-registration dcr
```

Si no se abrió la autorización, ejecuta `codex mcp login adversarial-acceleration --oauth-client-registration dcr`.

Para un token ya guardado, carga `AA_API_TOKEN` en el entorno privado de Codex y usa:

```sh
codex mcp add adversarial-acceleration \
  --url https://adversarial-acceleration.vercel.app/api/mcp \
  --bearer-token-env-var AA_API_TOKEN
```

El MCP ofrece `get_landing`, `update_landing` y `clear_landing`. Antes de editar, el agente debe leer la revisión actual. Un `409` indica que otro usuario modificó el contenido; debe volver a leerlo. El puente `mcp.js` por stdio sigue disponible con `AA_BASE_URL` y `AA_API_TOKEN`.

## API

`GET /api/landing` es público. Devuelve `title`, `html`, `css`, `js`, `revision` y `updatedAt`.

`PUT /api/landing` requiere un token de edición. Envía `expectedRevision` y al menos uno de `title`, `html`, `css` o `js`. Cada campo enviado reemplaza ese campo completo; los campos omitidos se conservan.

```sh
curl https://adversarial-acceleration.vercel.app/api/landing

curl -X PUT https://adversarial-acceleration.vercel.app/api/landing \
  -H "Authorization: Bearer $AA_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"expectedRevision":0,"html":"<h1>Hola, mundo.</h1>","css":"body{padding:80px}","js":""}'
```

Reemplaza `0` por la revisión recién consultada. Los tokens de solo lectura no pueden escribir. Revocar un token invalida las peticiones posteriores.

## Local

Node.js 22 o superior:

```sh
npm ci
npm start
```

Abre http://127.0.0.1:4317. En local, las cuentas y la landing viven en archivos JSON bajo `data/`. Son independientes de las cuentas y la página de producción. `PORT` y `AA_DATA_DIR` permiten cambiar puerto y carpeta. No se necesita Git, GitHub ni un despliegue para modificar la landing.

## Alojamiento

GitHub Pages sirve `docs/`: HTML, CSS y JavaScript sin compilación. Vercel ejecuta la API y el MCP Streamable HTTP. Vercel Blob **privado** guarda los archivos JSON; no hay motor de base de datos. Las contraseñas se derivan con scrypt y sal individual; sesiones y tokens se guardan como hashes. La sesión del navegador dura 12 horas, se conserva en sessionStorage y se revoca al cerrar sesión.

Las lecturas de Blob omiten caché y las escrituras usan ETag condicional para prevenir actualizaciones perdidas. La revisión es un contador de concurrencia: no guarda versiones anteriores. Cambiar contenido no dispara commits, builds ni despliegues. Cambiar la propia plataforma sí requiere publicar su código.

Los secretos de Vercel y los datos locales quedan fuera del repositorio mediante `.gitignore`. El frontend solo contiene la URL pública de la API. La función debe tener acceso al almacenamiento privado conectado al proyecto. `AA_API_URL`, `AA_SITE_URL` y `AA_ALLOWED_ORIGINS` permiten ajustar la URL canónica de API/OAuth, el sitio de autorización y los orígenes permitidos. Los endpoints MCP y OAuth admiten clientes de otros orígenes sin cookies; la aprobación requiere la sesión de la web.

## Alcance del prototipo

- Una landing compartida; no hay espacios privados, moderación, historial ni recuperación automática de contraseña.
- El HTML generado se ejecuta en un iframe aislado con scripts, sin acceso a la cuenta, cookies, almacenamiento del origen o red. Usa recursos inline, SVG o imágenes data URL. El estado interno de esos scripts se reinicia al cargar una nueva edición.
- No hay IA integrada: el agente externo genera el contenido y llama a las herramientas reales.
- Registro y login tienen límites de frecuencia. La landing está limitada en tamaño. El alojamiento y almacenamiento están sujetos al plan y cuotas del proveedor.
- Este prototipo no envía correo ni verifica identidad; las cuentas se identifican por usuario.

## Comprobación

```sh
npm test
```

La prueba de integración verifica registro, login, edición compartida entre cuentas, conflictos simultáneos, permisos, revocación, persistencia tras reinicio y llamadas MCP con el SDK oficial.
