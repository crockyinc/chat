/**
 * Browser identity.
 *
 * The device serial number is a UUID created with crypto.randomUUID() the very
 * first time this browser opens the app and then kept in localStorage, so the
 * same device keeps the same identity across reloads, restarts and reconnects.
 * The display name is optional and always editable.
 */

const ID_KEY = 'lm.device.id';
const NAME_KEY = 'lm.device.name';
const THEME_KEY = 'lm.theme';

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage full — identity still works for this tab */
  }
}

export function getDeviceId() {
  let id = read(ID_KEY);
  if (!id || !/^[0-9a-zA-Z-]{8,64}$/.test(id)) {
    id = crypto.randomUUID();
    write(ID_KEY, id);
  }
  return id;
}

export function getDisplayName() {
  return read(NAME_KEY) || '';
}

export function setDisplayName(name) {
  write(NAME_KEY, String(name || '').trim().slice(0, 60));
}

/** Short serial shown in bubbles and the sidebar: first 8 chars + ellipsis. */
export function shortSerial(deviceId) {
  if (!deviceId) return 'unknown';
  return deviceId.slice(0, 8);
}

export function initialsFor(name, deviceId) {
  const source = (name || '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }
  return (deviceId || '??').slice(0, 2).toUpperCase();
}

/** Deterministic avatar colour so each device is recognisable at a glance. */
export function avatarColor(deviceId = '') {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i += 1) hash = (hash * 31 + deviceId.charCodeAt(i)) % 360;
  const hue = hash % 360;
  return `hsl(${hue} 68% 46%)`;
}

/* -------------------------------------------------------------------- theme */

export function getTheme() {
  const stored = read(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme = getTheme()) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  write(THEME_KEY, theme);
  const button = document.getElementById('themeToggle');
  if (button) {
    const iconHost = button.querySelector('[data-icon]');
    if (iconHost) {
      iconHost.dataset.icon = theme === 'dark' ? 'sun' : 'moon';
      iconHost.dataset.iconMounted = 'false';
      iconHost.innerHTML = '';
    }
  }
  document.dispatchEvent(new CustomEvent('lm:theme', { detail: { theme } }));
  return theme;
}

export function toggleTheme() {
  return applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
