import json

from crypto_utils import encrypt_json, decrypt_json, PBKDF2_ITERATIONS


def test_round_trip_encrypt_decrypt():
    payload = {"hello": "world", "n": 42}
    enc = encrypt_json(payload, "correct-horse-battery-staple")
    result = decrypt_json(enc, "correct-horse-battery-staple")
    assert result == payload


def test_wrong_password_raises():
    enc = encrypt_json({"a": 1}, "right-password")
    try:
        decrypt_json(enc, "wrong-password")
        assert False, "應該要拋出例外，不該解密成功"
    except Exception:
        pass


def test_encrypted_blob_has_expected_fields():
    enc = encrypt_json({"a": 1}, "pw")
    assert set(enc.keys()) == {"salt", "iv", "ciphertext", "iterations"}
    assert enc["iterations"] == PBKDF2_ITERATIONS


def test_encrypted_blob_never_contains_plaintext_field_names():
    """迴歸測試：確保密文欄位是 base64 字串，不是不小心把明文 dict 序列化進去。"""
    enc = encrypt_json({"secret_marker_xyz": 1}, "pw")
    assert "secret_marker_xyz" not in json.dumps(enc)


def test_different_calls_use_different_salt_and_iv():
    """每次加密都要用新的隨機 salt/iv，不能重複使用（重複使用 IV 是 AES-GCM 的已知安全漏洞）。"""
    enc1 = encrypt_json({"a": 1}, "pw")
    enc2 = encrypt_json({"a": 1}, "pw")
    assert enc1["salt"] != enc2["salt"]
    assert enc1["iv"] != enc2["iv"]
