# Demo AI Bot — Bubble Tea Assistant (Telegram + PayOS)

This repository contains a NestJS backend that powers a Telegram + web assistant for a bubble-tea shop. The bot reads a CSV menu, uses an LLM to parse customer messages into structured orders, computes totals, creates PayOS checkout links, and verifies PayOS webhook notifications.

This README gives a step-by-step, terminal-first guide so someone unfamiliar with the code can start the project and reproduce the demo from development to a working Telegram webhook (local via ngrok).

**Assumptions**
- OS: Windows (PowerShell instructions provided). Bash/Linux/macOS commands are also shown where relevant.
- You have Git, Docker, and an internet connection.

---

**Quick overview**
- Backend: `backend/` (NestJS, TypeScript)
- Scripts: `backend/scripts/create_db.js` (create DB), `backend/scripts/send-webhook-test.js` (simulate PayOS webhook)
- Env: `backend/.env` (do not commit!). Use `backend/.env.example` as a template.

---

## 1) Clone the repo

Open PowerShell and run:

```powershell
git clone <REPO_URL> "demo-ai-bot"
cd "demo-ai-bot"
```

Replace `<REPO_URL>` with the repo URL.

## 2) Install prerequisites

Install Node.js (v18+). On Windows use `winget` (or `choco` if you prefer):

```powershell
winget install OpenJS.NodeJS.LTS
# or with Chocolatey:
# choco install nodejs-lts
```

Install Docker (Docker Desktop) so you can run Postgres and Redis:

```powershell
winget install -e --id Docker.DockerDesktop
```

Install `ngrok` (used to expose your local backend to Telegram). Recommended via winget:

```powershell
winget install --id=Ngrok.Ngrok -e
# or with Chocolatey:
# choco install ngrok
```

If you cannot use installers, download the `ngrok` binary and unzip it next to your shell path.

## 3) Start local infrastructure (Postgres + Redis)

Run these Docker commands to start Postgres and Redis (the backend expects Postgres on host port `55432` and Redis on `6379`):

```powershell
docker run --name demo-postgres -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=demo -p 55432:5432 -d postgres:15

docker run --name demo-redis -p 6379:6379 -d redis:7
```

Check containers with `docker ps` and logs with `docker logs demo-postgres`.

## 4) Prepare backend environment

Copy the example env file and fill in secrets (PayOS, Telegram token, OpenAI/Google key):

```powershell
cd backend
copy .env.example .env
# Open backend/.env in a text editor and fill the values
```

- `OPENAI_API_KEY`: set your OpenAI key or Google API key (starts with `AIza`) if you want Gemini. If using Google, leave `GOOGLE_MODEL` as needed.
- `PAYOS_*`: merchant id / api key / webhook secret from PayOS account (for production). For testing you can use the demo values you already had.
- `TELEGRAM_BOT_TOKEN`: create a bot with BotFather and paste the token.
- `TELEGRAM_WEBHOOK_SECRET`: pick a random long secret (used to validate webhook requests from Telegram).

## 5) Install Node dependencies

From the repository root:

```powershell
cd backend
npm install

# If there's a frontend folder and you plan to run it locally
cd ../frontend
npm install
```

## 6) Prisma setup and DB migration

From `backend/`:

```powershell
npx prisma generate
npx prisma db push --accept-data-loss

# Optional: run the helper script to create DB or seed if present
node scripts/create_db.js
```

`create_db.js` checks `backend/.env` for DB connection details and will create the demo database if needed.

## 7) Build and start the backend

Development (live TypeScript execution):

```powershell
cd backend
npm run start
```

Production build and start:

```powershell
cd backend
npm run build
npm run start:prod
```

The server listens on `http://localhost:3001` by default.

## 8) Expose backend to the internet (ngrok) and set Telegram webhook

Start ngrok to forward to the backend:

```powershell
ngrok http 3001 --host-header=localhost
```

