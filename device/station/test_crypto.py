"""Cross-check the embedding blob with Node when both runtimes are available."""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import unittest
from pathlib import Path


NODE = shutil.which("node") or str(Path.home() / ".local/node/bin/node")


class CryptoTests(unittest.TestCase):
    def test_node_blob_decrypts_in_python(self) -> None:
        try:
            from station.crypto import decrypt_embedding, load_key
        except Exception as error:  # noqa: BLE001
            self.skipTest(str(error))
        js = r"""
          const crypto = require('crypto');
          const key = Buffer.alloc(32, 9);
          const values = Array.from({ length: 512 }, (_, i) => (i - 100) / 300);
          const plain = Buffer.from(new Float32Array(values).buffer);
          const iv = Buffer.alloc(12, 4);
          const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
          const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
          const tag = cipher.getAuthTag();
          process.stdout.write(JSON.stringify({
            key: key.toString('base64'),
            blob: Buffer.concat([iv, tag, ciphertext]).toString('base64'),
            first: values[0]
          }));
        """
        if not Path(NODE).exists() and not shutil.which("node"):
            self.skipTest("node is not installed")
        completed = subprocess.run([NODE, "-e", js], check=True, capture_output=True, text=True)
        payload = json.loads(completed.stdout)
        decoded = decrypt_embedding(base64.b64decode(payload["blob"]), load_key(payload["key"]))
        self.assertEqual(len(decoded), 512)
        self.assertAlmostEqual(decoded[0], payload["first"], places=5)


if __name__ == "__main__":
    unittest.main()
