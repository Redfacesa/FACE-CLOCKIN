const MODEL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

export function faceCapture({ heading, detail, mode, postUrl }) {
  const enroll = mode === "enroll";
  const steps = enroll
    ? [["blink", "Blink"], ["center", "Ahead"], ["left", "One side"], ["right", "Other side"], ["up", "Chin up"], ["down", "Chin down"]]
    : [["blink", "Blink"]];
  return `<section class="card" id="face-box">
    <h2>${heading}</h2>
    <p>${detail}</p>
    ${enroll ? `<label class="check"><input type="checkbox" id="face-consent"> The employee consents to a facial template being stored for attendance. It can be deleted from this profile.</label>` : ""}
    <style>
      .scan-frame { position:relative; width:min(100%,420px); }
      .scan-frame video, .scan-frame canvas { width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:18px; background:#000; transform:scaleX(-1); }
      .scan-frame canvas { position:absolute; inset:0; height:100%; pointer-events:none; }
      .scan-bar { position:absolute; left:10%; right:10%; height:2px; background:rgba(245,245,245,.85); box-shadow:0 0 12px rgba(245,245,245,.6); animation:face-scan 1.8s ease-in-out infinite; }
      @keyframes face-scan { from { top:14%; } to { top:80%; } }
    </style>
    <div class="scan-frame">
      <video id="face-camera" autoplay muted playsinline></video>
      <canvas id="face-wire"></canvas>
      <span class="scan-bar"></span>
    </div>
    <ol id="face-steps" style="display:flex;gap:8px;flex-wrap:wrap;list-style:none;padding:0">${steps.map(([id, label]) => `<li data-step="${id}" style="padding:6px 10px;border:1px solid #2c2c2c;border-radius:999px">${label}</li>`).join("")}</ol>
    <p id="face-state">${enroll ? "Tick consent, then start. The highlighted step is the one being captured." : "Start the camera and blink once."}</p>
    <p><button class="button" type="button" id="face-start">${enroll ? "Start face registration" : "Open camera"}</button> <button class="button quiet" type="button" id="face-capture" hidden>Capture this step</button></p>
  </section>
  <script type="module">
    const state = document.querySelector("#face-state");
    const video = document.querySelector("#face-camera");
    const captureButton = document.querySelector("#face-capture");
    const enroll = ${enroll ? "true" : "false"};
    const steps = ${JSON.stringify(steps.map(([id]) => id))};
    const prompts = {
      blink: "Blink once. The camera stays on.",
      center: "Look straight ahead and hold still.",
      left: "Turn your head to either side and hold.",
      right: "Turn back to the other side and hold.",
      up: "Tilt your chin up a little and hold.",
      down: "Tilt your chin down a little and hold.",
    };
    document.querySelector("#face-start").onclick = async () => {
      if (enroll && !document.querySelector("#face-consent").checked) {
        state.textContent = "Tick the consent box before the camera opens.";
        return;
      }
      try {
        state.textContent = "Loading the face model…";
        const faceapi = await import("https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js");
        await faceapi.nets.tinyFaceDetector.loadFromUri(${JSON.stringify(MODEL)});
        await faceapi.nets.faceLandmark68Net.loadFromUri(${JSON.stringify(MODEL)});
        await faceapi.nets.faceRecognitionNet.loadFromUri(${JSON.stringify(MODEL)});
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
        video.srcObject = stream;
        await video.play();
        if (!video.videoWidth) await new Promise((resolve) => video.onloadeddata = resolve);
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.35 });
        let running = true;
        let step = 0;
        let held = 0;
        let baseline = null;
        let sideSign = 0;
        let openLevel = null;
        let sawBlink = false;
        let latest = null;
        const samples = [];
        const stop = () => { running = false; captureButton.hidden = true; stream.getTracks().forEach((track) => track.stop()); };
        captureButton.hidden = false;
        captureButton.onclick = () => { if (latest) take(latest, true); };
        state.textContent = prompts.blink;
        mark();
        const watch = async () => {
          if (!running) return;
          try {
            if (!video.videoWidth) {
              state.textContent = "Waiting for the camera picture…";
            } else {
              const faces = await faceapi.detectAllFaces(video, options).withFaceLandmarks().withFaceDescriptors();
              const found = faces.length === 1 ? faces[0] : null;
              latest = found;
              drawWire(found);
              if (faces.length > 1) {
                held = 0;
                state.textContent = "Only one person should be in front of the camera.";
              } else if (!found) {
                held = 0;
                state.textContent = "Reposition your face. " + prompts[steps[step]];
              } else {
                const points = found.landmarks.positions;
                const pose = headPose(points);
                const ear = (eyeOpen(points, 36) + eyeOpen(points, 42)) / 2;
                if (openLevel == null) openLevel = ear;
                if (ear < openLevel * 0.75) sawBlink = true;
                else openLevel = openLevel * 0.85 + ear * 0.15;
                const name = steps[step];
                const ready = name === "blink" ? sawBlink && ear > openLevel * 0.9 : poseReady(name, pose);
                held = ready ? held + 1 : 0;
                state.textContent = (ready ? "Hold still. " : "Face seen. ") + prompts[name];
                if (held >= 2) take(found, false);
              }
            }
          } catch (error) {
            state.textContent = error.message || "The camera frame could not be read. It will try again.";
          }
          if (running) setTimeout(watch, 300);
        };
        function take(found, manual) {
          if (!running) return;
          const name = steps[step];
          if (name === "blink" && !manual && !sawBlink) return;
          const pose = headPose(found.landmarks.positions);
          if (name === "center") baseline = pose.pitch;
          if (name === "left") sideSign = Math.sign(pose.yaw) || 1;
          if (name !== "blink") samples.push({ pose: name, descriptor: Array.from(found.descriptor) });
          const descriptor = Array.from(found.descriptor);
          step += 1;
          held = 0;
          sawBlink = false;
          mark();
          if (step >= steps.length) {
            captureButton.hidden = true;
            submit(enroll ? null : descriptor, samples, stop);
            return;
          }
          state.textContent = prompts[steps[step]];
        }
        function poseReady(name, pose) {
          if (name === "center") return Math.abs(pose.yaw) < 0.2;
          if (name === "left") return Math.abs(pose.yaw) > 0.14;
          if (name === "right") return sideSign !== 0 && pose.yaw * sideSign < -0.14;
          if (baseline == null) return false;
          if (name === "up") return pose.pitch < baseline - 0.05;
          if (name === "down") return pose.pitch > baseline + 0.05;
          return false;
        }
        function mark() {
          document.querySelectorAll("#face-steps li").forEach((item) => {
            const index = steps.indexOf(item.dataset.step);
            item.style.borderColor = index === step ? "#9f1d2d" : "#2c2c2c";
            item.style.color = index < step ? "#f5f5f5" : "#a3a3a3";
          });
        }
        watch();
        async function submit(descriptor, captured, finish) {
          state.textContent = enroll ? "Saving the facial template…" : "Scanning face…";
          if (!enroll) window.onFaceAttemptStart?.();
          try {
            const extra = window.faceRequest?.() ?? {};
            const body = enroll ? { samples: captured, ...extra } : { descriptor, method: "face", ...extra };
            const response = await fetch(${JSON.stringify(postUrl)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Face not recognised.");
            if (!enroll && !payload?.employee?.firstName) throw new Error("Face not recognised.");
            finish();
            if (enroll) { state.textContent = "Facial recognition: registered."; return; }
            window.onFaceIdentified?.(payload, descriptor);
          } catch (error) {
            state.textContent = error.message || "Face not recognised.";
            if (!enroll) window.onFaceRejected?.(state.textContent);
          }
        }
      } catch (error) {
        state.textContent = error.message || "The camera could not start.";
      }
    };
    function drawWire(found) {
      const canvas = document.querySelector("#face-wire");
      if (!canvas || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!found?.landmarks?.positions) return;
      context.strokeStyle = "rgba(245,245,245,0.9)";
      context.fillStyle = "rgba(245,245,245,0.95)";
      context.lineWidth = 2;
      const contours = [[0,17],[17,22],[22,27],[27,31],[31,36],[36,42],[42,48],[48,60],[60,68]];
      for (const [from, to] of contours) {
        context.beginPath();
        const ring = to === 42 || to === 48 || to === 68;
        for (let index = from; index < to; index += 1) {
          const point = found.landmarks.positions[index];
          if (index === from) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        if (ring) context.closePath();
        context.stroke();
      }
      for (const point of found.landmarks.positions) {
        context.beginPath();
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
    function eyeOpen(points, start) {
      const distance = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
      const width = distance(start, start + 3) || 1;
      return (distance(start + 1, start + 5) + distance(start + 2, start + 4)) / (2 * width);
    }
    function headPose(points) {
      const mean = (items) => {
        const total = items.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        return { x: total.x / items.length, y: total.y / items.length };
      };
      const left = mean(points.slice(36, 42));
      const right = mean(points.slice(42, 48));
      const nose = points[30];
      const eyeDistance = Math.hypot(right.x - left.x, right.y - left.y) || 1;
      return { yaw: (nose.x - (left.x + right.x) / 2) / eyeDistance, pitch: (nose.y - (left.y + right.y) / 2) / eyeDistance };
    }
  </script>`;
}
