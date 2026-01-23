# RRMSmile/vpn (CloudGate) — Codex tasks

Repo: git@github.com:RRMSmile/vpn.git
Local path: ~/work/CloudGate

## Ground rules (must not break)
- Bot token comes ONLY from: docker-compose.yml -> bot.env_file: ./.env.tokens
- Do NOT use host-shell `${BOT_TOKEN}` interpolation in docker-compose for bot tokens
- Bot uses `API_BASE` (fallback `API_BASE_URL` allowed)

## What is already verified locally
- Bot sees BOT_TOKEN len=46 inside container
- Telegram getMe -> SafeeeVPN_bot
- /start works, provisioning sends .conf

## Tasks for Codex (do in order)
1) docker-compose.yml sanity
   - bot has `env_file: ./.env.tokens`
   - bot does NOT contain `BOT_TOKEN=${...}` or `TELEGRAM_BOT_TOKEN=${...}`
   - bot has `API_BASE=http://api:3001`

2) Bot source cleanup
   - Remove temporary debug middleware (`bot.use(...)` that logs every update)
   - Keep minimal logs: boot + error

3) Telegram debug safety
   - Add/keep helper scripts:
     - tools/tg-check.sh (getMe + getWebhookInfo, safe while polling)
     - tools/tg-getupdates.sh (stops bot first, then getUpdates, then restarts)

4) Smoke tests (Codex can run only what environment allows)
   - ./tools/check-bot-src.sh
   - pnpm --filter @cloudgate/bot build
   - NOTE: docker compose up/down and /start checks are done locally by developer

## Acceptance criteria
- No `${BOT_TOKEN}` host interpolation for bot tokens in compose
- Bot compiles
- tools scripts present and executable
