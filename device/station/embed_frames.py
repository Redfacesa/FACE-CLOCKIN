"""Turn two camera frames into one face embedding. Frames are not kept."""

from __future__ import annotations

import json
import os
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "message": "Two camera frames are required."}))
        return 0
    try:
        import cv2
        from insightface.app import FaceAnalysis
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "message": f"Face library is not installed yet. {error}"}))
        return 0

    first = cv2.imread(sys.argv[1])
    second = cv2.imread(sys.argv[2])
    if first is None or second is None:
        print(json.dumps({"ok": False, "message": "The camera frames could not be read."}))
        return 0

    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=-1, det_size=(640, 640))
        faces_first = app.get(first)
        faces_second = app.get(second)
    except Exception as error:  # noqa: BLE001
        sys.stdout = real_stdout
        print(json.dumps({"ok": False, "message": f"The face model failed. {error}"}))
        return 0
    finally:
        sys.stdout = real_stdout
    if len(faces_first) != 1 or len(faces_second) != 1:
        print(json.dumps({"ok": False, "message": "Exactly one face must be in the frame."}))
        return 0
    if not _moved(faces_first[0].bbox, faces_second[0].bbox):
        print(json.dumps({"ok": False, "message": "Move slightly closer to the camera, then try again."}))
        return 0

    antispoof = _antispoof(second, faces_second[0].bbox)
    if antispoof is not None and antispoof < 0.8:
        print(json.dumps({"ok": False, "message": "This looks like a photo or a screen, not a live face."}))
        return 0

    embedding = [float(value) for value in faces_second[0].normed_embedding]
    if len(embedding) != 512:
        print(json.dumps({"ok": False, "message": "The face model returned an unexpected result."}))
        return 0
    quality = float(getattr(faces_second[0], "det_score", 0))
    if quality < 0.7:
        print(json.dumps({"ok": False, "message": "Move into better light and look straight at the camera."}))
        return 0
    print(
        json.dumps(
            {
                "ok": True,
                "embedding": embedding,
                "quality": min(1.0, quality),
                "antispoof": antispoof,
                "model": "insightface-buffalo_l",
            }
        )
    )
    return 0


def _moved(box1, box2) -> bool:
    def area(box) -> float:
        return max(1.0, float(box[2] - box[0]) * float(box[3] - box[1]))

    change = abs(area(box1) - area(box2)) / area(box1)
    shift = ((float(box1[0] - box2[0]) ** 2) + (float(box1[1] - box2[1]) ** 2)) ** 0.5
    return change > 0.02 or shift > 6


def _antispoof(frame, box):
    path = os.environ.get("ANTISPOOF_MODEL", "")
    if not path or not os.path.exists(path):
        return None
    try:
        import cv2
        import onnxruntime as ort
    except Exception:
        return None
    x1, y1, x2, y2 = [int(value) for value in box]
    crop = frame[max(0, y1) : max(0, y2), max(0, x1) : max(0, x2)]
    if crop.size == 0:
        return 0.0
    resized = cv2.resize(crop, (80, 80))
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype("float32") / 255.0
    tensor = rgb.transpose(2, 0, 1)[None, ...]
    session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0].reshape(-1)
    if len(output) == 1:
        return float(output[0])
    weights = [max(float(value), 0.0) for value in output]
    total = sum(weights) or 1.0
    return weights[-1] / total


if __name__ == "__main__":
    raise SystemExit(main())
