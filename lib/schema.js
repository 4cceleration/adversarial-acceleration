export class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const emptyLanding = () => ({ title: '', html: '', css: '', js: '', appearance: {}, revision: 0, updatedAt: null });
export const updateSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    expectedRevision: { type: 'integer', minimum: 0, description: 'Current revision returned by get_landing. Prevents overwriting someone else’s changes.' },
    title: { type: 'string', maxLength: 100, description: 'Browser title for the public landing.' },
    html: { type: 'string', maxLength: 300000, description: 'Complete HTML body. Self-contained: no external resources. Everyone sees this content.' },
    css: { type: 'string', maxLength: 150000, description: 'Complete CSS for the shared landing. For light/dark support use --aa-background, --aa-foreground, --aa-surface, --aa-muted, --aa-border. The host switches data-aa-theme without resetting the page.' },
    appearance: { type: 'object', additionalProperties: false, description: 'Optional visual styling for the protected account and theme controls. Cannot change behavior, visibility or permissions. Replaces the appearance object; {} restores defaults.', properties: {
      accentColor: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
      darkAccentColor: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
      buttonRadius: { type: 'number', minimum: 4, maximum: 24 }
    } },
    js: { type: 'string', maxLength: 150000, description: 'Complete JavaScript for the shared landing. Runs in an isolated iframe with no network, storage or parent access.' }
  }, required: ['expectedRevision']
};
export function validateUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new AppError(400, 'Incluye expectedRevision obtenido al leer la landing.');
  const result = { expectedRevision: input.expectedRevision };
  for (const [key, max] of [['title', 100], ['html', 300000], ['css', 150000], ['js', 150000]]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > max) throw new AppError(400, `${key}: texto de hasta ${max} caracteres requerido.`);
      result[key] = input[key];
    }
  }
  if (input.appearance !== undefined) {
    const appearance = input.appearance;
    if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance) || Object.keys(appearance).some(k => !['accentColor', 'darkAccentColor', 'buttonRadius'].includes(k))) throw new AppError(400, 'appearance solo admite accentColor, darkAccentColor y buttonRadius.');
    for (const key of ['accentColor', 'darkAccentColor']) if (appearance[key] !== undefined && (typeof appearance[key] !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(appearance[key]))) throw new AppError(400, 'Usa colores hexadecimales de seis dígitos.');
    if (appearance.buttonRadius !== undefined && (!Number.isFinite(appearance.buttonRadius) || appearance.buttonRadius < 4 || appearance.buttonRadius > 24)) throw new AppError(400, 'buttonRadius debe estar entre 4 y 24.');
    result.appearance = { ...appearance };
  }
  if (Object.keys(result).length < 2) throw new AppError(400, 'Incluye al menos title, html, css, js o appearance.');
  return result;
}
