# Adversarial Acceleration

Una sola landing pública, inicialmente en blanco. Cualquier persona puede verla; cualquier usuario registrado puede modificar **esa misma página** desde un agente por MCP, por API o desde el editor web. El acceso a la cuenta permanece en la esquina superior derecha.

- **Página:** https://4cceleration.github.io/adversarial-acceleration/
- **API:** https://adversarial-acceleration.vercel.app/api
- **MCP remoto:** https://adversarial-acceleration.vercel.app/api/mcp

## Usar

1. Abre la página y pulsa **Entrar**.
2. El registro sugiere un usuario aleatorio sin guiones, que puedes cambiar o regenerar. Elige una contraseña de al menos 10 caracteres; el botón del ojo permite mostrarla u ocultarla.
3. En **Conexiones**, crea un token con permiso de lectura y edición. Se muestra una sola vez.
4. Configura la URL MCP y el encabezado `Authorization: Bearer TU_TOKEN` en un cliente compatible. También puedes usar la API o **Editar página**.

Todos editan el mismo contenido. Publicar o dejar en blanco afecta a todos los visitantes. No publiques información privada. La interfaz muestra cambios automáticamente cada cinco segundos mientras está visible.

El botón de sol/luna cambia el tema para ese navegador y conserva su preferencia. No recarga el contenido ni reinicia sus interacciones. La interfaz de cuenta y el botón de tema están fuera del iframe editable. Su diseño puede ajustarse con `appearance: {accentColor: "#315f47", darkAccentColor: "#b5ce9c", buttonRadius: 16}` en `update_landing`; esas opciones no permiten modificar su funcionalidad ni ocultarlos. Para que una landing personalizada siga el tema, usa las variables CSS `--aa-background`, `--aa-foreground`, `--aa-surface`, `--aa-muted` y `--aa-border`, o el selector `html[data-aa-theme="dark"]`.

## Codex CLI

En la terminal desde la que iniciarás Codex:

```sh
export AA_API_TOKEN='TU_TOKEN'
codex mcp add adversarial \
  --url https://adversarial-acceleration.vercel.app/api/mcp \
  --bearer-token-env-var AA_API_TOKEN
```

El MCP ofrece `get_landing`, `update_landing` y `clear_landing`. Antes de editar, el agente debe leer la revisión actual. Un `409` indica que otro usuario modificó el contenido; debe volver a leerlo.

En clientes que no admitan autenticación por token en un MCP remoto, usa el puente local por stdio:

```json
{
  "mcpServers": {
    "adversarial": {
      "command": "/RUTA/ABSOLUTA/A/node",
      "args": ["/RUTA/ABSOLUTA/adversarial-acceleration/mcp.js"],
      "env": {
        "AA_BASE_URL": "https://adversarial-acceleration.vercel.app",
        "AA_API_TOKEN": "TU_TOKEN"
      }
    }
  }
}
```

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

Los secretos de Vercel y los datos locales quedan fuera del repositorio mediante `.gitignore`. El frontend solo contiene la URL pública de la API. La función debe tener acceso al almacenamiento privado conectado al proyecto. `AA_SITE_URL` y `AA_ALLOWED_ORIGINS` permiten ajustar dominio y orígenes permitidos.

## Alcance del prototipo

- Una landing compartida; no hay espacios privados, moderación, historial ni recuperación automática de contraseña.
- El HTML generado se ejecuta en un iframe aislado con scripts, sin acceso a la cuenta, cookies, almacenamiento del origen o red. Usa recursos inline, SVG o imágenes data URL. El estado interno de esos scripts se reinicia al cargar una nueva edición.
- No hay IA integrada: el agente externo genera el contenido y llama a las herramientas reales. El editor manual permite probar el flujo.
- Registro y login tienen límites de frecuencia. La landing está limitada en tamaño. El alojamiento y almacenamiento están sujetos al plan y cuotas del proveedor.
- Este prototipo no envía correo ni verifica identidad; las cuentas se identifican por usuario.

## Comprobación

```sh
npm test
```

La prueba de integración verifica registro, login, edición compartida entre cuentas, conflictos simultáneos, permisos, revocación, persistencia tras reinicio y llamadas MCP con el SDK oficial.
