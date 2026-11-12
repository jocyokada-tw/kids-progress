// 推播通知：Firestore 資料變動時，發通知給媽媽或小孩的裝置。
// 部署方式請看 docs/PUSH.md。這個檔案只放「觸發條件」，共用邏輯在 core.js。
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ttsHandler } from './tts.js';
import { setGlobalOptions } from 'firebase-functions/v2';
import { db, TZ, notify, kidName, clip, md, runPeriodic } from './core.js';
import { onNoteWritten } from './journal.js';

// ⚠️ 必須和 Firestore 資料庫的位置相同（Firebase 主控台 → Firestore → 資料庫位置）
const REGION = 'asia-east1';
setGlobalOptions({ region: REGION, maxInstances: 2 });

// ---------- 進度 ----------
export const onTaskCreated = onDocumentCreated('families/{fid}/tasks/{id}', async (event) => {
  const { fid, id } = event.params;
  const t = event.data.data();
  if (t.createdBy === 'kid' && t.status === 'pending') {
    await notify(fid, 'mom', 'kidTask', {
      title: `📅 ${await kidName(fid, t.kidId)}安排了新進度`, body: `${md(t.date)} ${t.title}`,
      url: `#/k/${t.kidId}/schedule`, tag: `task-${id}`
    });
  } else if (t.kind === 'weekly') {
    await notify(fid, t.kidId, 'weekly', {
      title: '📦 媽媽新增了本週進度', body: `${t.title}，記得排要做的日期喔！`,
      url: `#/k/${t.kidId}/schedule`, tag: `weekly-${t.kidId}`
    });
  }
});

export const onTaskUpdated = onDocumentUpdated('families/{fid}/tasks/{id}', async (event) => {
  const { fid, id } = event.params;
  const b = event.data.before.data();
  const a = event.data.after.data();
  if ((a.carryCount || 0) !== (b.carryCount || 0)) return;   // 自動順延，另外統一通知
  if (a.kind === 'weekly' && b.date && !a.date && a.status === 'approved') {
    await notify(fid, a.kidId, 'weekly', {
      title: '📦 媽媽退回了本週進度的日期', body: `「${clip(a.title, 30)}」請重新排要做的日期${a.momNote ? `\n💬 ${clip(a.momNote)}` : ''}`,
      url: `#/k/${a.kidId}/schedule`, tag: `task-${id}`
    });
    return;
  }
  if (b.status === a.status) return;
  const note = a.momNote ? `\n💬 ${clip(a.momNote)}` : '';
  if (b.status === 'pending' && a.status === 'approved') {
    await notify(fid, a.kidId, 'taskReview', {
      title: '✅ 媽媽確認了你的進度', body: `${md(a.date)} ${a.title}${a.points ? `（+${a.points} 點）` : ''}${note}`,
      url: `#/k/${a.kidId}/schedule`, tag: `task-${id}`
    });
  } else if (a.status === 'rejected') {
    await notify(fid, a.kidId, 'taskReview', {
      title: '↩ 媽媽退回了進度', body: `${a.title}${note}`, url: `#/k/${a.kidId}/schedule`, tag: `task-${id}`
    });
  }
});

// ---------- 清單項目 ----------
export const onItemUpdated = onDocumentUpdated('families/{fid}/items/{id}', async (event) => {
  const { fid } = event.params;
  const b = event.data.before.data();
  const a = event.data.after.data();
  if (b.review === a.review) return;
  const items = db.collection(`families/${fid}/items`);
  if (a.review === 'pending') {
    // 同一天的「待核可」合併成一則（相同 tag 會取代前一則）
    const n = (await items.where('kidId', '==', a.kidId).where('date', '==', a.date).where('review', '==', 'pending').count().get()).data().count;
    await notify(fid, 'mom', 'itemDone', {
      title: `✅ ${await kidName(fid, a.kidId)}完成了「${clip(a.title, 30)}」`, body: `${md(a.date)} 共有 ${n} 項等你核可`,
      url: `#/k/${a.kidId}/checklist/${a.date}`, tag: `items-${a.kidId}-${a.date}`
    });
  } else if (a.review === 'approved') {
    const n = (await items.where('kidId', '==', a.kidId).where('date', '==', a.date).where('review', '==', 'approved').count().get()).data().count;
    await notify(fid, a.kidId, 'itemReview', {
      title: `⭐ +${a.points || 0} 點！`, body: `「${clip(a.title, 30)}」已入帳（${md(a.date)} 已入帳 ${n} 項）`,
      url: `#/k/${a.kidId}/points`, tag: `approved-${a.kidId}-${a.date}`
    });
  } else if (a.review === 'returned') {
    await notify(fid, a.kidId, 'itemReview', {
      title: `↩ 媽媽退回了「${clip(a.title, 30)}」`, body: a.returnNote ? `💬 ${clip(a.returnNote)}` : '再檢查一次，完成後重新勾選喔',
      url: `#/k/${a.kidId}/checklist/${a.date}`, tag: `returned-${event.params.id}`
    });
  }
});

