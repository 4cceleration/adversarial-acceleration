export class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const emptyLanding = () => ({ title: '', html: '', css: '', js: '', revision: 0, updatedAt: null });
export const updateSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    expectedRevision: { type: 'integer', minimum: 0, description: 'Current revision returned by get_landing. Prevents overwriting someone else’s changes.' },
    title: { type: 'string', maxLength: 100, description: 'Browser title for the public landing.' },
    html: { type: 'string', maxLength: 300000, description: 'Complete HTML body. Self-contained: no external resources. Everyone sees this content.' },
    css: { type: 'string', maxLength: 150000, description: 'Complete CSS for the shared landing.' },
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
  if (Object.keys(result).length < 2) throw new AppError(400, 'Incluye al menos title, html, css o js.');
  return result;
}
