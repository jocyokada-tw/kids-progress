// 雲端語音：把英文單字／例句轉成自然的語音（Google Cloud Text-to-Speech），並存在 Firestore 快取。
// 每段文字只會合成一次，之後所有裝置都直接讀快取。
import { createHash } from 'node:crypto';
import { applicationDefault } from 'firebase-admin/app';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, taipeiNow } from './core.js';

// 換聲音時把 TAG 改掉（例如 v2），舊的快取就不會再被使用。網頁端 js/utils/cloud-voice.js 的 TAG 要一起改。
export const TTS_TAG = 'v1';
// 依序嘗試：自然的美式女聲 → 系統預設美式語音
const VOICES = [{ languageCode: 'en-US', name: 'en-US-Neural2-F' }, { languageCode: 'en-US', ssmlGender: 'FEMALE' }];
const MAX_LEN = 160;
// 每天最多合成的字元數（防止異常用量；一份 500 字的字庫含例句約 2 萬字元，只會合成一次）
export const DAILY_CAP = 80000;

export const cleanText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
export const ttsId = (text) => createHash('sha256').update(`${TTS_TAG}|${text}`).digest('hex').slice(0, 40);

async function googleSynth(text) {
  const { access_token: token } = await applicationDefault().getAccessToken();
  let lastErr = '';
  for (const voice of VOICES) {
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 } })
    });
    if (res.ok) return (await res.json()).audioContent;
    lastErr = `${res.status} ${(await res.text()).slice(0, 300)}`;
  }
  throw new Error(`Text-to-Speech failed: ${lastErr}`);
}

/** 回傳 { audio: base64 MP3, cached } */
export async function ttsHandler({ uid, fid, text }, synth = googleSynth) {
  if (!uid) throw new HttpsError('unauthenticated', '需要登入');
  if (typeof fid !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(fid)) throw new HttpsError('invalid-argument', 'fid');
  const t = cleanText(text);
  // 只接受英文與常見標點，避免被拿去合成其他內容
  if (!t || t.length > MAX_LEN || !/^[A-Za-z0-9 .,!?'’"\-:;()/&…]+$/.test(t) || !/[A-Za-z]/.test(t)) {
    throw new HttpsError('invalid-argument', '文字格式不符');
  }
  const fam = db.doc(`families/${fid}`);
  if (!(await fam.collection('devices').doc(uid).get()).exists) throw new HttpsError('permission-denied', '裝置尚未配對');

  const ref = fam.collection('tts').doc(ttsId(t));
  const hit = await ref.get();
  if (hit.exists) return { audio: hit.data().audio, cached: true };

  // 每日用量上限
  const today = taipeiNow().date;
  const usageRef = fam.collection('meta').doc('ttsUsage');
  const usage = (await usageRef.get()).data() || {};
  const used = usage.date === today ? usage.chars || 0 : 0;
  if (used + t.length > DAILY_CAP) throw new HttpsError('resource-exhausted', '今天的語音合成量已達上限');
  await usageRef.set({ date: today, chars: used + t.length });

  const audio = await synth(t);
  await ref.set({ text: t, audio, createdAt: FieldValue.serverTimestamp() });
  return { audio, cached: false };
}
