import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './schema.js';
const dir = resolve(process.env.AA_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '../data'));
const cloud = Boolean(process.env.VERCEL);
let blob;
async function sdk() { return blob ||= await import('@vercel/blob'); }
const digest = text => createHash('sha256').update(text).digest('hex');
let queue = Promise.resolve();
function lock(fn) { const p = queue.then(fn); queue = p.catch(() => {}); return p; }
export async function read(key) {
  if (cloud) {
    const { get, BlobNotFoundError } = await sdk();
    try {
      const result = await get(`aa-v1/${key}.json`, { access: 'private', useCache: false });
      if (!result) return null;
      return { value: JSON.parse(await new Response(result.stream).text()), etag: result.blob.etag };
    } catch (e) { if (e instanceof BlobNotFoundError) return null; throw e; }
  }
  try { const raw = await readFile(join(dir, `${key}.json`), 'utf8'); return { value: JSON.parse(raw), etag: digest(raw) }; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function write(key, value, etag = null) {
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw) > 1500000) throw new AppError(413, 'El contenido supera 1,5 MB.');
  if (cloud) {
    const { put, BlobPreconditionFailedError } = await sdk();
    try { return await put(`aa-v1/${key}.json`, raw, { access: 'private', addRandomSuffix: false, contentType: 'application/json', ...(etag ? { ifMatch: etag, allowOverwrite: true } : { allowOverwrite: false }) }); }
    catch (e) { if (e instanceof BlobPreconditionFailedError || /already exists|already been created/i.test(e.message)) throw new AppError(409, 'El registro cambió. Vuelve a intentarlo.'); throw e; }
  }
  return lock(async () => {
    const current = await read(key);
    if ((current?.etag || null) !== etag) throw new AppError(409, 'El registro cambió. Vuelve a intentarlo.');
    const file = join(dir, `${key}.json`); await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try { await writeFile(temp, raw, { mode: 0o600 }); await rename(temp, file); }
    finally { await unlink(temp).catch(() => {}); }
  });
}
export async function mutate(key, fn, initial) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await read(key);
    if (!current && initial === undefined) throw new AppError(404, 'Registro no encontrado.');
    const value = structuredClone(current?.value ?? initial);
    const result = await fn(value);
    try { await write(key, value, current?.etag || null); return result; }
    catch (e) { if (e.status !== 409 || attempt === 4) throw e; }
  }
}
