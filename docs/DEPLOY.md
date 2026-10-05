# Go-live on Cloudflare (no terminal)

**Where things run:**
- **Cloudflare Workers** serves the website and the API. Static files are served by Workers Static Assets.
- **Neon** hosts the Postgres database, in the Singapore region.
- **Cloudflare Hyperdrive** keeps database connections fast from Cloudflare's edge.
- **GitHub** holds the code, and Cloudflare deploys every commit automatically.

**Cost:** Workers Paid is about $5/month. It's needed because the free plan's 10 ms CPU limit is too tight for this API. Neon's free tier is enough to start.

**Time:** about 45 minutes.

> Cloudflare **Pages** on its own only serves static files. This app also needs an API and a Postgres database, which is why it uses Workers (the same "Workers & Pages" area of the dashboard) together with Neon.

## Step 1: Code on GitHub (5 min)
1. Unzip `project-explorer.zip`.
2. On github.com, create a new repository called `project-explorer` and make it **Private**.
3. Click **uploading an existing file** and drag in everything *inside* the `app` folder. Commit.
   - GitHub accepts at most 100 files per upload. If it refuses, upload everything except `docs` first, then upload `docs` on its own.

## Step 2: Database on Neon (5 min)
1. Go to neon.tech and sign up (Google sign-in works).
2. Create a **New project**:
   - Name: `project-explorer`
   - Postgres version: **16**
   - Region: **AWS Asia Pacific (Singapore)**
3. On the project dashboard, click **Connect**. Turn **Connection pooling OFF** and copy the connection string. It looks like `postgresql://neondb_owner:…@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.

## Step 3: Hyperdrive on Cloudflare (3 min)
1. In the Cloudflare dashboard, go to **Storage & Databases → Hyperdrive → Create configuration**.
2. Name it `project-explorer-db`, paste the Neon connection string, and click **Create**.
3. Copy the configuration **ID** (a long hex string).
4. In GitHub, open `wrangler.jsonc` and click the ✏️ pencil to edit. Replace `PASTE_HYPERDRIVE_ID_HERE` with the ID, then **Commit changes**.

## Step 4: Workers Paid plan (2 min)
In Cloudflare, go to **Workers & Pages → Plans** and choose **Workers Paid** ($5/month).

## Step 5: Deploy the app (10 min)
1. Go to **Workers & Pages → Create → Import a repository**, connect GitHub, and pick `project-explorer`.
2. Fill in the settings:
   - **Project name:** `project-explorer`
   - **Build command:** `npm --prefix server ci && npm --prefix client ci --include=dev && npm --prefix client run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/` (leave as is)
3. Click **Deploy** and wait 3–5 minutes for it to finish.
4. Copy the URL, e.g. `https://project-explorer.<your-subdomain>.workers.dev`.
5. Open `https://…workers.dev/api/health` once. **On the very first open the app creates its database tables and loads your 9 Navi Mumbai projects, which can take up to a minute.** When it finishes you'll see `{"ok":true}`; if the page times out, just refresh.

## Step 6: Google sign-in (10 min)
1. Go to console.cloud.google.com, signed in with your propertypistol.com account, and create a project called `Project Explorer`.
2. Open **APIs & Services → OAuth consent screen** and set:
   - User type **Internal**
   - App name: Project Explorer
   - Support and contact email: yours
   - Then **Save**.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**.
   - **Authorised JavaScript origins:** add the workers.dev URL now. You'll add your own domain in Step 7.
   - Click **Create** and copy the **Client ID**.
4. In Cloudflare, go to **Workers & Pages → project-explorer → Settings → Variables and Secrets → Add**:
   - Type **Secret**, name `GOOGLE_CLIENT_ID`, value = the Client ID.
   - Click **Deploy**.
5. Open the workers.dev URL and sign in with hemant.bajaj@propertypistol.com. You are the Admin.
6. Go to **Admin → Users & roles → Approve a new user** and add each team member with their role.
7. In GitHub, edit `wrangler.jsonc` and delete the line `"BOOTSTRAP_ADMIN_EMAILS": "hemant.bajaj@propertypistol.com",`, then commit. It redeploys automatically.

## Step 7: Your domain (3 min)
Because propertypistol.com is already on Cloudflare, this step is just clicks:
1. Go to **Workers & Pages → project-explorer → Settings → Domains & Routes → Add → Custom domain** and enter `explorer.propertypistol.com`. Cloudflare creates the DNS record and SSL certificate itself.
2. In Google Cloud → **Credentials → your OAuth client**, add `https://explorer.propertypistol.com` to **Authorised JavaScript origins** and save. Allow about 5 minutes for it to take effect.
3. If an old `explorer` DNS record already exists in Cloudflare DNS, delete it first.

## Step 8: Before sales starts
1. The 9 migrated projects have approximate pins. For each one, go to **Projects → Location**, drag the pin to the exact spot, and set **Verified on site**.
2. Go to **Admin → Data quality** and fix the red items.
3. Do a phone test: City → Configuration → Budget → open a project → open the map.
4. For heavy map use, get a free key at maptiler.com and set it in **Admin → Business rules → Map provider**:
   - Tile URL: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=KEY`

## Day-to-day
- **Updating the app:** edit or upload files in GitHub. Cloudflare redeploys automatically in about 3 minutes.
- **Rolling back:** go to **Workers & Pages → project-explorer → Deployments**, pick an earlier version, and choose **Rollback**.
- **Logs:** **Workers & Pages → project-explorer → Observability / Logs**.
- **Backups:** Neon keeps restore history (6 hours on the free plan, longer on paid). Use **Neon → Branches/Restore**.
- **Someone leaves:** **Admin → Users & roles → Deactivate**. They are signed out immediately.
- **Admin changes:** changes to filters, bands or fields reach every user within about 20 seconds (`META_CACHE_TTL_MS`).

## If something goes wrong
| Symptom | Fix |
|---|---|
| Build fails | The build log shows the step that failed. Usually a file was missed in the GitHub upload; check that `server/package-lock.json` and `client/package-lock.json` are there. |
| Deploy fails with an "invalid Hyperdrive id" error | `wrangler.jsonc` still has `PASTE_HYPERDRIVE_ID_HERE`, or the ID was pasted wrongly. |
| `/api/health` shows "Database is not connected" | The Hyperdrive binding is missing. Redo Step 3. |
| `/api/health` shows a password or SSL error | The Hyperdrive configuration holds a wrong connection string. Edit it in Cloudflare → Hyperdrive. |
| "Google sign-in is not configured" | The `GOOGLE_CLIENT_ID` secret is missing (Step 6.4). |
| The Google button says the origin is not allowed | The exact URL you are on is not in **Authorised JavaScript origins**. |
| "…is not an approved user" | Approve that email in **Admin → Users & roles**. |
| The first page of the day is slow (about 1 s) | Neon's free tier sleeps after 5 minutes idle. Upgrade Neon, or set its *scale to zero* option to off on a paid plan. |
