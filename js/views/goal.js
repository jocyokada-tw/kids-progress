import { esc } from '../ui.js';

/** 目標卡片：媽媽設定的目標，顯示還差多少點 */
export function goalHtml(goal, balance) {
  if (!goal || !goal.points) return '';
  const pct = Math.max(0, Math.min(100, (balance / goal.points) * 100));
  const left = goal.points - balance;
  const done = left <= 0;
  return `
    <div class="goal ${done ? 'goal-done' : ''}">
      <div class="goal-head">
        <span class="goal-emoji">${esc(goal.emoji || '🎯')}</span>
        <div class="grow"><div class="muted small">🎯 我的目標</div><div class="goal-title">${esc(goal.title)}</div></div>
      </div>
      <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal.points}" aria-valuenow="${Math.max(0, balance)}"><div class="goal-fill" style="width:${pct}%"></div></div>
      <div class="goal-text">${done ? `🎉 目標達成！（${balance}／${goal.points} 點）` : `${Math.max(0, balance)}／${goal.points} 點，還差 <strong>${left}</strong> 點`}</div>
    </div>`;
}
