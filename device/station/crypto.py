"""AES-256-GCM blobs matching the Node embedding format: IV, tag, ciphertext."""

from __future__ import annotations

import base64
import hashlib
import os

IV_BYTES = 12
TAG_BYTES = 16
DIMENSIONS = 512


def load_key(raw: str) -> bytes:
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("BIOMETRIC_KEY must be 32 bytes, base64-encoded.")
    return key


def decrypt_embedding(blob: bytes, key: bytes) -> list[float]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import struct

    if len(blob) < IV_BYTES + TAG_BYTES + 4:
        raise ValueError("Encrypted template is truncated.")
    iv = blob[:IV_BYTES]
    tag = blob[IV_BYTES : IV_BYTES + TAG_BYTES]
    ciphertext = blob[IV_BYTES + TAG_BYTES :]
    plain = AESGCM(key).decrypt(iv, ciphertext + tag, None)
    count = len(plain) // 4
    return list(struct.unpack("<" + "f" * count, plain))


def encrypt_embedding(values: list[float], key: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import struct

    if len(values) != DIMENSIONS:
        raise ValueError("Face embedding must be 512 dimensions.")
    plain = struct.pack("<" + "f" * DIMENSIONS, *values)
    iv = os.urandom(IV_BYTES)
    sealed = AESGCM(key).encrypt(iv, plain, None)
    ciphertext, tag = sealed[:-TAG_BYTES], sealed[-TAG_BYTES:]
    return iv + tag + ciphertext


def hash_device_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def cosine(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sum(a * a for a in left) ** 0.5
    right_norm = sum(b * b for b in right) ** 0.5
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)
