/** The call desk is a set of panels an agent arranges in two columns. This is the
 * one description of that layout shared by the server (validation, defaults) and
 * the web app (rendering). Pure: no Node imports, so the browser can bundle it. */
export const PANELS = [
  { id: 'voice', label: 'Your voice' },
  { id: 'connect', label: 'Call' },
  { id: 'speak', label: 'Speak' },
  { id: 'phrases', label: 'Canned lines' },
  { id: 'transcript', label: 'Live transcript' },
  { id: 'caller', label: 'Caller' },
  { id: 'notes', label: 'Call notes' },
  { id: 'queue', label: 'Queue', floorOnly: true },
  { id: 'agents', label: 'Agents', floorOnly: true },
];
export const PANEL_IDS = PANELS.map(panel => panel.id);
export const COLUMNS = ['side', 'main', 'hidden'];

export const PRESETS = {
  classic: { side: ['voice', 'connect', 'speak', 'phrases'], main: ['transcript', 'caller', 'notes'], hidden: ['queue', 'agents'] },
  transcript: { side: ['speak', 'voice', 'connect', 'notes'], main: ['transcript'], hidden: ['phrases', 'caller', 'queue', 'agents'] },
  compact: { side: ['connect', 'speak', 'phrases'], main: ['transcript'], hidden: ['voice', 'caller', 'notes', 'queue', 'agents'] },
};
export const DEFAULT_LAYOUT = PRESETS.classic;

const plain = value => value && typeof value === 'object' && !Array.isArray(value);

/** True for anything the store may hold: three optional arrays of short strings. */
export function isLayoutShape(value) {
  return plain(value) && COLUMNS.every(column => value[column] === undefined
    || (Array.isArray(value[column]) && value[column].length <= 32 && value[column].every(id => typeof id === 'string' && id.length <= 32)));
}

/** Every panel exactly once. Unknown ids are dropped, duplicates keep their first
 * column, and a panel the layout does not mention (a panel added after the layout
 * was saved) goes to `hidden`, so an old layout never sprouts a surprise. */
export function normalizeLayout(value) {
  if (!isLayoutShape(value)) return structuredClone(DEFAULT_LAYOUT);
  const seen = new Set();
  const result = { side: [], main: [], hidden: [] };
  for (const column of COLUMNS) {
    for (const id of value[column] || []) {
      if (!PANEL_IDS.includes(id) || seen.has(id)) continue;
      seen.add(id); result[column].push(id);
    }
  }
  for (const id of PANEL_IDS) if (!seen.has(id)) result.hidden.push(id);
  return result;
}

export const sameLayout = (a, b) => COLUMNS.every(column => a[column].join(',') === b[column].join(','));

/** Which preset a layout is, if any; presets are compared without floor-only panels
 * so a desk without a floor still recognises them. */
export function presetOf(layout, { floor = true } = {}) {
  const strip = value => Object.fromEntries(COLUMNS.map(column => [column, value[column].filter(id => floor || !PANELS.find(panel => panel.id === id)?.floorOnly)]));
  const target = strip(layout);
  return Object.keys(PRESETS).find(key => sameLayout(strip(normalizeLayout(PRESETS[key])), target)) || '';
}

/** Move one panel to a column at an index; used by drag-and-drop and the arrow buttons. */
export function movePanel(layout, id, column, index) {
  const next = { side: layout.side.filter(item => item !== id), main: layout.main.filter(item => item !== id), hidden: layout.hidden.filter(item => item !== id) };
  const list = next[column];
  const at = Math.max(0, Math.min(index ?? list.length, list.length));
  list.splice(at, 0, id);
  return next;
}
