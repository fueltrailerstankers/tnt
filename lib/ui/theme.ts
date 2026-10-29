// Pure theme helpers. The chosen theme lives in localStorage; no stored value means "follow the OS".

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'tt-theme';

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** The theme in effect: an explicit choice wins, otherwise the OS preference. */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): Theme {
  return parseTheme(stored) ?? (prefersDark ? 'dark' : 'light');
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

/** Inline script run before first paint so a stored choice never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
