# Bloggy

An easy-to-use blogging platform for creators. Write in Markdown, publish in seconds.

One Bun server does everything. It renders the public blogs, serves the JSON API, and hosts the creator panel. Published posts are real server-rendered HTML, so search engines and link previews read them without running JavaScript.

```
                    ┌───────────────────────────────────┐
   readers      →   │  Bun server                       │
   creators     →   │                                   │
                    │  /              rendered blogs    │
                    │  /creator/:user/:slug             │
                    │  /creator/:user/feed.rss|atom|json│
                    │  /sitemap.xml  /robots.txt        │
                    │  /media/*      avatars & images   │
                    │                                   │
                    │  /panel        creator panel      │
                    │  /api/v1/*     JSON API           │
                    │  /metrics      OpenMetrics        │
                    └─────────────────┬─────────────────┘
                                      ▼
                    SQLite · PostgreSQL · MySQL · MariaDB
                    local disk or any S3-compatible store
```

## Requirements

- Bun 1.4 or newer
- One of SQLite (bundled), PostgreSQL, MySQL or MariaDB

## Getting started

```bash
bun install
cp .env.example .env
bun run keygen >> .env    # generates ENCRYPTION_KEY and ADMIN_TOKEN
bun run dev
```

Then open **http://localhost:3000/panel** and create the first account. Your blog is live at `http://localhost:3000/creator/<username>`.

`bun run dev` builds the panel, starts the server under `bun --watch`, and rebuilds the panel when its sources change. One command, one Ctrl-C. Migrations apply automatically at startup.

## Layout

```
src/
  server/          the Bun server
    routes/        API, rendered pages, panel hosting, moderation
    ssr/           page templates, markdown, feeds, stylesheet
    db/            schema, migrations, repositories
    auth/          sessions and two-factor
    middleware/    auth, CSRF, cache, metrics, envelope
    lib/           config, crypto, storage, backups, validation, errors
  panel/           the creator panel (client-side app)
    views/         sign-in, posts, editor, images, team, analytics, settings, moderation, backups
  shared/          values both sides must agree on
scripts/           dev runner, build, admin promotion
tests/
public/panel/      built panel bundle (generated)
```

`src/shared/` is why this is one project rather than two. Error codes, categories, languages, themes and social platforms live there in a single copy, so the panel can never offer something the server rejects.

## Search engines

Bloggy is built so a blog is fully indexable without any work from the creator.

- **Every public page is server-rendered.** A crawler that never runs JavaScript sees the complete post, its title, its author and its date.
- **Open Graph and Twitter Card tags** on every page, so a shared link shows a proper preview in chats and social feeds. A post advertises its own cover image, while the tab icon stays the blog's, so a reader moving between posts does not watch the favicon change.
- **JSON-LD structured data** describing the blog and each article.
- **One official address per page** (a canonical URL), including each page of a paginated listing and each tag page, so the second page of a blog is indexed in its own right instead of being discarded as a duplicate of the first.
- **`sitemap.xml` and `robots.txt`** are generated and kept current. Drafts and suspended accounts never appear in either.
- **RSS, Atom and JSON feeds** per creator, advertised with `<link rel="alternate">` and by a visible feed icon, since browsers stopped offering one of their own.
- **Tag pages are indexable** and linked from every post card, which gives readers and search engines a way to browse a blog by topic. Search result pages are marked `noindex` instead, because there is no limit to how many of them exist and they mostly repeat each other.
- **Pagination is crawlable.** The next page is an ordinary link carrying `rel="next"`, which JavaScript upgrades into infinite scrolling. With scripting disabled the same link still works, so no post is unreachable.
- **Pages are cached and served with ETags**, which keeps them fast, and speed is itself a ranking signal.

## Configuration

Every setting lives in `.env`. See [.env.example](.env.example), which documents each one. The essentials:

