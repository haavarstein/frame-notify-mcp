# Hello

This is a small MCP server for wall-frame push notifications. An agent can put a short message on the frame, take it down, and read what is showing. That is the whole server.

It does not start prints, change devices, or read a dashboard. The token, and anything you would not want on a wall, stay out of git.

## Run it

Node.js 18 or newer.

```bash
git clone https://github.com/haavarstein/frame-notify-mcp.git
cd frame-notify-mcp
cp .env.example .env
openssl rand -hex 24
```

Put that value in `.env` as `FRAME_NOTIFY_TOKEN`. It must be at least 16 characters. Then:

```bash
npm start
```

Open `http://127.0.0.1:8090/` on the frame. The page checks `/api/alerts` every 10 seconds. A tap removes the alert.

The server listens on `127.0.0.1` until you set `FRAME_HOST`. Leave the token empty and `POST /mcp` answers 404, so nothing can post.

## What the frame shows

| Level | On the frame |
| --- | --- |
| `whisper` | A gold bead and one line in the corner. Ten minutes unless `ttl_s` says otherwise. |
| `nudge` | A card with a yellow border. It leaves after one minute unless `ttl_s` says otherwise. This is the default. |
| `urgent` | The same card with a red bar. It stays until someone taps it or an agent dismisses it. `ttl_s` is ignored. |

Only the newest alert of each level is drawn. The message is cut to 140 characters. Links and line breaks are removed.

`GET /api/alerts` needs no token, because the frame reads it. The JSON is the text, the sender's display name, and the timing. It does not include the token.

```json
{
  "alerts": [
    {
      "id": "0123456789ab",
      "level": "nudge",
      "text": "Backup finished",
      "source": "Grok Build",
      "at": "2026-10-12T14:00:00.000Z",
      "remainingMs": 60000,
      "ttlMs": 60000
    }
  ]
}
```

`remainingMs` and `ttlMs` are `null` for urgent. Point another frame at the same URL if you already have a page. Poll about every 10 seconds. On a tap, post `{"id":"..."}` to `/api/alerts/dismiss`.

## Connect an agent

Use the same token in the MCP client. Keep it in the environment. Do not paste it into a config file that you commit.

```json
{
  "mcpServers": {
    "frame-notify": {
      "type": "http",
      "url": "http://127.0.0.1:8090/mcp",
      "headers": {
        "Authorization": "Bearer ${FRAME_NOTIFY_TOKEN}"
      }
    }
  }
}
```

Claude Code:

```sh
claude mcp add --transport http frame-notify http://127.0.0.1:8090/mcp --header "Authorization: Bearer ${FRAME_NOTIFY_TOKEN}"
```

The server speaks streamable HTTP with JSON responses and no session. `POST /mcp` is the only MCP method.

| Tool | What it does |
| --- | --- |
| `frame_notify` | Shows an alert. `text` is required. `level` is `whisper`, `nudge`, or `urgent`. `source` is lowercase letters, digits, and dashes, up to 32 characters. `ttl_s` is 10 to 3600. Returns the alert id. |
| `frame_dismiss` | Removes an alert. `id` is the 12 hex characters `frame_notify` returned. |
| `frame_state` | The alerts on the frame now. |

A script can skip MCP and post the same alert:

```sh
curl -s -X POST http://127.0.0.1:8090/api/alerts \
  -H "authorization: Bearer ${FRAME_NOTIFY_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"text":"Backup finished","level":"nudge","source":"backup"}'
```

Each source can send 30 alerts a minute. The 31st gets `429`.

## On another machine

If the frame and the agent are not on this computer, set `FRAME_HOST=0.0.0.0` and put the server on the LAN address the frame can reach. `GET /api/alerts` is open on that host, so only do this on a network you trust. Posts still need the token.

Known source names that get a display label: `claude-code`, `codex`, `grok-build`, `grok-bot`. Any other allowed source is shown with the dashes turned into words.

## Do not publish

- `.env` and `FRAME_NOTIFY_TOKEN`
- `data/alerts.json`
- message text you would not want on a public wall
