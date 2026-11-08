// 以 hash 做路由，GitHub Pages 不需要任何伺服器設定。
// #/                       選擇身分
// #/k/kidA/home            儀表板
// #/k/kidA/checklist[/日期] 每日清單
// #/k/kidA/schedule        進度排程
// #/k/kidA/points          點數紀錄
// #/settings               媽媽設定
export function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'k' && parts[1]) {
    return { name: parts[2] || 'home', kid: parts[1], arg: parts[3] || null };
  }
  if (parts[0] === 'settings') return { name: 'settings' };
  return { name: 'roles' };
}

export function go(path) {
  const target = '#' + path;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}
