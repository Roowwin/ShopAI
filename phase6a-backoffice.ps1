#Requires -Version 5.1
<# RFO Phase 6a: backoffice skeleton/login/TOTP, compose+nginx wiring, admin rotation script.
   Run from project root. #>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-TextFile {
    param([string]$Rel, [string]$Content)
    $full = Join-Path $ProjectRoot $Rel
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host "  create  $Rel" -ForegroundColor Green
}

Write-TextFile 'apps/backoffice/package.json' @'
{
  "name": "rfo-backoffice",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^3.4.13",
    "postcss": "^8.4.47",
    "autoprefixer": "^10.4.20"
  }
}
'@

Write-TextFile 'apps/backoffice/tsconfig.json' @'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
'@

Write-TextFile 'apps/backoffice/next.config.mjs' @'
const nextConfig = {};
export default nextConfig;
'@

Write-TextFile 'apps/backoffice/tailwind.config.ts' @'
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: []
};
export default config;
'@

Write-TextFile 'apps/backoffice/postcss.config.mjs' @'
const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };
export default config;
'@

Write-TextFile 'apps/backoffice/app/globals.css' @'
@tailwind base;
@tailwind components;
@tailwind utilities;
'@

Write-TextFile 'apps/backoffice/app/layout.tsx' @'
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "RFO Backoffice", description: "RFO staff portal" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="bg-slate-100 min-h-screen text-slate-900 antialiased">{children}</body>
    </html>
  );
}
'@

Write-TextFile 'apps/backoffice/lib/api.ts' @'
export const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.rfo.localhost";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const access = typeof window !== "undefined" ? sessionStorage.getItem("rfo_access") : null;
  const headers = new Headers(init?.headers ?? {});
  if (access) headers.set("Authorization", "Bearer " + access);
  let r = await fetch(API + path, { ...init, headers, credentials: "include", cache: "no-store" });
  if (r.status === 401 && access) {
    const rr = await fetch(API + "/staff/auth/refresh", { method: "POST", credentials: "include", cache: "no-store" });
    if (rr.ok) {
      const j: any = await rr.json();
      sessionStorage.setItem("rfo_access", j.access_token);
      headers.set("Authorization", "Bearer " + j.access_token);
      r = await fetch(API + path, { ...init, headers, credentials: "include", cache: "no-store" });
    }
  }
  return r;
}

export async function logout() {
  await fetch(API + "/staff/auth/logout", { method: "POST", credentials: "include", cache: "no-store" });
  sessionStorage.removeItem("rfo_access");
}
'@

Write-TextFile 'apps/backoffice/app/page.tsx' @'
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErr("");
    const r = await apiFetch("/staff/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail ?? "login failed"); setBusy(false); return; }
    if (j.requires_mfa) { setChallenge(j.challenge); setBusy(false); return; }
    sessionStorage.setItem("rfo_access", j.access_token);
    router.push("/admin");
  }

  async function submitMfa() {
    setBusy(true); setErr("");
    const r = await apiFetch("/staff/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + challenge },
      body: JSON.stringify({ code }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail ?? "code failed"); setBusy(false); return; }
    sessionStorage.setItem("rfo_access", j.access_token);
    router.push("/admin");
  }

  return (
    <main className="flex items-center justify-center min-h-screen">
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">RFO Backoffice</h1>
        <p className="text-sm text-slate-500 mb-6">Staff sign-in</p>
        {!challenge ? (
          <div className="space-y-3">
            <input className="w-full border rounded px-3 py-2" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="w-full border rounded px-3 py-2" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50" onClick={submit} disabled={busy}>
              Sign in
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Enter the 6-digit code from your authenticator:</p>
            <input className="w-full border rounded px-3 py-2 tracking-widest" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50" onClick={submitMfa} disabled={busy}>
              Verify
            </button>
          </div>
        )}
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
      </div>
    </main>
  );
}
'@

Write-TextFile 'apps/backoffice/app/admin/page.tsx' @'
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, logout } from "@/lib/api";

type Me = { email: string; role: string };

