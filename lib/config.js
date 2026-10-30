export const isCloud = Boolean(process.env.VERCEL);
export const apiBase = (process.env.AA_API_URL || (isCloud ? 'https://adversarial-acceleration.vercel.app' : `http://127.0.0.1:${process.env.PORT || 4317}`)).replace(/\/$/, '');
export const site = process.env.AA_SITE_URL || (isCloud ? 'https://4cceleration.github.io/adversarial-acceleration/' : `${apiBase}/`);
export const mcpResource = `${apiBase}/api/mcp`;
