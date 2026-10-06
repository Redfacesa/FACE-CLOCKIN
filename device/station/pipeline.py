"""InsightFace detection plus a separate anti-spoof model. No frames are stored."""

from __future__ import annotations

import os


class FacePipeline:
    def __init__(self, antispoof_path: str) -> None:
        self.ready = False
        self.reason = "Facial verification is not ready."
        self.antispoof = None
        self.app = None
        self.camera = None
        self.cv2 = None
        self.model_path = antispoof_path
        try:
            from insightface.app import FaceAnalysis
            import cv2

            self.cv2 = cv2
            self.app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            self.app.prepare(ctx_id=-1, det_size=(640, 640))
            self.camera = cv2.VideoCapture(int(os.environ.get("STATION_CAMERA", "0")))
        except Exception as error:  # noqa: BLE001
            self.reason = (
                "Install insightface, onnxruntime and opencv-python, then download the buffalo_l model. "
                f"Detail: {error}"
            )
            return
        if not os.path.exists(antispoof_path):
            self.reason = (
                f"Anti-spoof model missing at {antispoof_path}. "
                "Facial clock-in stays off until a passive liveness ONNX model is installed. PIN still works."
            )
            return
        try:
            import onnxruntime as ort

            self.antispoof = ort.InferenceSession(antispoof_path, providers=["CPUExecutionProvider"])
        except Exception as error:  # noqa: BLE001
            self.reason = f"Anti-spoof model could not be loaded: {error}"
            return
        self.ready = True
        self.reason = "Camera ready."

    def capture(self):
        if self.camera is None:
            raise RuntimeError(self.reason)
        ok, frame = self.camera.read()
        if not ok:
            raise RuntimeError("Camera frame was not available.")
        return frame

    def verify_pair(self, first, second) -> dict:
        if self.app is None or self.cv2 is None:
            return {"ok": False, "message": self.reason}
        faces_first = self.app.get(first)
        faces_second = self.app.get(second)
        if len(faces_first) != 1 or len(faces_second) != 1:
            return {"ok": False, "message": "Exactly one face must be in the frame."}
        if not _moved(faces_first[0].bbox, faces_second[0].bbox):
            return {"ok": False, "message": "Liveness check failed. Move slightly closer and try again."}
        score = self._antispoof(second, faces_second[0].bbox)
        if score < 0.8:
            return {"ok": False, "message": "This looks like a photo or a screen, not a live face."}
        embedding = [float(value) for value in faces_second[0].normed_embedding]
        if len(embedding) != 512:
            return {"ok": False, "message": "The face model returned an unexpected embedding."}
        quality = float(getattr(faces_second[0], "det_score", 0))
        if quality < 0.7:
            return {"ok": False, "message": "Move into better light and look straight at the camera."}
        return {"ok": True, "embedding": embedding, "quality": min(1.0, quality), "antispoof": score}

    def _antispoof(self, frame, box) -> float:
        if self.antispoof is None or self.cv2 is None:
            return 0.0
        x1, y1, x2, y2 = [int(value) for value in box]
        crop = frame[max(0, y1) : max(0, y2), max(0, x1) : max(0, x2)]
        if crop.size == 0:
            return 0.0
        resized = self.cv2.resize(crop, (80, 80))
        rgb = self.cv2.cvtColor(resized, self.cv2.COLOR_BGR2RGB).astype("float32") / 255.0
        tensor = rgb.transpose(2, 0, 1)[None, ...]
        output = self.antispoof.run(None, {self.antispoof.get_inputs()[0].name: tensor})[0].reshape(-1)
        if len(output) == 1:
            return float(output[0])
        weights = [max(float(value), 0.0) for value in output]
        total = sum(weights) or 1.0
        return weights[-1] / total


def _moved(box1, box2) -> bool:
    def area(box) -> float:
        return max(1.0, float(box[2] - box[0]) * float(box[3] - box[1]))

    change = abs(area(box1) - area(box2)) / area(box1)
    shift = ((float(box1[0] - box2[0]) ** 2) + (float(box1[1] - box2[1]) ** 2)) ** 0.5
    return change > 0.03 or shift > 8
