import { login } from "@/app/actions";
import { payConfig } from "@/lib/supabase/pay";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const pay = payConfig().enabled;
  return (
    <main className="login-screen">
      <section className="login-copy">
        <div className="brand">
          <span className="mark">F</span>
          <strong>Face Clock</strong>
        </div>
        <h1>Better teams. Stronger kitchens.</h1>
        <p className="muted">Biometric attendance, shift management, and the live floor in one place.</p>
      </section>
      <form className="login-card" action={login}>
        <p className="product">Face Clock</p>
        <h1>Admin sign in</h1>
        <p className="muted">
          {pay
            ? "Managers sign in here to capture faces and run the restaurant. Employees use the camera."
            : "Managers sign in here. Employees use the camera."}
        </p>
        {params.error ? <p className="banner bad">{params.error}</p> : null}
        <label>
          Email or username
          <input name="email" type="email" autoComplete="username" required placeholder="name@restaurant.co.za" defaultValue={pay ? "" : "admin@facelock.local"} />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required placeholder="Password" />
        </label>
        <button type="submit">Admin sign in</button>
        <a href="/">Back to the camera</a>
        {!pay && process.env.NODE_ENV !== "production" ? (
          <p className="muted">Development: admin@facelock.local / dev-admin-pass</p>
        ) : null}
      </form>
    </main>
  );
}
