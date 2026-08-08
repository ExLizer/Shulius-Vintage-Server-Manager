# Shulius Vintage Server Manager

A desktop app to run, manage and share **Vintage Story** dedicated servers — with optional
self-hostable cloud features for playing with friends.



**[⬇ Download the latest release](https://github.com/ExLizer/Shulius-Vintage-Server-Manager/releases/latest)** · Windows (NSIS installer)

---

## Features

**Local (no account, no server, works offline):**

- One-click start/stop of the Vintage Story dedicated server, with live console, logs and metrics (CPU/RAM history).
- Save management: backups, restore, copy singleplayer ↔ server saves, automatic pruning.
- Mod manager: search & install from the official mod DB, version compatibility checks, modpack export/import.
- Server profiles: several independent server configurations (data paths, mods, config) you can switch between.
- Full `serverconfig.json` editor, port testing, public IP detection, player management.
- Scheduled autosave and auto-backup while the server runs.

**Cloud (optional — requires a PocketBase server, self-hosted or a friend's):**

- **Groups**: create a group, invite friends with a code.
- **Shared worlds**: the world's save file lives in the cloud, versioned. Whoever wants to host
  presses Start — the app downloads the latest version, runs the server, and uploads the result
  when the session ends.
- **World locking**: while someone hosts, the world is locked so two people can't fork the save.
- **Version history**: the last versions of every world are kept server-side and can be rolled back.

## How it works

```
┌─────────────────────┐        ┌──────────────────────┐
│  Desktop app (Tauri) │◄──────►│  PocketBase server    │
│  React + Rust        │  HTTPS │  (yours / a friend's) │
└──────────┬──────────┘        │  · auth (users)       │
           │ manages           │  · groups, invites    │
           ▼                   │  · worlds + versions  │
┌─────────────────────┐        │  · locks              │
│  VS dedicated server │        └──────────────────────┘
└─────────────────────┘
```

There is **no mandatory central server**. The app asks for your PocketBase URL on first run;
every group can run its own instance. One person in the group hosts PocketBase, everyone else
just enters the URL.

---

## Getting started (players)

1. **Install the app** from the [latest release](https://github.com/ExLizer/Shulius-Vintage-Server-Manager/releases/latest).
2. On first launch a **setup wizard** appears:
   - *Use local mode only* — everything except the cloud tab works immediately. You can enable
     the cloud later from **Settings → Cloud server**.
   - *Set up cloud* — enter the PocketBase URL of your group (ask the person who hosts it), and
     the wizard verifies the server step by step (reachability → schema → app logic) with
     specific hints if something is missing.
3. Go to the **Groups** tab, create an account on that server, and create or join a group.

> **Note for account admins:** new accounts start with cloud features disabled
> (`cloud_enabled = false`). The owner of the PocketBase instance enables them per user —
> see [Enabling users](#5-enable-your-users) below.

---

# Self-hosting the cloud (PocketBase)

The whole backend is a single [PocketBase](https://pocketbase.io) instance (one executable, one
SQLite file) plus two folders from this repo:

- [`pb_hooks/`](pb_hooks) — the app's server-side logic (groups, invites, locks, upload caps).
- [`pb_migrations/`](pb_migrations) — creates all collections, rules and rate limits automatically
  on first start.

Any machine that can run a binary and is reachable by your friends works: a $3 VPS, a home
server, even your own PC (with port forwarding). Pick **one** of the options below.

### Option A — Docker Compose (recommended)

Requires Docker. From a clone of this repo:

```bash
cd deploy
docker compose up -d
```

That's it. PocketBase is now on `http://<your-ip>:8090`, with the schema created and the hooks
loaded. Data persists in `deploy/pb_data/`.

### Option B — Coolify (or any panel)

If you use [Coolify](https://coolify.io/) on your VPS:

1. Create a new **Docker Compose** resource pointing at this repo (or paste
   [`deploy/docker-compose.yml`](deploy/docker-compose.yml)).
2. Attach a domain to port `8090` — Coolify gives you HTTPS automatically.
3. Deploy. Check `https://your-domain/api/health` returns `"code": 200`.

> ⚠️ In Coolify, raise the proxy's **max body size** (Traefik/Caddy setting) to at least 5 GB,
> or large world uploads will be cut off before reaching PocketBase.

### Option C — Bare binary (no Docker)

1. Download PocketBase **v0.38.x** for your OS from
   [pocketbase.io/docs](https://pocketbase.io/docs/) and unzip it.
2. Copy the `pb_hooks/` and `pb_migrations/` folders from this repo next to the executable:

   ```
   pocketbase(.exe)
   pb_hooks/main.pb.js
   pb_migrations/1754500000_init_schema.js
   pb_migrations/1754500001_rate_limits.js
   ```

3. Run it:

   ```bash
   ./pocketbase serve --http 0.0.0.0:8090
   ```

   Migrations run automatically on the first start.

### After installing (all options)

#### 1. Create your superuser

Open `http://<your-server>:8090/_/` in a browser and create the admin account (or run
`./pocketbase superuser upsert you@email.com yourpassword`).

#### 2. Put HTTPS in front (strongly recommended)

Use Caddy, Traefik, Nginx or your panel's proxy with Let's Encrypt. The desktop app accepts
plain `http://` (useful for LAN), but over the internet you want TLS — the connection carries
auth tokens and world files. Remember: **max body size ≥ 5 GB** on the proxy.

#### 3. Configure IP proxy headers

In the admin UI → *Settings → Application → IP proxy headers*: enable it and add the header your
proxy sends (`X-Forwarded-For` usually). Without this, the built-in rate limits apply globally
instead of per-IP.

#### 4. (Optional) SMTP for account emails

*Settings → Mail settings*. Needed only for email verification / password reset emails. The app
works without it.

#### 5. Enable your users

New accounts are created with `cloud_enabled = false` and can join groups and download worlds,
but cannot **create** groups/worlds or **host**. As the instance admin, open the admin UI →
`users` collection and set for each trusted member:

- `cloud_enabled` → `true`
- `max_upload_bytes` → optional per-user upload cap in bytes (`0` = default 2 GB)

This is an anti-abuse gate (uploads consume your disk/bandwidth), not a paywall: on your own
instance, you decide who hosts. Users cannot flip these flags themselves — a server-side hook
blocks it.

#### 6. Verify from the app

Open the desktop app → Settings → *Cloud server* → enter your URL. The wizard checks:

1. the server responds and is PocketBase,
2. the schema was created (migrations ran),
3. the custom routes exist (`pb_hooks` loaded),

and tells you exactly which folder is missing if a check fails.

---

## Pros and cons of this system

An honest assessment of the architecture, so you know what you're signing up for.

**Pros**

- **You own your data.** Worlds, accounts and groups live on a server you (or a friend) control.
  No third party can shut it down, charge you, or mine your data.
- **Tiny ops footprint.** PocketBase is a single binary with SQLite — no database server, no
  Node runtime. Backups = copy one folder. Runs comfortably on a 1 vCPU / 512 MB VPS.
- **No host dependency for the group.** The "who hosts tonight" problem disappears: the world
  follows the group via the cloud, with locking preventing forked saves.
- **Works offline / degraded.** Everything local (server, mods, backups, profiles) works with
  zero configuration and no account.
- **Versioned worlds.** The last 5 versions of each world are kept server-side; a bad session
  can be rolled back.
- **Auditable.** All server-side logic is ~30 KB of readable JavaScript in `pb_hooks/`; the whole
  app is open source under AGPL.

**Cons**

- **Someone has to host PocketBase.** One person per group needs to set up and keep alive a
  small server (and do updates/backups). ~10 minutes with Docker, but it's a real responsibility.
- **Trust model = the instance admin.** Whoever runs PocketBase can read the group's data and
  world files. Play with people you trust.
- **World transfer time.** Saves are compressed (zstd) but a multi-GB world still takes real
  time to upload/download on slow connections at session start/end.
- **Turn-based hosting, not a 24/7 server.** The lock system means one host at a time; this is
  a *shared* world, not an always-on public server.
- **SQLite scale.** Perfect for groups of friends; not designed for a public instance with
  thousands of concurrent users.

---

## Development

```bash
git clone https://github.com/ExLizer/Shulius-Vintage-Server-Manager
cd vs-server-manager
npm install
npm run tauri dev
```

- Optional: copy `.env.example` to `.env.local` and set `VITE_PB_URL` to skip the setup wizard
  during development (e.g. a local `pocketbase serve`).
- Frontend: React 19 + TypeScript + Tailwind (Vite). Native layer: Rust (Tauri v2).
- Release builds use Tauri's updater; forks must generate their own signing keys
  (`tauri signer generate`) and update `tauri.conf.json` → `plugins.updater`.

### Security notes

- The webview CSP allows `connect-src https: http:` because the PocketBase URL is user-configured
  at runtime; `script-src` remains `'self'`. Server-side, all sensitive invariants (role checks,
  locks, upload caps, premium flags) are enforced in `pb_hooks`, never in the client.
- Rate limits ship enabled by default (see `pb_migrations/1754500001_rate_limits.js`).
- Found a vulnerability? Please open a private security advisory on GitHub rather than a public issue.

## License

**GNU AGPL-3.0** — see [LICENSE](LICENSE).

In short: you can use, study, modify and redistribute this software freely. If you distribute a
modified version **or run one as a network service**, you must make your modified source
available under the same license. That last part (the "Affero" clause) is deliberate: it keeps
hosted forks of this project open too.
