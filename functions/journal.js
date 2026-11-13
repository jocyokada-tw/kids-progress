// 課後小記：依填寫內容自動入帳（不用媽媽核可）、媽媽留言通知、上課日的溫和提醒。
import { FieldValue } from 'firebase-admin/firestore';
import { db, notify, taipeiNow, inQuiet, deliver, md } from './core.js';
import { journalSettings, levelOf, pointsFor, classDay, weekStartOf, hasClasses, weekendWindow } from './journal-logic.js';

const LEVEL_LABEL = { basic: '基本', advanced: '進階', full: '完整' };

/**
 * 小記寫入後計算點數。只加不扣：升級時補差額，改成較少或休息都不扣。
 * 流水帳 ID 用「累計點數」命名（classNote_{noteId}_{total}），重複觸發也只會入帳一次。
 * 回傳新增的點數（0 表示沒有入帳）
 */
export async function awardNote(fid, noteId, now = taipeiNow()) {
  const fam = db.doc(`families/${fid}`);
  const ref = fam.collection('classNotes').doc(noteId);
  const settings = (await fam.collection('meta').doc('settings').get()).data() || {};
  const cfg = journalSettings(settings);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return 0;
    const n = s.data();
    if (noteId !== `${n.kidId}_${n.date}`) return 0;
    const level = levelOf(n);
    const awarded = Number(n.awarded) || 0;
    const patch = {};
    if ((n.level || null) !== level) patch.level = level;
    // 只在同一週、今天以前的上課日給點數（以伺服器的台灣日期為準）
    const valid = classDay(cfg, n.kidId, n.date) && n.date <= now.date && n.date >= weekStartOf(now.date);
    let add = 0;
    if (valid && level) {
      const onTheDay = n.onTheDay != null ? n.onTheDay : n.date === now.date;
      if (n.onTheDay == null) patch.onTheDay = onTheDay;
      const target = pointsFor(level, onTheDay, cfg);
      if (target > awarded) {
        add = target - awarded;
        const lref = fam.collection('ledger').doc(`classNote_${noteId}_${target}`);
        if (!(await tx.get(lref)).exists) {
          tx.set(lref, {
            kidId: n.kidId, amount: add, type: 'classNote', date: n.date, refId: noteId, createdBy: 'server', createdAt: FieldValue.serverTimestamp(),
            title: `📝 課後小記 ${md(n.date)}（${LEVEL_LABEL[level]}${awarded ? '・升級' : ''}${onTheDay ? '' : '・補寫'}）`
          });
        }
        patch.awarded = target;
      }
    }
    if (Object.keys(patch).length) tx.update(ref, patch);
    return add;
  });
}

/** 寫入觸發：入帳、媽媽留言通知孩子 */
export async function onNoteWritten(fid, noteId, before, after, now = taipeiNow()) {
  if (!after) return;
  const kidFields = ['skipped', 'mood', 'learned', 'interesting', 'question'];
  const changed = !before || kidFields.some((k) => before[k] !== after[k]) || (before.level || null) !== (levelOf(after) || null);
  if (changed) {
    const add = await awardNote(fid, noteId, now);
    if (add > 0) {
      await notify(fid, after.kidId, 'itemReview', {
        title: `📝 課後小記 +${add} 點`, body: '謝謝你記下今天的課 🙂', url: `#/k/${after.kidId}/journal`, tag: `journal-${after.kidId}`
      }, null, now);
    }
  }
  if ((after.momComment || '') && after.momComment !== (before && before.momComment)) {
    await notify(fid, after.kidId, 'journalComment', {
      title: '💬 媽媽回應了你的課後小記', body: after.momComment.slice(0, 100), url: `#/k/${after.kidId}/journal/${after.date}`, tag: `jcomment-${noteId}`
    }, null, now);
  }
}

/** 上課日、提醒時間後還沒寫（也沒選休息）就溫和提醒一次。勿擾時段不發 */
export async function journalReminder(fid, s, now) {
  const fam = db.doc(`families/${fid}`);
  const settings = (await fam.collection('meta').doc('settings').get()).data() || {};
  const cfg = journalSettings(settings);
  if (s.kid.journal === false || now.hm < (cfg.reminderTime || '18:30') || inQuiet(now.hm, s.quietStart, s.quietEnd)) return [];
  const stateRef = fam.collection('meta').doc('pushState');
  const st = (await stateRef.get()).data() || {};
  if (st.lastJournal === now.date) return [];
  await stateRef.set({ lastJournal: now.date }, { merge: true });
  const sent = [];
  for (const kidId of cfg.kids || []) {
    if (!classDay(cfg, kidId, now.date)) continue;
    const n = await fam.collection('classNotes').doc(`${kidId}_${now.date}`).get();
    if (n.exists && (n.data().skipped || levelOf(n.data()))) continue;
    await deliver(fid, kidId, {
      title: '📝 今天的課後小記', body: '上完課了嗎？選個心情、寫一句學到的就好 🙂', url: `#/k/${kidId}/journal`, tag: `journal-remind-${kidId}`
    });
    sent.push(kidId);
  }
  return sent;
}

// ---------- 週末記事錄整理 ----------
/** 週末送出（status=done）而且有寫內容 → 入帳一次（weeklyJournal_{id}）。回傳入帳點數 */
export async function awardWeekly(fid, id, now = taipeiNow()) {
  const fam = db.doc(`families/${fid}`);
  const ref = fam.collection('weeklyJournals').doc(id);
  const cfg = journalSettings((await fam.collection('meta').doc('settings').get()).data() || {});
  const pts = Number(cfg.weeklyPoints) || 0;
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return 0;
    const w = s.data();
    if (w.status !== 'done' || w.awarded || id !== `${w.kidId}_${w.week}` || !(pts > 0)) return 0;
    if (!hasClasses(cfg, w.kidId) || !weekendWindow(w.week, now.date)) return 0;
    if (!Object.values(w.sections || {}).some((x) => x && typeof x.text === 'string' && x.text.trim())) return 0;
    const lref = fam.collection('ledger').doc(`weeklyJournal_${id}`);
    if ((await tx.get(lref)).exists) return 0;
    tx.set(lref, { kidId: w.kidId, amount: pts, type: 'weeklyJournal', date: now.date, refId: id, createdBy: 'server', createdAt: FieldValue.serverTimestamp(),
      title: `📒 記事錄整理 ${md(w.week)} 那週` });
    tx.update(ref, { awarded: pts });
    return pts;
  });
}

export async function onWeeklyWritten(fid, id, before, after, now = taipeiNow()) {
  if (!after || after.status !== 'done' || after.awarded) return;   // 只在送出、還沒入帳時處理（自己寫入 awarded 後不會再觸發入帳）
  const add = await awardWeekly(fid, id, now);
  if (add > 0) {
    await notify(fid, after.kidId, 'itemReview', {
      title: `📒 記事錄整理 +${add} 點`, body: '這週的課都整理好了，辛苦了！', url: `#/k/${after.kidId}/weekly`, tag: `weekly-journal-${after.kidId}`
    }, null, now);
  }
}