// ---------- 點數流水帳（全部完成獎勵、手動調整） ----------
export const onLedgerCreated = onDocumentCreated('families/{fid}/ledger/{id}', async (event) => {
  const { fid } = event.params;
  const e = event.data.data();
  if (e.type === 'bonus' && event.params.id.startsWith('wordbonus_')) {
    await notify(fid, e.kidId, 'itemReview', { title: `🎯 單字一次全對！+${e.amount} 點`, body: '今天的單字測驗全部答對，太厲害了！', url: `#/k/${e.kidId}/points`, tag: `wordbonus-${e.kidId}` });
  } else if (e.type === 'bonus') {
    await notify(fid, e.kidId, 'itemReview', { title: `🎉 全部完成！額外獎勵 +${e.amount}`, body: '今天的清單全部完成，太棒了！', url: `#/k/${e.kidId}/points`, tag: `bonus-${e.kidId}` });
  } else if (e.type === 'adjust') {
    await notify(fid, e.kidId, 'itemReview', {
      title: e.amount > 0 ? `⭐ 媽媽幫你加了 ${e.amount} 點` : `媽媽調整了 ${e.amount} 點`, body: clip(e.title),
      url: `#/k/${e.kidId}/points`, tag: `adjust-${event.params.id}`
    });
  }
});

// ---------- 兌換 ----------
export const onRedemptionCreated = onDocumentCreated('families/{fid}/redemptions/{id}', async (event) => {
  const { fid, id } = event.params;
  const r = event.data.data();
  if (r.status !== 'pending') return;
  await notify(fid, 'mom', 'redeem', {
    title: `🎁 ${await kidName(fid, r.kidId)}想兌換「${clip(r.title, 30)}」`, body: `需要 ${r.cost} 點，等你核可`,
    url: `#/k/${r.kidId}/points`, tag: `redeem-${id}`
  });
});

export const onRedemptionUpdated = onDocumentUpdated('families/{fid}/redemptions/{id}', async (event) => {
  const { fid, id } = event.params;
  const b = event.data.before.data();
  const a = event.data.after.data();
  if (b.status === a.status || b.status !== 'pending') return;
  if (a.status === 'approved') {
    await notify(fid, a.kidId, 'redeem', { title: `🎁 兌換成功：${clip(a.title, 30)}`, body: `已扣 ${a.cost} 點，好好享受吧！`, url: `#/k/${a.kidId}/points`, tag: `redeem-${id}` });
  } else if (a.status === 'rejected') {
    await notify(fid, a.kidId, 'redeem', { title: `兌換被退回：${clip(a.title, 30)}`, body: a.momNote ? `💬 ${clip(a.momNote)}` : '點數已經還給你了', url: `#/k/${a.kidId}/points`, tag: `redeem-${id}` });
  }
});

// ---------- 留言 ----------
export const onMessageCreated = onDocumentCreated('families/{fid}/threads/{kidId}/messages/{id}', async (event) => {
  const { fid, kidId } = event.params;
  const m = event.data.data();
  const url = `#/k/${kidId}/messages`;
  if (m.from === 'mom') {
    await notify(fid, kidId, 'message', { title: '💬 媽媽傳了留言', body: clip(m.text, 100), url, tag: `msg-${kidId}` });
  } else {
    await notify(fid, 'mom', 'message', { title: `💬 ${await kidName(fid, kidId)}`, body: clip(m.text, 100), url, tag: `msg-${kidId}` });
  }
});

// ---------- 課後小記：依填寫內容自動入帳、媽媽留言通知 ----------
export const onClassNoteWritten = onDocumentWritten('families/{fid}/classNotes/{id}', async (event) => {
  const { fid, id } = event.params;
  await onNoteWritten(fid, id, event.data.before.exists ? event.data.before.data() : null, event.data.after.exists ? event.data.after.data() : null);
});

// ---------- 雲端語音（每日單字的發音） ----------
export const tts = onCall({ cors: true, memory: '256MiB', timeoutSeconds: 30 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', '需要登入');
  return ttsHandler({ uid: req.auth.uid, fid: req.data && req.data.fid, text: req.data && req.data.text });
});

// ---------- 每 30 分鐘：每日提醒、勿擾時段結束後補發 ----------
export const periodic = onSchedule({ schedule: '0,30 * * * *', timeZone: TZ }, async () => { await runPeriodic(); });
