// 線画アイコン (24x24 / stroke)。絵文字の代わりに使う。カテゴリには key を保存する (16文字以内)。
const P = {
  // --- UI ---
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="18" r=".8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.3A6 6 0 0 1 21 20"/>',
  share: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  // --- カテゴリ ---
  wallet: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11v3"/><path d="M3.5 7.5V17A2.5 2.5 0 0 0 6 19.5h12.5a1 1 0 0 0 1-1V9.5a1 1 0 0 0-1-1H6a2.5 2.5 0 0 1-2.5-1z"/><circle cx="16" cy="14" r="1.1"/>',
  utensils: '<path d="M6 3v7a2 2 0 0 0 4 0V3M8 3v18M17 3c-2 1.2-3 3.6-3 6.2 0 2 1 3.2 3 3.8v8"/>',
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.2 2.2 0 0 1 0 4.4H17M7.5 3.5v2M11 3.5v2"/>',
  beer: '<path d="M6 5h10v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM16 8h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2M9.5 9v7M12.5 9v7"/>',
  cart: '<circle cx="9" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/><path d="M2.5 3.5h3l2.4 11.2a1 1 0 0 0 1 .8h9a1 1 0 0 0 1-.8L20.5 8H6"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  bus: '<rect x="4" y="3.5" width="16" height="14" rx="3"/><path d="M4 11h16M7.5 17.5V20M16.5 17.5V20"/><circle cx="8" cy="14.2" r=".6"/><circle cx="16" cy="14.2" r=".6"/>',
  car: '<path d="M4 16v-3l1.8-4a2 2 0 0 1 1.8-1.2h8.8A2 2 0 0 1 18.2 9L20 13v3zM4 16v3M20 16v3"/><circle cx="8" cy="13.2" r=".7"/><circle cx="16" cy="13.2" r=".7"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8L8.5 5H6"/>',
  plane: '<path d="M21.5 2.5L10.5 13.5M21.5 2.5l-7 19-4-8.5-8.5-4z"/>',
  home: '<path d="M3.5 11L12 3.5 20.5 11M5.5 9.5V20h13V9.5M10 20v-6h4v6"/>',
  zap: '<path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  wifi: '<path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0"/><circle cx="12" cy="19.5" r=".8"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
  gamepad: '<path d="M7 6.5h10a4 4 0 0 1 4 4v3.5a3 3 0 0 1-5.2 2L14.5 14h-5l-1.3 2A3 3 0 0 1 3 14v-3.5a4 4 0 0 1 4-4zM8 9.5v3M6.5 11h3"/><circle cx="15.5" cy="10.2" r=".7"/><circle cx="17.8" cy="12.2" r=".7"/>',
  film: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M8 4v16M16 4v16M3.5 9h4.5M3.5 15h4.5M16 9h4.5M16 15h4.5"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  shirt: '<path d="M8.5 3.5L3 6.5l2.2 4 2.8-1.2V20.5h8V9.3l2.8 1.2 2.2-4-5.5-3a3.5 3.5 0 0 1-7 0z"/>',
  scissors: '<circle cx="6" cy="6" r="2.8"/><circle cx="6" cy="18" r="2.8"/><path d="M8.2 7.8L20 18M8.2 16.2L20 6"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
  pill: '<path d="M10.5 20.5l10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7zM8.5 8.5l7 7"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5h13v14h-13a2 2 0 0 0-2 2zM4.5 19.5a2 2 0 0 0 2 2h13M9 8h6"/>',
  dumbbell: '<path d="M6.5 7.5v9M17.5 7.5v9M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0"/><circle cx="9.2" cy="9.8" r=".6"/><circle cx="14.8" cy="9.8" r=".6"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-2.5 0-4.5-.8-4.5-2.6S10.5 3 12 8zM12 8c2.5 0 4.5-.8 4.5-2.6S13.5 3 12 8z"/>',
  tag: '<path d="M3.5 12.2V4.5h7.7L20.5 13.8a1.5 1.5 0 0 1 0 2.1l-4.6 4.6a1.5 1.5 0 0 1-2.1 0z"/><circle cx="7.8" cy="8.8" r="1.1"/>',
  banknote: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 12h.01M18 12h.01"/>',
  bank: '<path d="M3.5 9.5L12 4l8.5 5.5M5.5 10v7.5M9.5 10v7.5M14.5 10v7.5M18.5 10v7.5M3.5 20h17"/>',
  briefcase: '<rect x="3.5" y="7" width="17" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 13h17"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/>',
  trending: '<path d="M3.5 17l6-6 4 4 7-7M15 8h5.5v5.5"/>',
  receipt: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9.5 8.5h5M9.5 12.5h5"/>',
};

export const CATEGORY_ICONS = ['utensils', 'coffee', 'beer', 'cart', 'bag', 'bus', 'car', 'bike', 'plane', 'home', 'zap', 'droplet', 'flame', 'wifi', 'phone',
  'gamepad', 'film', 'music', 'shirt', 'scissors', 'heart', 'pill', 'book', 'dumbbell', 'smile', 'gift', 'wallet', 'banknote', 'bank', 'briefcase', 'star', 'trending', 'receipt', 'tag'];

/** key から SVG 要素を作る。未知の key (昔の絵文字など) は文字としてそのまま表示する。 */
export function icon(name, size = 20) {
  const body = P[name];
  if (!body) {
    const s = document.createElement('span');
    s.className = 'glyph';
    s.style.fontSize = `${Math.round(size * 0.9)}px`;
    s.textContent = [...(name || '')][0] || '';
    return s;
  }
  const t = document.createElement('template');
  t.innerHTML = `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  return t.content.firstChild;
}