| Variable                 | Default                         | Notes                                                 |
| ------------------------ | ------------------------------- | ----------------------------------------------------- |
| `PORT`                   | `3000`                          |                                                       |
| `BIND_ADDRESS`           | `0.0.0.0`                       | Not `HOSTNAME`, see below                             |
| `DOMAIN`                 | `http://localhost:3000`         | Public origin, and decides the cookie's `Secure` flag |
| `DATABASE_URL`           | `sqlite://./data/bloggy.sqlite` | `sqlite://`, `postgres://`, `mysql://`, `mariadb://`  |
| `ENCRYPTION_KEY`         | none                            | Required. Encrypts TOTP secrets at rest               |
| `ADMIN_TOKEN`            | none                            | Guards `/metrics` and the maintenance endpoints       |
| `API_ORIGINS`            | _(empty)_                       | CORS for external clients. Empty disables it entirely |
| `TRUST_PROXY`            | `direct`                        | Proxy preset, including `cloudflare` and `burrowgate` |
| `SMTP_HOST`              | _(empty)_                       | Enables account email when set with `SMTP_FROM`       |
| `SMTP_PORT`              | `587`                           | SMTP server port                                      |
| `SMTP_SECURE`            | `false`                         | Use implicit TLS, normally with port 465              |
| `SMTP_REQUIRE_TLS`       | `true`                          | Require STARTTLS when implicit TLS is off             |
| `SMTP_FROM`              | _(empty)_                       | Sender name/address for transactional emails          |
| `EMAIL_CONFIRMATION_TTL` | `86400`                         | Lifetime of registration confirmation links           |

> **`BIND_ADDRESS`, not `HOSTNAME`.** Bash and every Docker container already export `HOSTNAME`, and a real environment variable takes precedence over `.env` in Bun. Using that name would silently bind the server to the machine's hostname instead of all interfaces.

### Databases

The same schema runs on all four supported databases through Bun's native `SQL` client:

```bash
DATABASE_URL=sqlite://./data/bloggy.sqlite
DATABASE_URL=postgres://user:password@localhost:5432/bloggy
DATABASE_URL=mysql://user:password@localhost:3306/bloggy
DATABASE_URL=mariadb://user:password@localhost:3306/bloggy
```

Three rules keep one schema portable, worth knowing before adding a migration:

1. Timestamps are ISO-8601 strings in `VARCHAR(32)` rather than native date types, because each driver handles dates differently, while text comes back exactly as it was stored and still sorts correctly.
2. Every indexed or key column is `VARCHAR(n)`, never `TEXT`, because MySQL cannot index a `TEXT` column with no length limit.
3. Indexes are declared inline in `CREATE TABLE` for MySQL and MariaDB, which reject `CREATE INDEX IF NOT EXISTS`, and as separate statements elsewhere.

Migrations in `src/server/db/schema.ts` are only ever added to. Never edit one that has already run somewhere, write a new one instead.

### Media storage

Avatars and post images go to the local filesystem by default. Set `STORAGE_DRIVER=s3` and the `S3_*` variables to use any S3-compatible service (R2, MinIO, Backblaze, AWS) through Bun's native S3 client. Set `CDN_URL` to serve media from a CDN instead of from this server.

`MAX_AVATAR_SIZE` and `MAX_IMAGE_SIZE` bound a single upload. `MAX_ACCOUNT_STORAGE` bounds the total per account, so one creator cannot fill the volume a megabyte at a time. Set it to `0` to allow unlimited storage.

## Authentication

Owners and collaborators sign in against an argon2id hash (`Bun.password`). A session then travels two ways:

- **The panel** gets a cookie with `Secure`, `HttpOnly`, and `SameSite=Lax`. JavaScript cannot read it, so an XSS bug in the panel cannot steal the session. This is only possible because the panel is served from the same origin as the API.
- **Scripts and other clients** send `Authorization: Bearer <token>`, returned by `POST /api/v1/auth/login`. A header the client sets on purpose always wins over a cookie the browser attaches on its own.

