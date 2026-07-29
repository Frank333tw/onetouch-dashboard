"""前後端共用的加密邏輯。PBKDF2 + AES-GCM。

⚠️ 這裡的參數（PBKDF2_ITERATIONS、SALT_BYTES、IV_BYTES、hash 演算法 SHA-256）
是跨語言的契約——site/decrypt.js 必須用完全相同的參數，否則兩邊導出的金鑰
不一致，解密會失敗。修改這裡的任何數值，務必同步修改 decrypt.js。
"""

import base64
import hashlib
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PBKDF2_ITERATIONS = 210_000
SALT_BYTES = 16
IV_BYTES = 12
KEY_BYTES = 32  # AES-256


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
    """解密 encrypt_json() 產出的結構。僅供 Python 端測試用（正式使用端是瀏覽器）。"""
    salt = base64.b64decode(enc["salt"])
    iv = base64.b64decode(enc["iv"])
    ciphertext = base64.b64decode(enc["ciphertext"])
    key = _derive_key(password, salt)
    plaintext = AESGCM(key).decrypt(iv, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))
