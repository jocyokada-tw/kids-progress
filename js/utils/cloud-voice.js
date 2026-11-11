// 雲端語音：自然的英文發音（由 functions/tts.js 合成，存在 Firestore 快取）。
// 流程：先讀快取 → 沒有才請伺服器合成 → 失敗就回傳 false，由呼叫端改用裝置內建語音。
import { app, db, useEmulator, doc, getDoc } from '../firebase.js';
import { FAMILY_ID } from '../../config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
const REGION = 'asia-east1';       // 和 functions/index.js 的 REGION 相同
const TAG = 'v1';                  // 和 functions/tts.js 的 TTS_TAG 相同
const SLOW_RATE = 0.6;
const TIMEOUT = 7000;

const mem = new Map();             // 文字 → Promise<音檔網址 或 null>
const ready = new Map();           // 文字 → 已經準備好的音檔網址（可以立刻播放，不用等）
let downUntil = 0;                 // 伺服器合成失敗後，暫停幾分鐘不再嘗試
let audio = null;
let unlocked = false;
let playSeq = 0;

export const cleanText = (t) => String(t || '').replace(/\s+/g, ' ').trim();

async function idFor(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${TAG}|${text}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function load(text) {
  const id = await idFor(text);
  try {
    const s = await getDoc(doc(db, 'families', FAMILY_ID, 'tts', id));   // 有離線快取，聽過的字離線也能播
    if (s.exists()) return s.data().audio;
  } catch { /* 離線且沒有快取 */ }
  if (useEmulator || !navigator.onLine || Date.now() < downUntil) return null;
  try {
    const { getFunctions, httpsCallable } = await import(SDK);
    const res = await httpsCallable(getFunctions(app, REGION), 'tts')({ fid: FAMILY_ID, text });
    return res.data.audio || null;
  } catch (e) {
    console.warn('cloud voice', e.code || '', e.message);
    downUntil = Date.now() + 5 * 60000;
    return null;
  }
}

function get(text) {
  if (!mem.has(text)) {
    const p = load(text).then((b64) => (b64 ? `data:${b64.startsWith('UklGR') ? 'audio/wav' : 'audio/mpeg'};base64,${b64}` : null));
    mem.set(text, p);
    p.then((v) => { if (v) ready.set(text, v); else mem.delete(text); });
  }
  return mem.get(text);
}

/** 預先準備好一批文字的語音（開始練習時呼叫，之後播放就不用等） */
export function prefetch(texts) {
  [...new Set(texts.map(cleanText).filter(Boolean))].forEach((t) => { get(t); });
}

/** 0.2 秒的無聲音檔（data: 網址；iPhone 的主畫面 App 播放 blob: 網址不穩定） */
let silentUrl = null;
function silentWav() {
  if (silentUrl) return silentUrl;
  const n = 1600;
  const b = new Uint8Array(44 + n).fill(128, 44);
  const v = new DataView(b.buffer);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  silentUrl = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...b));
  return silentUrl;
}

/**
 * iPhone 規定聲音要由使用者的點按啟動。在任何一次點按時呼叫，
 * 之後同一個播放器就可以在程式裡自動播放（例如換下一張單字卡時）。
 */
let unlocking = false;
export function unlockAudio() {
  if (unlocked || unlocking) return;
  audio = audio || new Audio();
  if (!audio.paused) return;               // 正在播放真正的聲音，不要打斷
  unlocking = true;
  try {
    audio.src = silentWav();
    const p = audio.play();
    if (p && p.then) p.then(() => { unlocked = true; }).catch(() => {}).finally(() => { unlocking = false; });
    else { unlocked = true; unlocking = false; }
  } catch { unlocking = false; }
}

function start(url, slow) {
  audio = audio || new Audio();
  audio.pause();
  audio.src = url;
  audio.playbackRate = slow ? SLOW_RATE : 1;
  audio.defaultPlaybackRate = audio.playbackRate;
  return audio.play();
}

/** 播放雲端語音。成功回傳 true；沒有語音可播（離線、未部署…）回傳 false */
export async function playCloud(text, slow = false) {
  const t = cleanText(text);
  if (!t) return false;
  const seq = ++playSeq;
  try {
    // 已經準備好的聲音：在點按的當下立刻播放（iPhone 對「點按後隔一陣子才播」的聲音比較嚴格）
    if (ready.has(t)) { await start(ready.get(t), slow); return true; }
    const url = await withTimeout(get(t), TIMEOUT);
    if (seq !== playSeq) return true;        // 已經有更新的播放要求，這一次不用播
    if (!url) return false;
    await start(url, slow);
    return true;
  } catch (e) {
    console.warn('audio play', e.message);
    return false;
  }
}

export function stopCloud() {
  playSeq++;
  if (audio) { try { audio.pause(); } catch { /* ignore */ } }
}