Writes that rely on the cookie also pass a CSRF check. `SameSite=Lax` already stops browsers attaching the cookie to a cross-site POST, and the server independently requires such requests to declare an `Origin` it owns. Bearer requests are exempt, because a cross-origin page cannot set that header without CORS allowing it.

Two-factor authentication is TOTP, with ten single-use backup codes. Secrets and codes are encrypted at rest with XChaCha20. A backup code is consumed the first time it is used.

### Account email

Transactional email is opt-in. Password reset and email confirmation controls are absent from the panel and their APIs refuse requests until both `SMTP_HOST` and `SMTP_FROM` are configured. `SMTP_USER` and `SMTP_PASSWORD` may both be left empty for a trusted local relay. Otherwise, both are required. Set `SMTP_SECURE=true` for implicit TLS, normally on port 465. Port 587 normally keeps it `false` and upgrades with STARTTLS. `SMTP_REQUIRE_TLS` defaults to `true`. Only disable it for a trusted relay that cannot use TLS.

When SMTP is enabled, a new creator must confirm their email before signing in. Pending accounts do not appear on the homepage, creator pages or public creator API. Confirmation links are stored only as hashes, expire after `EMAIL_CONFIRMATION_TTL` seconds (24 hours by default), and are consumed only after the person explicitly confirms in the panel so automated email scanners cannot use them. Existing accounts are marked verified by the migration. If SMTP is later disabled, a pending account is verified on its next successful password login instead of becoming permanently inaccessible.

Reset requests ask for the sign-in username, which keeps collaborator accounts unambiguous even when several accounts share an email address. The API always returns the same response for existing, unknown and recently requested usernames. Tokens are stored only as hashes, expire after `PASSWORD_RESET_TTL` seconds (one hour by default), work once, and revoke every session after use. Two-factor authentication remains enabled after a password reset. Confirmation, reset and invitation links place their tokens in URL fragments, which browsers do not send in HTTP requests. The panel removes the fragment from the address bar immediately and submits the token in a JSON request body.

## API

Every JSON endpoint returns the same envelope:

```json
{ "error": 0, "info": "Success", "data": {} }
```

`error` is `0` on success and a numeric code otherwise. The codes are a stable public contract, defined once in [src/shared/errors.ts](src/shared/errors.ts) and used by both sides. Values are never reused.

