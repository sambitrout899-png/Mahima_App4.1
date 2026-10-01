// Central config — API base comes from index.html runtime detection
export const API_BASE =
  typeof window !== 'undefined' && window.__API_BASE__
    ? window.__API_BASE__
    : 'https://beta.mahimaministries.in/api';

export const SIGNALR_HUB_URL = API_BASE.replace('/api', '') + '/hubs/chat';

export const APP_NAME = 'Mahima Ministry';
export const BRAND_COLOR = '#047857';
