const MODEL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

export function faceCapture({ heading, detail, mode, postUrl }) {
  const enroll = mode === "enroll";
  return `<section class="card" id="face-box">
    <h2>${heading}</h2>
    <p>${detail}</p>
    ${enroll ? `<label class="check"><input type="checkbox" id="face-consent"> The employee consents to a facial template being stored for attendance. It can be deleted from this profile. This is separate from any ordinary photograph.</label>` : ""}
    <div style="position:relative;max-width:420px">
      <video id="face-camera" autoplay muted playsinline style="width:100%;border-radius:50%;background:#000;aspect-ratio:1;object-fit:cover"></video>
    </div>
    <p id="face-state">${enroll ? "Consent, then open the camera. The employee blinks once, then follows five angles." : "Open the camera and blink once."}</p>
    <p><button class="button" type="button" id="face-start">${enroll ? "Start face registration" : "Open camera"}</button></p>
  </section>
  <script type="module">
    const state = document.querySelector("#face-state");
    const video = document.querySelector("#face-camera");
    const enroll = ${enroll ? "true" : "false"};
    document.querySelector("#face-start").onclick = async () => {
      if (enroll && !document.querySelector("#face-consent").checked) {
        state.textContent = "Record the employee's consent before the camera opens.";
        return;
      }
      state.textContent = "Loading the face model…";
      const faceapi = await import("https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js");
      await faceapi.nets.tinyFaceDetector.loadFromUri(${JSON.stringify(MODEL)});
      await faceapi.nets.faceLandmark68Net.loadFromUri(${JSON.stringify(MODEL)});
      await faceapi.nets.faceRecognitionNet.loadFromUri(${JSON.stringify(MODEL)});
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      video.srcObject = stream;
      await video.play();
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      let running = true;
      const stop = () => { running = false; stream.getTracks().forEach((track) => track.stop()); };
      const steps = enroll
        ? ["blink", "center", "left", "right", "up", "down"]
        : ["blink"];
      let step = 0;
      let held = 0;
      let baseline = 0;
      let sideSign = 0;
      const samples = [];
      const prompts = {
        blink: "Blink once so we know a person is present.",
        center: "Look straight ahead and hold still.",
        left: "Turn your head to either side and hold.",
        right: "Turn your head to the other side and hold.",
        up: "Tilt your chin up slightly.",
        down: "Tilt your chin down slightly.",
      };
      state.textContent = prompts[steps[0]];
      const watch = async () => {
        if (!running) return;
        const found = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
        if (found && running) {
          const points = found.landmarks.positions;
          const pose = headPose(points);
          const name = steps[step];
          const ready = name === "blink" ? blinked(points) : poseHeld(name, pose, baseline);
          held = ready ? held + 1 : 0;
          if (held >= 2) {
            if (name === "center") baseline = pose.pitch;
            if (name === "left") sideSign = Math.sign(pose.yaw) || 1;
            if (name !== "blink") samples.push({ pose: name, descriptor: Array.from(found.descriptor) });
            step += 1;
            held = 0;
            if (step >= steps.length) {
              stop();
              await submit(name === "blink" && !enroll ? Array.from(found.descriptor) : null, samples);
              return;
            }
            state.textContent = prompts[steps[step]];
          }
        }
        if (running) setTimeout(watch, 280);
      };
      let eyesWereClosed = false;
      function blinked(points) {
        const open = eyeOpen(points, 36) + eyeOpen(points, 42);
        if (open < 0.4) eyesWereClosed = true;
        return eyesWereClosed && open > 0.5;
      }
      watch();
      async function submit(descriptor, captured) {
        state.textContent = enroll ? "Saving the facial template…" : "Checking the face…";
        const extra = window.faceRequest?.() ?? {};
        const body = enroll ? { samples: captured, ...extra } : { descriptor, method: "face", ...extra };
        const response = await fetch(${JSON.stringify(postUrl)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (!response.ok) { state.textContent = payload.error || "The face was not accepted."; return; }
        if (enroll) { state.textContent = "Facial recognition: registered."; return; }
        window.onFaceIdentified?.(payload, descriptor);
      }
    };
    function eyeOpen(points, start) {
      const distance = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
      return (distance(start + 1, start + 5) + distance(start + 2, start + 4)) / (2 * distance(start, start + 3));
    }
    function headPose(points) {
      const average = (items) => items.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
      const left = average(points.slice(36, 42));
      left.x /= 6; left.y /= 6;
      const right = average(points.slice(42, 48));
      right.x /= 6; right.y /= 6;
      const nose = points[30];
      const eyeDistance = Math.hypot(right.x - left.x, right.y - left.y) || 1;
      return { yaw: (nose.x - (left.x + right.x) / 2) / eyeDistance, pitch: (nose.y - (left.y + right.y) / 2) / eyeDistance };
    }
    function poseHeld(name, pose, baseline) {
      if (name === "center") return Math.abs(pose.yaw) < 0.12;
      if (name === "left") return Math.abs(pose.yaw) > 0.18;
      if (name === "right") return sideSign !== 0 && pose.yaw * sideSign < -0.18;
      if (name === "up") return pose.pitch < baseline - 0.08;
      if (name === "down") return pose.pitch > baseline + 0.08;
      return false;
    }
  </script>`;
}
