// 瀏覽器端解密。參數必須跟 scripts/crypto_utils.py 逐字對應：
// PBKDF2-HMAC-SHA256、salt/iv 皆為 base64、AES-GCM 256-bit 金鑰。

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * @param {{salt: string, iv: string, ciphertext: string, iterations: number}} encBlob
 * @param {string} password
 * @returns {Promise<any>} 解密後 parse 好的 JSON；密碼錯誤時 reject
 */
export async function decryptData(encBlob, password) {
  const salt = base64ToBytes(encBlob.salt);
  const iv = base64ToBytes(encBlob.iv);
  const ciphertext = base64ToBytes(encBlob.ciphertext);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: encBlob.iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 密碼錯誤時，AES-GCM 的驗證標籤（authentication tag）比對會失敗，
  // crypto.subtle.decrypt 直接 reject——不會回傳看起來正常但其實是亂碼的結果。
  const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const plaintextStr = new TextDecoder().decode(plaintextBuf);
  return JSON.parse(plaintextStr);
}
