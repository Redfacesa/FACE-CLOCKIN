import { connect } from "cloudflare:sockets";

const encoder = new TextEncoder();

export async function sendVerificationEmail(env, { to, companyName, link }) {
  const user = env.SMTP_USER || "info@redface.co.za";
  const password = env.SMTP_PASSWORD;
  if (!password) {
    const error = new Error("Email sending is not configured.");
    error.status = 503;
    error.code = "mail_unconfigured";
    throw error;
  }
  const text = [
    `Confirm the email address for ${companyName}.`,
    "",
    "Verification link:",
    link,
    "",
    "Opening the link verifies this email address. It does not activate the workspace.",
    "After verification, activate the workspace on the next screen. Sign-in is available only after both steps.",
    "",
    "Red Face (Pty) Ltd",
  ].join("\r\n");
  await smtpSend({
    user,
    password,
    from: `Red Face Workforce <${user}>`,
    to,
    subject: "Verify your Red Face Workforce email",
    text,
  });
}

async function smtpSend({ user, password, from, to, subject, text }) {
  const socket = connect({ hostname: "smtp.hostinger.com", port: 465 }, { secureTransport: "on" });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function reply() {
    while (!buffer.split("\r\n").some((line) => /^\d{3} /.test(line))) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    const lines = buffer.split("\r\n");
    const end = lines.findIndex((line) => /^\d{3} /.test(line));
    const message = lines.slice(0, end + 1);
    buffer = lines.slice(end + 1).join("\r\n");
    const code = Number(message.at(-1)?.slice(0, 3) || 0);
    if (code >= 400 || !code) throw new Error(`Mail server rejected the message (${code}).`);
    return code;
  }

  async function command(line) {
    if (line != null) await writer.write(encoder.encode(`${line}\r\n`));
    return reply();
  }

  try {
    await command(null);
    await command("EHLO tryclockin.redface.co.za");
    await command("AUTH LOGIN");
    await command(btoa(user));
    await command(btoa(password));
    await command(`MAIL FROM:<${user}>`);
    await command(`RCPT TO:<${to}>`);
    await command("DATA");
    const body = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      text.replace(/^\./gm, ".."),
      ".",
    ].join("\r\n");
    await command(body);
    await command("QUIT");
  } finally {
    try { await writer.close(); } catch { /* socket already closed */ }
    try { await reader.cancel(); } catch { /* socket already closed */ }
  }
}
