// 全域狀態（很小、很單純）：目前裝置、成員、設定、選擇的身分
export const KIDS = ['kidA', 'kidB'];

export const COLORS = {
  orange: '#ff8a3d', pink: '#ff5fa2', rose: '#e8536b', blue: '#3d8bff',
  green: '#2dbb6c', purple: '#8b5cf6', teal: '#14b8a6', yellow: '#f5b301'
};
export const EMOJIS = ['🦊', '🐳', '🐼', '🐯', '🦄', '🐶', '🐱', '🐰', '🐸', '🦁', '🐧', '🐙', '🚀', '⚽', '🌟', '🌈'];

export const state = {
  authReady: false,
  uid: null,
  device: undefined,     // undefined=讀取中, null=尚未配對, object=已配對
  members: {},
  membersReady: false,
  settings: { bonusAllDone: 0, defaultTaskPoints: 1 },
  profile: sessionStorage.getItem('kp.profile') || null
};

const subs = new Set();
export function onState(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setState(patch) {
  Object.assign(state, patch);
  if ('profile' in patch) {
    if (patch.profile) sessionStorage.setItem('kp.profile', patch.profile);
    else sessionStorage.removeItem('kp.profile');
  }
  subs.forEach((fn) => fn(state));
}

export function allowedProfiles() {
  const d = state.device;
  if (!d) return [];
  if (d.isMom) return ['mom', ...KIDS];
  return KIDS.filter((k) => (d.kids || []).includes(k));
}

export const isMom = () => state.profile === 'mom';

const DEFAULT_MEMBER = {
  mom: { name: '媽媽', emoji: '👩', color: 'rose' },
  kidA: { name: '小孩A', emoji: '🦊', color: 'orange' },
  kidB: { name: '小孩B', emoji: '🐳', color: 'blue' }
};
export function member(id) { return { ...DEFAULT_MEMBER[id], ...(state.members[id] || {}) }; }
export const memberName = (id) => member(id).name;
export const memberColor = (id) => COLORS[member(id).color] || COLORS.orange;
