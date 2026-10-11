// Site configuration. Contact details below MUST be confirmed with the company before going live.
export const CONFIG = {
  // TODO(confirm): official enquiries address — the contact form opens a pre-filled email to it.
  email: 'office@bulstroygroup.com',
  // TODO(confirm): leave empty to hide the phone row.
  phone: '',
  defaultLang: 'auto', // 'auto' (browser language), 'bg' or 'en'
};

// Pre-rendered construction film (see render/render.py). The single-file build inlines the frames.
export const FRAMES = {
  count: 180,
  src: (i) => (window.__BSG_FRAMES ? window.__BSG_FRAMES[i] : `frames/f${String(i).padStart(4, '0')}.webp`),
};