| Method   | Path                                       | Purpose                            |
| -------- | ------------------------------------------ | ---------------------------------- |
| `POST`   | `/api/v1/auth/register`                    | Create an account                  |
| `POST`   | `/api/v1/auth/login`                       | Sign in and set the session cookie |
| `POST`   | `/api/v1/auth/logout`                      | Revoke the current session         |
| `GET`    | `/api/v1/auth/me`                          | Current creator                    |
| `POST`   | `/api/v1/auth/password`                    | Change password                    |
| `POST`   | `/api/v1/auth/password-reset/request`      | Email a one-use reset link         |
| `POST`   | `/api/v1/auth/password-reset/validate`     | Validate a reset link              |
| `POST`   | `/api/v1/auth/password-reset/complete`     | Set a new password                 |
| `POST`   | `/api/v1/auth/email-confirmation/request`  | Resend a confirmation link         |
| `POST`   | `/api/v1/auth/email-confirmation/validate` | Validate a confirmation link       |
| `POST`   | `/api/v1/auth/email-confirmation/confirm`  | Confirm the account email          |
| `GET`    | `/api/v1/auth/sessions`                    | List active sessions               |
| `DELETE` | `/api/v1/auth/sessions[/:id]`              | Revoke one, or all others          |
| `POST`   | `/api/v1/auth/2fa/begin\|confirm\|disable` | TOTP enrolment                     |
| `POST`   | `/api/v1/auth/2fa/backup-codes`            | Regenerate backup codes            |
| `GET`    | `/api/v1/posts`                            | Your posts, drafts included        |
| `POST`   | `/api/v1/posts`                            | Create a draft or publish a post   |
| `GET`    | `/api/v1/posts/:slug`                      | One of your posts, with markdown   |
| `PUT`    | `/api/v1/posts/:slug`                      | Edit, publish or unpublish         |
| `DELETE` | `/api/v1/posts/:slug`                      | Delete a post                      |
| `POST`   | `/api/v1/posts/:slug/request-changes`      | Return a reviewed post with a note |
| `GET`    | `/api/v1/team`                             | Members and pending invitations    |
| `POST`   | `/api/v1/team/invitations`                 | Create a seven-day invite link     |
| `POST`   | `/api/v1/team/invitations/lookup`          | Read a valid invitation            |
| `POST`   | `/api/v1/team/invitations/accept`          | Accept an invitation               |
| `PUT`    | `/api/v1/team/members/:username`           | Change a collaborator's role       |
| `DELETE` | `/api/v1/team/members/:username`           | Remove a collaborator              |
| `POST`   | `/api/v1/preview`                          | Render markdown for the editor     |
| `GET`    | `/api/v1/media`                            | Your images, with storage used     |
| `PUT`    | `/api/v1/media`                            | Upload an image (raw body)         |
| `DELETE` | `/api/v1/media/:id`                        | Delete an image                    |
| `POST`   | `/api/v1/creators/me/settings\|social`     | Update blog settings or links      |
| `PUT`    | `/api/v1/creators/me/avatar`               | Upload an avatar (raw body)        |
| `DELETE` | `/api/v1/creators/me`                      | Delete the account and all data    |
| `GET`    | `/api/v1/analytics`                        | Gateway traffic, when configured   |
| `GET`    | `/api/v1/analytics/pages`                  | Pages you can break out singly     |
| `GET`    | `/api/v1/creators[/:username]`             | Public creator directory           |
| `GET`    | `/api/v1/config`                           | Instance limits, read by the panel |

Create and edit accept `"status": "draft" | "review" | "changes" | "published"`, defaulting to `published`. The server permits transitions according to the signed-in account's role. See [Collaboration](#collaboration).

## Reading a blog

A creator page lists the newest posts twelve at a time. The next page is a plain link, which JavaScript turns into infinite scrolling when it is available.

**Search** filters a creator's posts by title, tag or keywords. It is an ordinary GET form, so it works without JavaScript and every result has a shareable URL.

**Tags** filter the same listing. Every post card links to its own tag, which gives readers a way to find more on the same topic and search engines something to index.

## Collaboration

An owner can create a one-use invitation from the panel's **Team** screen. The recipient chooses a personal username and password, so the owner's credentials never need to be shared. Invitations expire after seven days and only their hashes are stored.

- **Writers** create and edit their own unpublished posts, upload images and submit work for review. They cannot publish.
- **Editors** can also edit every unpublished post, but still cannot publish.
- **Publishers** can review, request changes with a note, publish, unpublish and manage every post.

Only the owner can change the blog profile, manage the team, view analytics, configure two-factor authentication or delete the blog. Removing a member immediately revokes all of their sessions while leaving their work in the blog.

## Drafts and review

A post is **draft**, **in review**, **changes requested**, or **published**. Every unpublished state is filtered out in SQL on every public surface, covering the blog, feeds, the sitemap and the public JSON API, so its URL 404s exactly as a missing post does and its existence is not observable from outside.

Draft and changes-requested validation is deliberately loose. A work in progress needs only a title, because refusing to save unfinished work would defeat the point. The full rules (150+ words, a description, a cover image, keywords) apply when it is submitted for review or published.

`published_at` is set the first time a post goes public and never moves afterwards, so correcting a typo does not push the post back to the top of every feed. Feeds and structured data date posts by `published_at`, while `created_at` remains the row's creation date.

