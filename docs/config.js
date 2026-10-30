// Public service URL only. No credentials belong in this file.
window.AA_API_BASE = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? location.origin
  : 'https://adversarial-acceleration.vercel.app';