In another terminal, get the public forwarding URL (ngrok provides it in the terminal at Web Interface                 http://127.0.0.1:port_here), or query the local ngrok API:

```powershell
# Query the local ngrok API (default port is 4040). If that doesn't show tunnels, try 4041:
curl http://127.0.0.1:4040/api/tunnels
# If nothing returns, try:
# curl http://127.0.0.1:4041/api/tunnels
# Look for the `public_url` value, e.g. https://abcd-1234.ngrok-free.app
```

Register that URL as your Telegram webhook (replace placeholders):

```powershell
$env:TELEGRAM_BOT_TOKEN = "<your_bot_token>"
$env:TELEGRAM_WEBHOOK_SECRET = "<your_secret_token>"
# Try the ngrok API on 4040 first, fallback to 4041 if needed:
$ngrok = $null
try { $ngrok = (curl http://127.0.0.1:4040/api/tunnels | ConvertFrom-Json).tunnels[0].public_url } catch { }
if (-not $ngrok) { try { $ngrok = (curl http://127.0.0.1:4041/api/tunnels | ConvertFrom-Json).tunnels[0].public_url } catch { } }
curl -s "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/setWebhook?url=$ngrok/telegram/webhook&secret_token=$($env:TELEGRAM_WEBHOOK_SECRET)"
```

Verify webhook info:

```powershell
curl "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/getWebhookInfo"
```

## 9) Test the bot (simulate a Telegram user)

Send a test update to the webhook (PowerShell):

```powershell
$body = '{"update_id":1000000,"message":{"message_id":1,"from":{"id":12345,"is_bot":false,"first_name":"Tester"},"chat":{"id":12345,"type":"private"},"date":1650000000,"text":"Tôi muốn 1 ly Trà Sữa Trân Châu Đen L, thêm topping trân châu đen"}}'
Invoke-RestMethod -Uri 'http://localhost:3001/telegram/webhook' -Method POST -Headers @{'Content-Type'='application/json'; 'X-Telegram-Bot-Api-Secret-Token' = '<your_telegram_webhook_secret>' } -Body $body
```

Or post to the public ngrok URL so Telegram-style requests arrive exactly as they would from Telegram.

If everything works, the backend will call the AIService to parse the message, create an order, call PayOS to create a checkout link, and use the Telegram API to send the link to the user chat.

## 10) Simulate PayOS webhook (mark order as paid)

To simulate PayOS sending a signed webhook to your server, use the helper script (reads `PAYOS_WEBHOOK_SECRET` from `backend/.env`):

```powershell
cd backend
node scripts/send-webhook-test.js

# To target a public ngrok URL instead of localhost:
$env:WEBHOOK_TARGET = 'https://<your-ngrok-host>/payment/webhook'
node scripts/send-webhook-test.js
```

The script prints the canonical string, computed signature, and the server's response. The backend verifies the signature and persists the webhook result.

## 11) Troubleshooting & tips

- If the AI parsing fails with Google errors: make sure the API key in `OPENAI_API_KEY` is a valid Google AI Studio key (starts with `AIza`) and that `GOOGLE_MODEL` is set to a model your project is allowed to use. Alternatively, you can use a working OpenAI key.
- If PayOS calls fail, check `PAYOS_API_KEY` and `PAYOS_MERCHANT_ID` in your `.env`.
- If Telegram messages don't appear, check `getWebhookInfo` and the backend logs to ensure incoming updates are received.
- For local testing without Telegram, use the curl/Invoke-RestMethod examples above.

## 12) Useful commands summary

```powershell
# Start infra
docker run --name demo-postgres -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=demo -p 55432:5432 -d postgres:15
docker run --name demo-redis -p 6379:6379 -d redis:7

# Install backend deps
cd backend
npm install

# Prepare DB
npx prisma generate
npx prisma db push --accept-data-loss
node scripts/create_db.js

# Start backend (dev)
npm run start

# Expose with ngrok
ngrok http 3001 --host-header=localhost

# Set Telegram webhook (example)
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=<NGROK_URL>/telegram/webhook&secret_token=<SECRET>"

# Simulate PayOS webhook
node scripts/send-webhook-test.js
```

---

## Run the full setup script (PowerShell)

A convenience script `start-dev.ps1` is included to automate the full local setup: starts Docker containers (Postgres + Redis), installs dependencies, runs Prisma commands, starts the backend, launches `ngrok` (if installed), and attempts to register the Telegram webhook.

1. Make sure `backend/.env` exists and is filled (copy from `backend/.env.example`).
2. Open PowerShell in the repository root.

Run the script (temporary bypass of execution policy):

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

Or run interactively (temporary process scope bypass):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start-dev.ps1
```

To skip starting `ngrok` and webhook registration:

```powershell
.\start-dev.ps1 -SkipNgrok
```

Notes:
- The script opens new PowerShell windows for the backend and ngrok. Close those windows to stop the services.
- Ensure Docker Desktop is installed and running before starting the script. Download Docker Desktop and open it up.
- If ngrok is not installed or not in PATH, the script will attempt to download ngrok automatically; if the download fails it will continue but will not register the Telegram webhook automatically.