Authors preview their own posts at `/preview/:slug`. That is a separate path from the public URL on purpose, because public pages are cached and a response that varied by viewer could be stored and then served to everyone. The preview route requires a session, is never cached, and is marked `noindex`.

## Moderation

An administrator is an ordinary account carrying a flag, so moderation uses the same sign-in, two-factor and CSRF protection as everything else rather than a shared secret pasted into a browser.

```bash
bun run promote <username>       # from a checkout
bun run demote <username>

./bloggy promote <username>      # from the built binary
docker exec -it bloggy ./bloggy promote <username>
```

The commands are compiled into the server binary as well as the scripts, because a deployed container holds that binary alone with no Bun and no source. Running one while the server is up is safe.

All of them need shell access to the server, which is the right bar for handing out moderation powers. Demoting the last administrator is refused, so an instance cannot lock itself out.

The **Moderation** screen lists every account with its post count, storage used, registration date and last activity, sortable by any of them, which is how an account consuming far more than the rest is found. From there an administrator can:

- **Suspend** an account, which revokes its sessions, blocks sign-in and removes the blog from the site. Posts keep their status, so lifting a suspension restores exactly what was public before.
- **Delete** an account and everything attached to it, after typing the username to confirm.
- **Delete** an individual post or image.
- **Recalculate** an account's storage by comparing the database against what is really in storage. This is also what imports media that was already in storage before the account existed.

Suspension and deletion refuse to act on another administrator until that account is demoted, so one compromised session cannot quietly remove the others. Every action writes an audit line.

## Premium licenses

Administrators can generate up to 500 license keys at a time from the **Licenses** tab. A license defines its lifetime in days, an additional storage allowance in MB or GB, and whether it includes custom-domain access. The full keys are shown once in a one-key-per-line text box with individual and bulk copy controls. Only cryptographic hashes and masked hints are retained afterwards. The paginated history can be searched by an exact full key, its visible suffix, or the creator that redeemed it.

Creators redeem keys in **Settings -> Premium licenses**. A key's lifetime starts when it is redeemed, and every active key contributes independently. For example, an active 30-day key with 5 GB and custom-domain access plus a 90-day key with 10 GB provides 15 GB and custom-domain access for the first 30 days, then 10 GB without custom-domain access for the remaining 60 days. The additional allowance is added to `MAX_ACCOUNT_STORAGE`. An instance configured for unlimited storage remains unlimited.

The paginated **Moderation** table can be searched by username or email and shows each account's used and effective storage allowance, active and total redeemed license counts, and current custom-domain eligibility.

Maintenance endpoints guarded by `ADMIN_TOKEN` as a bearer token remain available for scripts: `GET /api/v1/admin/stats`, `POST /api/v1/admin/cache/purge`, `POST /api/v1/admin/sessions/prune`, and `GET /metrics`.

## Backups

SQLite instances can snapshot themselves to object storage on a schedule.

```bash
BACKUP_ENABLED=true
BACKUP_INTERVAL=21600       # seconds, so this is every six hours
BACKUP_KEEP=7               # oldest snapshots are pruned after each run
BACKUP_S3_BUCKET=...
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
```

> A snapshot contains every password hash and email address. Give it a **private bucket of its own**, never the media bucket, which is public whenever `CDN_URL` is set.

Snapshots are taken with `VACUUM INTO` rather than by copying the file. The database runs in WAL mode, where recent commits live in a side file until they are checkpointed, so copying `bloggy.sqlite` would quietly produce a database missing its newest writes.

The **Backups** screen lists what is stored and can take one on demand, download it, delete it, or restore it. Restoring verifies the snapshot opens as a Bloggy database, keeps the current one alongside it, then replaces it and stops the server so whatever runs it starts again on the restored copy. Docker's `restart: unless-stopped` does this for you.

Uploaded images are not part of a snapshot, since they already live in object storage with its own durability. Enabling versioning on the media bucket covers them.