export default function AdminHome() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiFetch("/staff/me").then(async (r) => {
      if (!r.ok) { router.replace("/"); return; }
      setMe(await r.json());
    });
  }, [router]);

  return (
    <main className="max-w-3xl mx-auto pt-10 px-4">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold">RFO Backoffice</h1>
        <button className="text-sm border rounded px-3 py-1.5" onClick={async () => { await logout(); router.replace("/"); }}>
          Sign out
        </button>
      </header>
      <div className="bg-white rounded-xl shadow p-6">
        {me ? (
          <div>
            <p className="text-sm text-slate-500">Signed in as</p>
            <p className="text-lg font-medium">{me.email} <span className="ml-2 text-xs bg-slate-200 rounded px-2 py-0.5">{me.role}</span></p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <a className="border rounded-lg p-4 hover:bg-slate-50" href="/admin/security">Security / TOTP setup</a>
              <a className="border rounded-lg p-4 hover:bg-slate-50" href="/admin/intake">Intake (Phase 6b)</a>
            </div>
          </div>
        ) : (
          <p className="text-slate-500">Loading...</p>
        )}
      </div>
    </main>
  );
}
'@

Write-TextFile 'apps/backoffice/app/admin/security/page.tsx' @'
"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

export default function SecurityPage() {
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setup() {
    setBusy(true); setMsg("");
    const r = await apiFetch("/staff/auth/mfa/setup", { method: "POST" });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.detail ?? "setup failed"); setBusy(false); return; }
    setSecret(j.secret); setUri(j.uri); setBusy(false);
  }

  async function enable() {
    setBusy(true); setMsg("");
    const r = await apiFetch("/staff/auth/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) { const j: any = await r.json().catch(() => ({})); setMsg(j.detail ?? "enable failed"); setBusy(false); return; }
    setEnabled(true); setMsg("TOTP enabled - next login will ask for a code."); setBusy(false);
  }

  return (
    <main className="max-w-2xl mx-auto pt-10 px-4">
      <h1 className="text-xl font-semibold mb-4">Security / TOTP</h1>
      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        {!enabled && !secret && (
          <button className="bg-slate-900 text-white rounded px-4 py-2 disabled:opacity-50" onClick={setup} disabled={busy}>
            Generate TOTP secret
          </button>
        )}
        {secret && !enabled && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Add this to your authenticator app (manual entry):</p>
            <code className="block bg-slate-100 rounded p-3 break-all">{secret}</code>
            <p className="text-xs text-slate-500 break-all">{uri}</p>
            <input className="border rounded px-3 py-2 tracking-widest" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="bg-slate-900 text-white rounded px-4 py-2 disabled:opacity-50" onClick={enable} disabled={busy}>
              Enable TOTP
            </button>
          </div>
        )}
        {enabled && <p className="text-green-700">TOTP is enabled for this account.</p>}
        {msg && <p className="text-sm text-slate-600">{msg}</p>}
      </div>
    </main>
  );
}
'@

# rotate.py: replace the chat-exposed admin password (fresh random, printed once)
Write-TextFile 'scripts/rotate-admin.py' @'
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


async def main():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_type = 'staff' AND identity_id = (SELECT id FROM staff_users WHERE email = 'admin@rfo.local')"))
        await c.execute(text("DELETE FROM staff_users WHERE email = 'admin@rfo.local'"))
    await eng.dispose()
    print("Admin password rotated.")
    await bootstrap("admin@rfo.local", "admin")


import asyncio
asyncio.run(main())
'@

# compose: named volume + backoffice service
$ccp = Join-Path $ProjectRoot 'docker-compose.yml'
$raw = [IO.File]::ReadAllText($ccp)
if ($raw -notmatch 'backoffice_modules') {
    $raw = $raw.Replace('  redisdata: {}', "  redisdata: {}`n  backoffice_modules: {}")
    $block = @'
  backoffice:
    image: public.ecr.aws/docker/library/node:20-alpine
    restart: unless-stopped
    working_dir: /app
    command: ["sh", "-c", "npm install --no-audit --no-fund && npm run dev"]
    volumes:
      - ./apps/backoffice:/app
      - backoffice_modules:/app/node_modules
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-https://api.rfo.localhost}
    networks: [edge]
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://127.0.0.1:3000/ || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 20
      start_period: 300s
    <<: *logging
'@
    [IO.File]::WriteAllText($ccp, ($raw.TrimEnd() + "`n`n" + $block), $Utf8NoBom)
    Write-Host '  patched  docker-compose.yml (backoffice service)' -ForegroundColor Green
} else { Write-Host '  skip    backoffice present' -ForegroundColor DarkGray }

