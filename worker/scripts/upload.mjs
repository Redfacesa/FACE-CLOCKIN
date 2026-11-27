import { readFileSync } from "node:fs";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
  process.exit(1);
}

const files = ["src/index.js", "src/clock.js", "src/crypto.js", "src/db.js", "src/page.js", "src/auth.js", "src/platform.js", "src/manage.js", "src/mail.js", "src/faceui.js", "src/payroll.js", "src/site.js", "vendor/uqr.mjs"];
const secretFile = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
const sessionSecret = secretFile.match(/^SESSION_SECRET=(.*)$/m)?.[1];
const smtpPassword = secretFile.match(/^SMTP_PASSWORD=(.*)$/m)?.[1];
if (!sessionSecret || !smtpPassword) {
  console.error("SESSION_SECRET and SMTP_PASSWORD are required in .dev.vars");
  process.exit(1);
}
const metadata = {
  main_module: "src/index.js",
  compatibility_date: "2026-11-27",
  bindings: [
    { type: "d1", name: "DB", id: "59bf54cc-c7df-4386-8e8c-800ac07c8c73" },
    { type: "r2_bucket", name: "FILES", bucket_name: "tryclockin-files" },
    { type: "secret_text", name: "SESSION_SECRET", text: sessionSecret },
    { type: "secret_text", name: "SMTP_USER", text: "info@redface.co.za" },
    { type: "secret_text", name: "SMTP_PASSWORD", text: smtpPassword },
    { type: "plain_text", name: "PLATFORM_ADMINS", text: "info@redface.co.za" },
  ],
};

const form = new FormData();
form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
for (const name of files) {
  form.append(name, new Blob([readFileSync(new URL(`../${name}`, import.meta.url))], { type: "application/javascript+module" }), name);
}

const uploaded = await request("PUT", `/accounts/${account}/workers/scripts/tryclockin`, form);
const subdomain = await request(
  "POST",
  `/accounts/${account}/workers/scripts/tryclockin/subdomain`,
  JSON.stringify({ enabled: true }),
  { "content-type": "application/json" },
);

console.log(JSON.stringify({
  script: uploaded.result?.id ?? uploaded.success,
  subdomain: subdomain.result ?? subdomain.success,
}, null, 2));

async function request(method, path, body, headers = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...headers },
    body,
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    console.error(JSON.stringify(payload.errors ?? payload, null, 2));
    process.exit(1);
  }
  return payload;
}
