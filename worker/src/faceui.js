const MODEL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

export function faceCapture({ heading, detail, mode, postUrl }) {
  return `<section class="card" id="face-box">
    <h2>${heading}</h2>
    <p>${detail}</p>
    <video id="face-camera" autoplay muted playsinline style="width:100%;max-width:420px;border-radius:16px;background:#000"></video>
    <p id="face-state">Camera is ready when you start.</p>
    <p><button class="button" type="button" id="face-start">Open camera</button></p>
  </section>
  <script type="module">
    const state = document.querySelector("#face-state");
    const video = document.querySelector("#face-camera");
    document.querySelector("#face-start").onclick = async () => {
      state.textContent = "Loading the face model…";
      const faceapi = await import("https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js");
      await faceapi.nets.tinyFaceDetector.loadFromUri(${JSON.stringify(MODEL)});
      await faceapi.nets.faceLandmark68Net.loadFromUri(${JSON.stringify(MODEL)});
      await faceapi.nets.faceRecognitionNet.loadFromUri(${JSON.stringify(MODEL)});
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      video.srcObject = stream;
      await video.play();
      state.textContent = "Look at the camera, then blink once.";
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      let blinked = false;
      let closed = false;
      let running = true;
      const stop = () => { running = false; stream.getTracks().forEach((track) => track.stop()); };
      const watch = async () => {
        if (!running) return;
        const found = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
        if (found && running) {
          const points = found.landmarks.positions;
          const ear = eyeOpen(points, 36) + eyeOpen(points, 42);
          if (ear < 0.4) closed = true;
          if (closed && ear > 0.5) blinked = true;
          if (blinked) {
            const descriptor = Array.from(found.descriptor);
            stop();
            state.textContent = "Checking the face…";
            const extra = window.faceRequest?.() ?? {};
            const response = await fetch(${JSON.stringify(postUrl)}, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ descriptor, method: "face", ...extra }),
            });
            const payload = await response.json();
            if (!response.ok) { state.textContent = payload.error || "The face was not accepted."; return; }
            if (${JSON.stringify(mode)} === "enroll") { state.textContent = "Face registered for this employee."; return; }
            window.onFaceIdentified?.(payload, descriptor);
            return;
          }
        }
        if (running) setTimeout(watch, 250);
      };
      watch();
    };
    function eyeOpen(points, start) {
      const distance = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
      return (distance(start + 1, start + 5) + distance(start + 2, start + 4)) / (2 * distance(start, start + 3));
    }
  </script>`;
}
