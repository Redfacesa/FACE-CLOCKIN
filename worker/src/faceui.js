const MODEL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

export function faceCapture({ heading, detail, mode, postUrl }) {
  const enroll = mode === "enroll";
  const steps = enroll
    ? [["blink", "Blink"], ["center", "Look forward"], ["left", "Turn left"], ["right", "Turn right"], ["up", "Chin up"], ["down", "Chin down"]]
    : [["blink", "Look forward"]];
  return `<section class="card face-stage" id="face-box" data-tone="idle">
    <p class="eyebrow">${enroll ? "Face registration" : "Biometric clock-in"}</p>
    <h2>${heading}</h2>
    <p class="lead">${detail}</p>
    ${enroll ? `<label class="check"><input type="checkbox" id="face-consent"> The employee consents to a facial template being stored for attendance. It can be deleted from this profile.</label>` : ""}
    <div class="scan-layout">
      <div class="scan-frame" id="scan-frame" data-tone="idle">
        <video id="face-camera" autoplay muted playsinline></video>
        <canvas id="face-wire"></canvas>
        <span class="scan-bar"></span>
        <p class="scan-placeholder">Your face stays visible here</p>
        <p class="live-chip" id="tone-label">Camera off</p>
      </div>
      <div class="scan-copy">
        <p class="progress" id="face-progress">${enroll ? "0 / 5 angles" : "Live match"}</p>
        <ol id="face-steps">${steps.map(([id, label]) => `<li data-step="${id}">${label}</li>`).join("")}</ol>
        <p id="face-state">${enroll ? "Tick consent, then start. You stay on camera the whole time." : "Open the camera and look forward. You stay visible while the landmarks track your face."}</p>
        <p class="face-actions"><button class="face-action" type="button" id="face-start">${enroll ? "Start face registration" : "Open camera"}</button> <button class="face-action quiet" type="button" id="face-capture" hidden>Capture this step</button></p>
      </div>
    </div>
    <style>
      #face-box { --scan:#d7d2cc; --mesh:#f4f1ec; }
      #face-box[data-tone="attention"] { --scan:#ff5a5a; --mesh:#ff5a5a; }
      #face-box[data-tone="aligned"] { --scan:#3ddc84; --mesh:#3ddc84; }
      #face-box[data-tone="captured"] { --scan:#3ddc84; --mesh:#3ddc84; }
      #face-box .lead { max-width: 62ch; color: #b7b1ab; margin: 8px 0 0; }
      #face-box .check { display:flex; gap:12px; align-items:flex-start; margin:18px 0 0; max-width:68ch; }
      #face-box .check input { width:auto; margin-top:3px; }
      #face-box .scan-layout { display:grid; grid-template-columns: minmax(0, 1.35fr) minmax(220px, .75fr); gap: 28px; align-items: center; margin-top: 22px; }
      #face-box .scan-frame { position: relative; width: 100%; aspect-ratio: 4/3; border-radius: 28px; overflow: hidden; background: #141414; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
      #face-box .scan-frame video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; transform:scaleX(-1); background:#141414; z-index:0; }
      #face-box .scan-frame canvas { position:absolute; inset:0; width:100%; height:100%; background:transparent; transform:scaleX(-1); pointer-events:none; z-index:1; }
      #face-box .scan-bar { position:absolute; left:8%; right:8%; height:2px; z-index:2; pointer-events:none; opacity:0; background:linear-gradient(90deg, transparent, var(--scan), transparent); box-shadow:0 0 16px var(--scan); }
      #face-box.live .scan-bar { opacity:1; animation:face-scan 2.4s ease-in-out infinite alternate; }
      #face-box .scan-placeholder { position:absolute; inset:0; z-index:2; display:grid; place-items:center; margin:0; color:#b7b1ab; pointer-events:none; }
      #face-box.live .scan-placeholder { display:none; }
      #face-box .live-chip { position:absolute; left:16px; bottom:16px; z-index:3; margin:0; padding:8px 12px; border-radius:999px; background:rgba(12,12,14,.55); border:1px solid rgba(255,255,255,.16); backdrop-filter:blur(10px); color:var(--mesh); font-size:13px; letter-spacing:.04em; }
      #face-box .scan-frame[data-tone="attention"] { box-shadow: inset 0 0 0 2px #ff5a5a; }
      #face-box .scan-frame[data-tone="aligned"], #face-box .scan-frame[data-tone="captured"] { box-shadow: inset 0 0 0 2px #3ddc84; }
      #face-box .progress { margin:0 0 12px; letter-spacing:.08em; text-transform:uppercase; font-size:13px; color:#b7b1ab; }
      #face-box #face-steps { list-style:none; padding:0; margin:0 0 16px; display:grid; gap:8px; }
      #face-box #face-steps li { padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.1); color:#b7b1ab; }
      #face-box #face-steps li.done { color:#f6f4f2; border-color:rgba(61,220,132,.45); }
      #face-box #face-steps li.now { color:#f6f4f2; border-color:var(--scan); }
      #face-box #face-state { min-height:3.2em; color:#f6f4f2; }
      #face-box .face-action { background:#9f1d2d; color:white; border:0; border-radius:999px; padding:12px 18px; font:inherit; cursor:pointer; }
      #face-box .face-action.quiet { background:transparent; border:1px solid rgba(255,255,255,.16); }
      @keyframes face-scan { from { top:12%; } to { top:82%; } }
      @media (max-width: 800px) { #face-box .scan-layout { grid-template-columns:1fr; gap:18px; } }
    </style>
  </section>
  <script type="module">
    const state = document.querySelector("#face-state");
    const video = document.querySelector("#face-camera");
    const box = document.querySelector("#face-box");
    const frame = document.querySelector("#scan-frame");
    const toneLabel = document.querySelector("#tone-label");
    const progress = document.querySelector("#face-progress");
    const captureButton = document.querySelector("#face-capture");
    const enroll = ${enroll ? "true" : "false"};
    const steps = ${JSON.stringify(steps.map(([id]) => id))};
    const prompts = {
      blink: enroll ? "Blink once, then keep looking at the camera." : "Look straight at the camera and blink once.",
      center: "Look forward and hold still.",
      left: "Turn your head to your left and hold.",
      right: "Turn your head to your right and hold.",
      up: "Lift your chin a little and hold.",
      down: "Lower your chin a little and hold.",
    };
    document.querySelector("#face-start").onclick = async () => {
      if (enroll && !document.querySelector("#face-consent").checked) {
        state.textContent = "Tick the consent box before the camera opens.";
        setTone("attention", "Face positioning");
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
        box.classList.add("live");
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.35 });
        let running = true;
        let step = 0;
        let held = 0;
        let baseline = null;
        let sideSign = 0;
        let openLevel = null;
        let sawBlink = false;
        let latest = null;
        let flashUntil = 0;
        const samples = [];
        const stop = () => { running = false; box.classList.remove("live"); captureButton.hidden = true; stream.getTracks().forEach((track) => track.stop()); };
        captureButton.hidden = false;
        captureButton.onclick = () => { if (latest) take(latest, true); };
        state.textContent = prompts[steps[0]];
        mark();
        const watch = async () => {
          if (!running) return;
          try {
            if (!video.videoWidth) {
              state.textContent = "Waiting for the camera picture…";
              setTone("attention", "Face positioning");
            } else if (Date.now() < flashUntil) {
              drawWire(latest, "#3ddc84");
            } else {
              const faces = await faceapi.detectAllFaces(video, options).withFaceLandmarks().withFaceDescriptors();
              const found = faces.length === 1 ? faces[0] : null;
              latest = found;
              const dim = found ? sceneBrightness() : 0;
              if (faces.length > 1) {
                held = 0;
                drawWire(null);
                setTone("attention", "Face positioning");
                state.textContent = "Only one person should be in front of the camera.";
              } else if (!found) {
                held = 0;
                drawWire(null);
                setTone("attention", "Face positioning");
                state.textContent = "Reposition your face. " + prompts[steps[step]];
              } else if (dim < 42) {
                held = 0;
                drawWire(found, "#ff5a5a");
                setTone("attention", "Face positioning");
                state.textContent = "Improve the lighting, then look at the camera.";
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
                drawWire(found, ready ? "#3ddc84" : "#ff5a5a");
                setTone(ready ? "aligned" : "attention", ready ? "Face aligned" : "Face positioning");
                state.textContent = (ready ? "Hold still. " : "Face detected. ") + prompts[name];
                if (held >= 2) take(found, false);
              }
            }
          } catch (error) {
            state.textContent = error.message || "The camera frame could not be read. It will try again.";
          }
          if (running) setTimeout(watch, 280);
        };
        function take(found, manual) {
          if (!running || Date.now() < flashUntil) return;
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
          flashUntil = Date.now() + 700;
          setTone("captured", "Capture successful");
          state.textContent = "Capture successful.";
          mark();
          if (progress) progress.textContent = enroll ? samples.length + " / 5 angles" : "Live match";
          if (step >= steps.length) {
            captureButton.hidden = true;
            setTimeout(() => submit(enroll ? null : descriptor, samples, stop), 720);
            return;
          }
          setTimeout(() => { if (running && Date.now() >= flashUntil) state.textContent = prompts[steps[step]]; }, 720);
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
            item.classList.toggle("done", index < step);
            item.classList.toggle("now", index === step);
          });
        }
        watch();
        async function submit(descriptor, captured, finish) {
          state.textContent = enroll ? "Saving the facial template…" : "Scanning face…";
          setTone("aligned", enroll ? "Capture successful" : "Face aligned");
          if (!enroll) window.onFaceAttemptStart?.();
          try {
            const extra = window.faceRequest?.() ?? {};
            const body = enroll ? { samples: captured, ...extra } : { descriptor, method: "face", ...extra };
            const response = await fetch(${JSON.stringify(postUrl)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Face not recognised.");
            if (!enroll && !payload?.employee?.firstName) throw new Error("Face not recognised.");
            finish();
            if (enroll) {
              setTone("captured", "Capture successful");
              state.textContent = "Facial recognition: registered.";
              return;
            }
            window.onFaceIdentified?.(payload, descriptor);
          } catch (error) {
            state.textContent = error.message || "Face not recognised.";
            setTone("attention", "Face positioning");
            if (!enroll) window.onFaceRejected?.(state.textContent);
          }
        }
      } catch (error) {
        state.textContent = error.message || "The camera could not start.";
        setTone("attention", "Face positioning");
      }
    };
    function setTone(tone, label) {
      box.dataset.tone = tone;
      frame.dataset.tone = tone;
      if (label) toneLabel.textContent = label;
    }
    function drawWire(found, color) {
      const canvas = document.querySelector("#face-wire");
      if (!canvas || !video.videoWidth) return;
      const bounds = frame.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      if (!found?.landmarks?.positions) return;
      const scale = Math.max(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
      const offsetX = (bounds.width - video.videoWidth * scale) / 2;
      const offsetY = (bounds.height - video.videoHeight * scale) / 2;
      const pointAt = (index) => {
        const point = found.landmarks.positions[index];
        return { x: offsetX + point.x * scale, y: offsetY + point.y * scale };
      };
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 1.6;
      context.shadowColor = color;
      context.shadowBlur = 6;
      const contours = [[0,17],[17,22],[22,27],[27,31],[31,36],[36,42],[42,48],[48,60],[60,68]];
      for (const [from, to] of contours) {
        context.beginPath();
        for (let index = from; index < to; index += 1) {
          const point = pointAt(index);
          if (index === from) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        if (to === 42 || to === 48 || to === 68) context.closePath();
        context.stroke();
      }
      for (let index = 0; index < found.landmarks.positions.length; index += 1) {
        const point = pointAt(index);
        context.beginPath();
        context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
        context.fill();
      }
    }
    function sceneBrightness() {
      const sample = document.createElement("canvas");
      sample.width = 24;
      sample.height = 18;
      const context = sample.getContext("2d", { willReadFrequently: true });
      context.drawImage(video, 0, 0, 24, 18);
      const data = context.getImageData(0, 0, 24, 18).data;
      let total = 0;
      for (let index = 0; index < data.length; index += 4) total += data[index] * 0.3 + data[index + 1] * 0.59 + data[index + 2] * 0.11;
      return total / (data.length / 4);
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
