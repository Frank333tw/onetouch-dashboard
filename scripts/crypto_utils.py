"""前後端共用的加密邏輯。PBKDF2 + AES-GCM。

⚠️ 跨語言契約 ⚠️
site/decrypt.js（瀏覽器端，使用 Web Crypto API）必須與下列參數逐一對應，
否則兩邊導出的金鑰或解密方式不一致，解密會（悄悄地）失敗：

- 雜湊演算法：PBKDF2-HMAC-**SHA-256**（不是 SHA-512，兩者的建議迭代次數不同，見下）
- PBKDF2_ITERATIONS = 600_000（OWASP 對 PBKDF2-HMAC-SHA256 的建議值；
  若誤用 SHA-512 的建議值 210_000 會弱化對離線暴力破解的防護）
- SALT_BYTES = 16（PBKDF2 的 salt 長度）
- IV_BYTES = 12（AES-GCM 標準建議的 IV／nonce 長度）
- KEY_BYTES = 32（PBKDF2 導出的金鑰長度，對應 AES-**256**-GCM，不是 AES-128/192）
- Wire format：JSON 物件的 `salt`、`iv`、`ciphertext` 三個欄位都是 base64 編碼字串
- `ciphertext` 欄位是「GCM 密文 + 16-byte 認證 tag 附加在尾端」的組合位元組，
  對應 Python `cryptography` 套件 `AESGCM.encrypt()` 的慣例——**不是**分開的
  ciphertext/tag 兩個欄位。這是 AES-GCM 跨函式庫時常見的相容性地雷，
  decrypt.js 用 Web Crypto API 的 `crypto.subtle.decrypt()` 時本來就是吃這種
  「密文+tag 附加」格式，行為一致，但務必確認沒有誤拆欄位。
- AAD（associated data）一律是 `None` / 無

修改上述任何一項數值或格式，務必同步修改 decrypt.js，否則跨語言解密會失敗。
"""

import base64
import hashlib
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# OWASP 建議：PBKDF2-HMAC-SHA256 用 600_000 次迭代（SHA-512 才是 210_000，
# 兩者雜湊函式不同，建議迭代次數不可混用）。
PBKDF2_ITERATIONS = 600_000
SALT_BYTES = 16
IV_BYTES = 12
KEY_BYTES = 32  # AES-256


class DecryptionError(Exception):
    """解密失敗的統一例外型別。

    包裝底層可能拋出的各種例外（密碼錯誤時 cryptography 的 InvalidTag、
    blob 格式錯誤時的 KeyError、base64 損毀時的 binascii.Error……），
    讓呼叫端只需要處理這一種例外，且訊息不會外洩明文或金鑰內容。
    """


def _derive_key(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS, dklen=KEY_BYTES
    )


def encrypt_json(data: dict, password: str) -> dict:
    """加密一個可 JSON 序列化的 dict，回傳可直接寫成 JSON 檔的密文結構。"""
    salt = os.urandom(SALT_BYTES)
    iv = os.urandom(IV_BYTES)
    key = _derive_key(password, salt)
    plaintext = json.dumps(data, ensure_ascii=False).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)
    return {
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        "iterations": PBKDF2_ITERATIONS,
    }


def decrypt_json(enc: dict, password: str) -> dict:
    """解密 encrypt_json() 產出的結構。僅供 Python 端測試用（正式使用端是瀏覽器）。

    密碼錯誤、blob 格式錯誤（缺欄位）、base64 損毀等任何解密失敗情況，
    一律拋出 DecryptionError，不外洩明文或金鑰內容。
    """
    try:
        salt = base64.b64decode(enc["salt"])
        iv = base64.b64decode(enc["iv"])
        ciphertext = base64.b64decode(enc["ciphertext"])
        key = _derive_key(password, salt)
        plaintext = AESGCM(key).decrypt(iv, ciphertext, None)
        return json.loads(plaintext.decode("utf-8"))
    except Exception as exc:
        # 涵蓋：cryptography 的 InvalidTag（密碼錯誤）、KeyError（blob 缺欄位）、
        # binascii.Error／ValueError（base64 損毀）等所有解密失敗情況。
        raise DecryptionError("解密失敗：密碼錯誤或密文格式無效") from exc