# nginx template: admin proxies to Next.js, with HMR websocket headers
Write-TextFile 'infra/nginx/templates/rfo.conf.template' @'
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      '';
}

gzip on;
gzip_comp_level 5;
gzip_types text/plain text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;

limit_req_zone  $binary_remote_addr zone=store:10m  rate=${RATE_LIMIT_STORE_RPS}r/s;
limit_req_zone  $binary_remote_addr zone=staff:10m  rate=${RATE_LIMIT_STAFF_RPS}r/s;
limit_req_zone  $binary_remote_addr zone=login:10m  rate=${RATE_LIMIT_LOGIN_RPM}r/m;
limit_conn_zone $binary_remote_addr zone=perip:10m;

log_format json_main escape=json '{"ts":"$time_iso8601","req_id":"$request_id","remote":"$remote_addr","method":"$request_method","uri":"$request_uri","status":$status,"bytes":$body_bytes_sent,"rt":$request_time,"u_rt":"$upstream_response_time"}';
access_log /var/log/nginx/access.log json_main;
error_log  /var/log/nginx/error.log warn;

upstream rfo-api { server api:8000; keepalive 32; }
upstream rfo-minio { server storage:5000; keepalive 16; }
upstream rfo-backoffice { server backoffice:3000; keepalive 16; }

server {
  listen 80 default_server;
  server_name _;
  location = /healthz { access_log off; return 200 "ok\n"; }
  location / { return 503 "RFO edge up - route not wired\n"; }
}

server {
  listen 80;
  server_name ${DOMAIN_STORE} ${DOMAIN_ADMIN} ${DOMAIN_API};
  location = /healthz { access_log off; return 200 "ok\n"; }
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_API};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  client_max_body_size 25m;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Request-ID $request_id;
  proxy_set_header Connection "";

  location ~ ^/staff/auth/login$ { limit_req zone=login burst=5 nodelay; proxy_pass http://rfo-api; }
  location ~ ^/store/auth/login$ { limit_req zone=login burst=5 nodelay; proxy_pass http://rfo-api; }
  location ~ ^/staff/ { limit_req zone=staff burst=20 nodelay; proxy_pass http://rfo-api; }
  location ~ ^/store/ { limit_req zone=store burst=40 nodelay; proxy_pass http://rfo-api; }
  location / { proxy_pass http://rfo-api; }
}

server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_STORE};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  location /media/ {
    proxy_pass http://rfo-minio/rfo-media/;
    proxy_set_header Connection "";
    expires 365d;
    add_header Cache-Control "public, immutable" always;
  }
  location / { return 503 "Storefront not wired yet (Phase 7)\n"; }
}

server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_ADMIN};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;

  location / {
    proxy_pass http://rfo-backoffice;
  }
}
'@

Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'compose invalid' }
    Write-Host '  ok      compose valid' -ForegroundColor Green
} finally { Pop-Location }

$st = Join-Path $ProjectRoot 'docs\state.md'
$s2 = [IO.File]::ReadAllText($st)
if ($s2 -notmatch 'Phase 6a ') {
    $s2 = $s2.TrimEnd() + "`nPhase 6a delivered: backoffice Next.js (login+TOTP step, /admin dashboard, /admin/security enrollment, lib/api client w/ refresh), compose backoffice service (node_modules volume), nginx admin proxy w/ HMR headers, scripts/rotate-admin.py.`n"
    [IO.File]::WriteAllText($st, ($s2 -replace "`r`n", "`n"), $Utf8NoBom)
}

Write-Host "`nDONE. Run order:" -ForegroundColor Yellow
Write-Host '  1) .\phases-rotate: docker compose run --rm -v "' + '"$PWD/scripts/rotate-admin.py"' + ':/rotate.py" --entrypoint python api /rotate.py   # NEW password - keep it private, do NOT paste here'
Write-Host '  2) .\scripts\up.ps1 -TimeoutSeconds 900      # first npm install takes minutes'
Write-Host '  3) curl gate: & curl.exe -sk -o NUL -w "%{http_code}" https://admin.rfo.localhost/   # expect 200'
Write-Host '  4) BROWSER: open https://admin.rfo.localhost -> login -> /admin/security TOTP enroll -> sign out -> login again (code required).'
Write-Host '  5) git add -A ; git commit -m "feat(ui): phase 6a backoffice live with auth+TOTP"'
