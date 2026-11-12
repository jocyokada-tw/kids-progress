// 全域狀態（很小、很單純）：目前裝置、成員、設定、選擇的身分
export const KIDS = ['kidA', 'kidB'];

export const COLORS = {
  orange: '#ff8a3d', pink: '#ff5fa2', rose: '#e8536b', blue: '#3d8bff',
  green: '#2dbb6c', purple: '#8b5cf6', teal: '#14b8a6', yellow: '#f5b301'
};
// 科目與顏色（媽媽可在設定中修改，存在 meta/settings.subjects）
export const DEFAULT_SUBJECTS = [
  { id: 'chinese', name: '國語', color: '#3d7be0' },
  { id: 'math', name: '數學', color: '#e5484d' },
  { id: 'social', name: '社會', color: '#b08060' },
  { id: 'science', name: '自然', color: '#2f9e44' },
  { id: 'english', name: '英文', color: '#ff9f80' },
  { id: 'jusmile', name: '朱宗慶', color: '#a3d65c' }
];
// 通知預設值（和 functions/core.js 的 DEFAULT_NOTIFY 相同）
export const DEFAULT_NOTIFY = {
  mom: { kidTask: true, itemDone: true, redeem: true, message: true, carry: true, due: true },
  kid: { taskReview: true, itemReview: true, redeem: true, message: true, weekly: true, daily: true, carry: true, due: true },
  quietStart: '22:00', quietEnd: '07:00', dailyTime: '20:00', afterSchoolTime: '16:30'
};
export function notifySettings() {
  const n = state.settings.notify || {};
  return { ...DEFAULT_NOTIFY, ...n, mom: { ...DEFAULT_NOTIFY.mom, ...(n.mom || {}) }, kid: { ...DEFAULT_NOTIFY.kid, ...(n.kid || {}) } };
}

export const OTHER_SUBJECT = { id: '', name: '其他', color: '#9a94a8' };

export const EMOJIS = ['🦊', '🐳', '🐼', '🐯', '🦄', '🐶', '🐱', '🐰', '🐸', '🦁', '🐧', '🐙', '🚀', '⚽', '🌟', '🌈'];

export const state = {
  authReady: false,
  uid: null,
  device: undefined,     // undefined=讀取中, null=尚未配對, object=已配對
  members: {},
  membersReady: false,
  settingsReady: false,
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

export function subjects() {
  const list = state.settings.subjects;
  return Array.isArray(list) ? list : DEFAULT_SUBJECTS;
}
export function subjectOf(id) {
  return (id && subjects().find((s) => s.id === id)) || OTHER_SUBJECT;
}

const DEFAULT_MEMBER = {
  mom: { name: '媽媽', emoji: '👩', color: 'rose' },
  kidA: { name: '小孩A', emoji: '🦊', color: 'orange' },
  kidB: { name: '小孩B', emoji: '🐳', color: 'blue' }
};
export function member(id) { return { ...DEFAULT_MEMBER[id], ...(state.members[id] || {}) }; }
export const memberName = (id) => member(id).name;
export const memberColor = (id) => COLORS[member(id).color] || COLORS.orange;
