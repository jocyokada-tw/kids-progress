// 發音：預設使用雲端的自然語音（cloud-voice.js）；沒有網路或尚未設定時，改用裝置內建的語音朗讀。
import { playCloud, stopCloud } from './cloud-voice.js';

// 聲音品質取決於裝置上安裝的語音：iPhone／iPad 預設只有「精簡」語音（比較機械），
// 到「設定 → 輔助使用 → 語音內容 → 聲音 → 英文」下載「優化」或「高品質」語音後會自然很多。
const KEY = 'kp.voice';
const MODE_KEY = 'kp.voiceMode';   // 'cloud'（預設）或 'device'
export const CLOUD = 'cloud';
export const voiceMode = () => (localStorage.getItem(MODE_KEY) === 'device' ? 'device' : CLOUD);
export const setVoiceMode = (m) => localStorage.setItem(MODE_KEY, m === 'device' ? 'device' : CLOUD);
const NORMAL_RATE = 0.95;
const SLOW_RATE = 0.5;

// 系統內建的搞笑／特效語音，不適合學單字
const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley/i;
const GOOD_NAMES = /Ava|Samantha|Allison|Evan|Nathan|Zoe|Joelle|Noelle|Susan|Tom|Google US English/i;

export const canSpeak = () => 'speechSynthesis' in window;
/** 這台裝置能不能發出聲音（雲端語音或內建語音其中之一） */
export const canPlaySound = () => canSpeak() || typeof Audio !== 'undefined';

/** 品質等級：3 高品質、2 優化、1 一般 */
export function voiceQuality(v) {
  if (/premium|高品質/i.test(v.name)) return 3;
  if (/enhanced|優化|加強/i.test(v.name)) return 2;
  return 1;
}
function score(v) {
  let s = voiceQuality(v) * 10;
  if (/en[-_]US/i.test(v.lang)) s += 5;
  if (GOOD_NAMES.test(v.name)) s += 2;
  if (v.localService) s += 1;
  return s;
}

/** 可用的英文語音，品質好的排前面（已排除特效語音） */
export function englishVoices() {
  if (!canSpeak()) return [];
  return speechSynthesis.getVoices()
    .filter((v) => /^en[-_]/i.test(v.lang) && !NOVELTY.test(v.name))
    .sort((a, b) => score(b) - score(a));
}

export function currentVoice() {
  const list = englishVoices();
  const saved = localStorage.getItem(KEY);
  return list.find((v) => v.voiceURI === saved) || list[0] || null;
}
export const setVoice = (uri) => (uri ? localStorage.setItem(KEY, uri) : localStorage.removeItem(KEY));

/** 語音清單可能晚一點才載入（iPhone 常見），載入後通知畫面更新 */
export function onVoicesChanged(cb) {
  if (!canSpeak() || !speechSynthesis.addEventListener) return () => {};
  speechSynthesis.addEventListener('voiceschanged', cb);
  return () => speechSynthesis.removeEventListener('voiceschanged', cb);
}

/**
 * 唸出英文。slow=true 時明顯放慢。
 * which：不給 = 依這台裝置的設定；'cloud' = 強制用雲端語音；其他 = 指定裝置語音（試聽用）
 */
export function speak(text, slow = false, which) {
  if (!text) return;
  const useCloud = which === CLOUD || (!which && voiceMode() === CLOUD);
  if (canSpeak()) speechSynthesis.cancel();
  if (useCloud) {
    playCloud(text, slow).then((ok) => { if (!ok) deviceSpeak(text, slow); });
    return;
  }
  stopCloud();
  deviceSpeak(text, slow, which);
}

export function stopSpeaking() {
  stopCloud();
  if (canSpeak()) speechSynthesis.cancel();
}

function deviceSpeak(text, slow, voiceURI) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = voiceURI ? englishVoices().find((x) => x.voiceURI === voiceURI) : currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  u.rate = slow ? SLOW_RATE : NORMAL_RATE;
  u.pitch = 1;
  speechSynthesis.speak(u);
}
