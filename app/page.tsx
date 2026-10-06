import { ClockCamera } from "@/components/clock-camera";

export default function Home() {
  return (
    <main className="kiosk">
      <div className="kiosk-card">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            F
          </span>
          <strong>Face Clock</strong>
        </div>
        <h1>Clock in with your face</h1>
        <ClockCamera people={[]} mode="kiosk" />
      </div>
    </main>
  );
}
