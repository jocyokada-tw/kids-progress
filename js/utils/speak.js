// 發音：使用裝置內建的語音朗讀（免費、離線可用）
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  voice = vs.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Ava|Allison|Google US/i.test(v.name))
    || vs.find((v) => /en[-_]US/i.test(v.lang)) || vs[0] || null;
}
export const canSpeak = () => 'speechSynthesis' in window;
if (canSpeak()) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

/** 唸出英文。slow=true 時放慢速度 */
export function speak(text, slow = false) {
  if (!canSpeak() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (voice) u.voice = voice;
  u.rate = slow ? 0.6 : 0.9;
  speechSynthesis.speak(u);
}