PostgreSQL, MySQL and MariaDB instances should use their own backup tooling, and the screen says so rather than offering a button that cannot work.

## Analytics

The Analytics page appears only when Bloggy runs behind a [BurrowGate](https://github.com/Rabbit-Company/BurrowGate) gateway with a read-only monitoring token:

```bash
BURROWGATE_URL=https://gateway.example.com
BURROWGATE_TOKEN=bgro_...          # "monitoring" scope, read-only
BURROWGATE_SITE_ID=...             # this instance's site in BurrowGate
```

Four tabs: traffic over time, most read pages, countries (with a world map), and referrers. A Page views / Unique IPs switch changes the chart, rankings, country map, and referrer table together. Pages are listed by post title with the slug beneath, not as raw paths, and a path with no matching post is shown as its slug marked _No longer published_ rather than given an invented title. Gateway-centric views such as cache hit ratio and latency are deliberately not offered, because they describe the gateway's health rather than a blog's readership.

**One page at a time.** A picker narrows every tab to a single post, or to the blog's index page, which is how you find out where the readers of one particular piece came from. The picker sends a _slug_ rather than a path. The server builds the path from the session, so a creator cannot address another creator's pages by editing the request. Selecting a page hides the Pages tab, which has nothing left to rank.

**What the numbers are.** Page views are requests the gateway served, excluding anything the origin refused. Unique IPs count distinct client addresses inside each selected time bucket, page, country, or referrer, so repeated refreshes from the same address do not inflate that value. Values from different rows are not additive because one address can visit several pages or arrive from several referrers. Unique IPs are only an estimate of readership. Shared networks can combine several people, while changing mobile or privacy addresses can split one person into several. A page answered by the reader's own browser cache, or by a CDN in front of the gateway, never reaches BurrowGate and is not counted. Read both metrics as a floor rather than an exact count of people.

**404s are not readership.** Bloggy always passes `successfulOnly`, so a scan for `/creator/you/wp-admin` and friends, which lands inside your path scope and would otherwise arrive complete with countries and referrers, is dropped before it reaches a chart. The flip side is that genuine broken links do not appear either.

**Scoping** is enforced on Bloggy's server. It fixes `siteId` from configuration and derives the path scope from the signed-in creator's session, so a creator sees only their own pages and cannot widen that by editing the request. The prefix carries no trailing slash, so the blog's index page counts alongside its posts, and the gateway matches the path itself or anything beneath it, which excludes a sibling username sharing a prefix. The token is used server-side only and never reaches the browser. Only a fixed set of views is forwarded, so host telemetry such as CPU and memory is not reachable through Bloggy.

Bloggy **refuses rather than guesses**. BurrowGate reports back which pages it measured, using `pathPrefix` for a whole blog and `path` for a single page, and a reply that does not match what was asked for is thrown away with an error asking the operator to upgrade. A gateway predating these parameters would otherwise silently answer with the whole site, showing one creator everyone else's pages.

The world map ships as a content-fingerprinted panel asset, so it renders without a round trip to the gateway.

Without those variables the page, its nav item and its routes do not exist at all.

## Blog customization

Blog owners can select a light or dark theme, or choose **Custom colors** and set the background, card, text, muted text, border and accent colors with color pickers. The palette applies to the creator home page and every post while Bloggy derives supporting colors for controls and shadows.

The **Advanced customization** section in Settings provides separate HTML layouts for the creator home page and post pages, plus one CSS stylesheet shared by both. Templates arrange server-rendered Bloggy components such as `<bloggy-posts></bloggy-posts>` and `<bloggy-post-content></bloggy-post-content>`, so post data, search, pagination, previews and metadata continue to work. Empty editors use the standard Bloggy layout, and the starter-template button provides a complete editable example.

Advanced HTML is sanitized on the server. Scripts, forms, embedded pages, event handlers, unsafe URLs and document-level elements are rejected because creator pages share an origin with authenticated Bloggy sessions. Custom CSS and each template are limited to 50 kB. Only blog owners can read or update these settings, and saving them invalidates the affected public-page cache immediately.

## Caching

Rendered pages and public API reads are cached in memory (`CACHE_TTL`, default 5 minutes). Repeat visitors get a small "nothing has changed" reply instead of the whole page, and once an entry ages out the old copy is still served while a fresh one is prepared, so nobody waits. Publishing, editing, unpublishing or deleting a post clears that creator's pages plus the shared landing page and sitemap, rather than the whole cache. Browsers revalidate HTML while shared caches can retain it for `CACHE_TTL` seconds through `s-maxage`.

Deploy-time CSS, JavaScript and logo assets use content hashes in their filenames. They are cached for one year with `immutable`, because changed content always receives a new URL. The unversioned public asset paths remain as revalidated aliases for older cached pages. The panel index is generated with its current hashed bundle names during every build.

Nothing is cached for a request that carried credentials, whether a bearer token _or_ the session cookie. Those responses explicitly use `private, no-store`, and public responses vary on both credentials. The cookie half matters. Since the panel is served from this origin, a signed-in creator browsing their own blog sends a cookie and no `Authorization` header, so checking only the header would let a per-viewer response into a cache every reader shares.

Search results are never cached, because anyone can type anything into the box, and caching every phrase would let one visitor fill the store with entries nobody reads twice.

## Security notes

- Passwords are hashed with argon2id, and session tokens are stored only as blake2b hashes, so read access to the database does not let anyone impersonate a creator.
- Post markdown is untrusted input. It is rendered with `Bun.markdown` with raw HTML escaping on, and the generated `href` and `src` attributes are then restricted to `http`, `https` and `mailto`, so neither injected tags nor `javascript:` URLs survive. Everything a creator supplies is HTML-escaped before it reaches a page template.
- Expired sessions are deleted every hour, and session lookups filter on expiry in SQL, so an expired session can never sign anyone in, even before the next cleanup runs.
- The panel is `noindex`, excluded in `robots.txt`, and refuses to be framed.

## Dependencies

Nine Rabbit Company packages and nothing else:

`web` · `web-middleware` · `totp` · `qrcode` · `blake2b` · `xchacha20` · `password-entropy` · `password-generator` · `openmetrics-client`

Everything else is native: `Bun.password` (argon2id), `Bun.markdown`, `Bun.SQL`, `Bun.s3`, `Bun.file`, Bun's bundler for the panel's TypeScript and CSS, and `createImageBitmap` plus a canvas for browser-side image compression.

## Scripts

```bash
bun run dev          # build panel, run server in watch mode
bun run start        # run once
bun run build        # panel bundle + single-file server binary in dist/
bun run build:panel  # panel bundle only
bun run migrate      # apply migrations and exit
bun run keygen       # print fresh secrets for .env
bun run promote      # grant an account administrator rights
bun run demote       # revoke them
bun run test         # unit tests
bun run typecheck    # tsc --noEmit
bun run format       # prettier
```

## Deployment

### Docker

```bash
docker compose up -d
```

The image builds the panel and compiles the server into a single binary, then runs it on a slim Debian base with no Bun and no `node_modules`. Data lives in a volume mounted at `/app/data`, and the health check calls `/health`, which makes a real database round trip rather than only proving the process is alive.

### Standalone binary

`bun run build` produces `dist/bloggy`, a standalone binary, plus `public/panel/`. Ship both, along with `.env` and a writable `data/` directory.

Either way, put Bloggy behind a reverse proxy that terminates TLS, because the session cookie is only marked `Secure` when `DOMAIN` starts with `https://`. Set `TRUST_PROXY` so client IPs are read from the right header, otherwise rate limiting sees the proxy's address for every visitor.

## License

EUPL-1.2. See [LICENSE](LICENSE).
