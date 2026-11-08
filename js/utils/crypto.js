// PIN 只存 PBKDF2 雜湊值與鹽，不存明碼。
const b64e = (u8) => btoa(String.fromCharCode(...u8));
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPin(pin, saltB64) {
  const salt = saltB64 ? b64d(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return { hash: b64e(new Uint8Array(bits)), salt: b64e(salt) };
}

export const isValidPin = (pin) => /^\d{4,6}$/.test(pin || '');
