/** UI のアイコン（インライン SVG） */
const svg = (body: string, view = '0 0 24 24') => `<svg viewBox="${view}" aria-hidden="true">${body}</svg>`;

export const ICON = {
  coin: svg(
    '<circle cx="12" cy="12" r="10" fill="#f2b632"/><circle cx="12" cy="12" r="10" fill="none" stroke="#d48a12" stroke-width="1.6"/><circle cx="12" cy="12" r="7" fill="#ffd257"/>' +
      '<ellipse cx="12" cy="13.6" rx="2.6" ry="2.1" fill="#d48a12"/><circle cx="8.9" cy="10.6" r="1.1" fill="#d48a12"/><circle cx="11" cy="9" r="1.1" fill="#d48a12"/><circle cx="13" cy="9" r="1.1" fill="#d48a12"/><circle cx="15.1" cy="10.6" r="1.1" fill="#d48a12"/>' +
      '<path d="M6.5 7.5a7 7 0 0 1 4-2.4" stroke="#fff6d0" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  ),
  rp: svg(
    '<path d="M9 3h6M10 3v6.2L4.8 18.4A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.6L14 9.2V3" fill="#e9fbf8" stroke="#2b8f84" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M7.4 15h9.2l2 3.5a1 1 0 0 1-.9 1.5H6.3a1 1 0 0 1-.9-1.5z" fill="#3fc4b4"/><circle cx="10.5" cy="17" r="1" fill="#e9fbf8"/><circle cx="13.6" cy="16" r=".7" fill="#e9fbf8"/><circle cx="12.3" cy="12" r=".8" fill="#3fc4b4"/>',
  ),
  cat: svg(
    '<path d="M4 9.5 4.6 3.4l4.6 3.4h5.6l4.6-3.4.6 6.1c.6 1 .9 2.1.9 3.3C20.9 18 17 21 12 21s-8.9-3-8.9-8.2c0-1.2.3-2.3.9-3.3z" fill="#f4a24c" stroke="#c46f22" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<ellipse cx="8.8" cy="13" rx="1.2" ry="1.6" fill="#3a2a20"/><ellipse cx="15.2" cy="13" rx="1.2" ry="1.6" fill="#3a2a20"/><path d="M11.2 15.6h1.6L12 16.6z" fill="#e0727f"/><path d="M10.4 17.2c.8.7 1.6.4 1.6-.4 0 .8.8 1.1 1.6.4" stroke="#3a2a20" stroke-width=".9" fill="none" stroke-linecap="round"/>',
  ),
  flask: svg(
    '<path d="M9 3h6M10 3v6L5 18.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5L14 9V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="M7.2 15h9.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),
  sound: svg('<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  mute: svg('<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  gear: svg(
    '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.6A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  ),
  close: svg('<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
  hammer: svg(
    '<path d="m13.5 6.5 4 4-9.8 9.8a1.6 1.6 0 0 1-2.3 0l-1.7-1.7a1.6 1.6 0 0 1 0-2.3z" fill="#c98a52"/><path d="M11.5 4.5 14 2l6 3.5L21.5 8 19 10.5l-1.5-1.5-2 2-4-4 2-2z" fill="#7d8a96"/>',
  ),
  clock: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  arrow: svg('<path d="M4 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  sparkle: svg('<path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5zM19 15c.3 2 1.3 3 3.3 3.3-2 .3-3 1.3-3.3 3.3-.3-2-1.3-3-3.3-3.3 2-.3 3-1.3 3.3-3.3z" fill="currentColor"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  speed: svg('<path d="M13 2 4.5 13.5H11L10 22l9-12h-6.5z" fill="#ffbf3c" stroke="#d48a12" stroke-width="1.2" stroke-linejoin="round"/>'),
  cargo: svg('<path d="m12 2.8 8.5 4.4v9.6L12 21.2l-8.5-4.4V7.2z" fill="#d9a066" stroke="#9a6638" stroke-width="1.3" stroke-linejoin="round"/><path d="m3.5 7.2 8.5 4.4 8.5-4.4M12 11.6v9.6" stroke="#9a6638" stroke-width="1.3" fill="none"/><path d="m7.8 5 8.4 4.4" stroke="#f3d29a" stroke-width="2"/>'),
  eff: svg(
    '<circle cx="12" cy="12" r="4.2" fill="#9fb3c4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="#6f8496" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#6f8496" stroke-width="2"/><circle cx="12" cy="12" r="1.6" fill="#f3f6f9"/>',
  ),
  land: svg('<path d="M3 7.5 8.5 5l7 2.5L21 5v11.5L15.5 19l-7-2.5L3 19z" fill="#9fd97a" stroke="#4f8f3a" stroke-width="1.3" stroke-linejoin="round"/><path d="M8.5 5v11.5M15.5 7.5V19" stroke="#4f8f3a" stroke-width="1.3"/><circle cx="12" cy="11" r="1.7" fill="#e5574a"/>'),
  maneki: svg(
    '<path d="M6 9.5 6.5 4l3.7 2.8h3.6L17.5 4l.5 5.5c.5.9.8 2 .8 3.1C18.8 17.4 15.7 20 12 20s-6.8-2.6-6.8-7.4c0-1.1.3-2.2.8-3.1z" fill="#fffaf2" stroke="#c9a46a" stroke-width="1.2"/><path d="M17 6.5c1.2-1.8 3-1.6 3.4-.4.4 1.2-.8 2.3-2.2 2.6" fill="#fffaf2" stroke="#c9a46a" stroke-width="1.2"/>' +
      '<circle cx="9.6" cy="11.8" r=".9" fill="#3a2a20"/><circle cx="14.4" cy="11.8" r=".9" fill="#3a2a20"/><circle cx="12" cy="16.6" r="2.4" fill="#f2b632" stroke="#d48a12" stroke-width=".8"/><path d="M8.3 14.3h7.4" stroke="#e5574a" stroke-width="1.4"/>',
  ),
  motiv: svg('<path d="M12 3.5 20 18.5H4z" fill="#fffaf2" stroke="#c9a46a" stroke-width="1.4" stroke-linejoin="round"/><rect x="7.6" y="13.2" width="8.8" height="5.3" rx="1" fill="#3b4a3f"/><circle cx="10.2" cy="9.6" r=".9" fill="#3a2a20"/><circle cx="13.8" cy="9.6" r=".9" fill="#3a2a20"/><path d="M11.2 11.3c.5.4 1.1.4 1.6 0" stroke="#3a2a20" stroke-width=".8" fill="none" stroke-linecap="round"/>'),
  trade: svg('<circle cx="9" cy="14" r="6" fill="#f2b632" stroke="#d48a12" stroke-width="1.3"/><circle cx="15" cy="10" r="6" fill="#ffd257" stroke="#d48a12" stroke-width="1.3"/><path d="M15 7v6M13 8.6h3a1.2 1.2 0 0 1 0 2.4h-2a1.2 1.2 0 0 0 0 2.4h3" stroke="#c47d0e" stroke-width="1.2" fill="none" stroke-linecap="round"/>'),
  island: svg('<path d="M2 16c3-1 5 1 8 0s5-1 8 0 4 1 4 1v3H2z" fill="#6fc6e8"/><path d="M4 15c1.5-4 4-6 8-6s6.5 2 8 6z" fill="#8fd06a" stroke="#4f8f3a" stroke-width="1.2"/><path d="M12 9V5m0 0 3 1.5L12 8" stroke="#8a5a34" stroke-width="1.4" fill="#e5574a" stroke-linejoin="round"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="#ff7fa3" stroke="#e0507a" stroke-width="1.2"/>'),
  shield: svg('<path d="M12 2.5 20 5.5v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" fill="#9fb3c4" stroke="#5a6f82" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 5.2 17.6 7.3v4.3c0 3.6-2.3 6.2-5.6 7.3z" fill="#c9d6e0"/>'),
  dog: svg('<path d="M5 8.5c-1.6-.4-3 1-2.6 2.7.4 1.5 1.6 3.2 2.6 3.6V17c0 2.2 3 4 7 4s7-1.8 7-4v-2.2c1-.4 2.2-2.1 2.6-3.6.4-1.7-1-3.1-2.6-2.7C17.8 6 15.2 4 12 4S6.2 6 5 8.5z" fill="#c08a58" stroke="#7a5236" stroke-width="1.3" stroke-linejoin="round"/><ellipse cx="12" cy="15.8" rx="3.6" ry="2.8" fill="#f3dcb0"/><ellipse cx="12" cy="14.6" rx="1.5" ry="1.1" fill="#2b2522"/><circle cx="9" cy="11.2" r="1.1" fill="#2b2522"/><circle cx="15" cy="11.2" r="1.1" fill="#2b2522"/>'),
  box: svg('<path d="M3.5 8.5 12 4l8.5 4.5v9L12 22l-8.5-4.5z" fill="#d9a066" stroke="#9a6638" stroke-width="1.3" stroke-linejoin="round"/><path d="M3.5 8.5 12 13l8.5-4.5M12 13v9" stroke="#9a6638" stroke-width="1.3" fill="none"/><path d="M7.8 6.2 16.2 10.7v3.3" stroke="#f3d29a" stroke-width="1.8" fill="none"/>'),
  bolt: svg('<path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#ffd34d" stroke="#d48a12" stroke-width="1.3" stroke-linejoin="round"/>'),
  rotate: svg('<path d="M19 12a7 7 0 1 1-2.1-5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M19.5 3.5v5h-5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  robot: svg('<rect x="5" y="8" width="14" height="11" rx="4" fill="#b7c4d0" stroke="#5a6f82" stroke-width="1.3"/><path d="m6 9 1-5 3.5 3.5M18 9l-1-5-3.5 3.5" fill="#b7c4d0" stroke="#5a6f82" stroke-width="1.3" stroke-linejoin="round"/><circle cx="9.3" cy="13" r="1.8" fill="#5fe0ff"/><circle cx="14.7" cy="13" r="1.8" fill="#5fe0ff"/><path d="M10 16.5h4" stroke="#5a6f82" stroke-width="1.3" stroke-linecap="round"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1.4" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.4" fill="currentColor"/>'),
  play: svg('<path d="M7.5 5.2v13.6a1 1 0 0 0 1.5.9l10.6-6.8a1 1 0 0 0 0-1.7L9 4.3a1 1 0 0 0-1.5.9z" fill="currentColor"/>'),
  follow: svg('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
};