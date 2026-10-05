# Go-live runbook (no terminal needed)

The stack: **GitHub** holds the code, **Render** runs the app and the database (Singapore region), **Google Cloud** handles sign-in, and **Cloudflare** provides the domain. Expect about 45 minutes the first time and roughly $13–14 a month (Render Starter web service plus Basic Postgres; check render.com/pricing).

> Avoid Render's free tier for this app. The free web service sleeps when idle, and the first load after that takes about a minute — far too slow for someone on a live call. Free Postgres is also deleted after 30 days.

## Step 1: Put the code on GitHub (5 min)
1. Unzip `project-explorer.zip` on your computer. You'll get a folder called `app`.
2. Go to github.com → **New repository**. Name it `project-explorer`, choose **Private**, and click **Create repository**.
3. On the empty repository page, click **uploading an existing file**. Open the `app` folder, select **everything inside it** (not the `app` folder itself), and drag it into the browser. Then click **Commit changes**.
   - GitHub accepts up to 100 files per upload. If it refuses, upload everything except the `docs` folder first, then upload `docs` as a second commit.
4. Check that `render.yaml`, `package.json`, `server/` and `client/` sit at the top level of the repository.

## Step 2: Create the app and database on Render (10 min)
1. Go to render.com and sign up with GitHub. When asked, give Render access to the `project-explorer` repository.
2. Click **New → Blueprint**, then select the `project-explorer` repository. Render reads `render.yaml` and proposes:
   - a Postgres database `project-explorer-db` (Singapore)
   - a web service `project-explorer` (Singapore)
3. When it asks for **GOOGLE_CLIENT_ID**, leave it empty for now and click **Apply**. Add a card when prompted.
4. Wait for the first deploy to finish (about 5 minutes) and show **Live**. On this first boot the app creates its tables and loads reference data plus your 9 Navi Mumbai projects automatically.
5. Copy the web service URL, for example `https://project-explorer.onrender.com`. Opening it now shows "Google sign-in is not configured", which is expected at this stage.

## Step 3: Turn on Google sign-in (10 min)
1. Go to console.cloud.google.com and create a project called `Project Explorer`, signed in with your propertypistol.com account.
2. Open **APIs & Services → OAuth consent screen**:
   - User type **Internal** (this means only PropertyPistol accounts can use it).
   - App name `Project Explorer`, and your email for both support and developer contact.
   - Click **Save**.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorised JavaScript origins**, add the Render URL from Step 2.5 (e.g. `https://project-explorer.onrender.com`). Later you'll also add `https://explorer.propertypistol.com`.
   - Leave redirect URIs empty, then click **Create**.
4. Copy the **Client ID**. It ends with `.apps.googleusercontent.com`.
5. In Render, go to **project-explorer → Environment → GOOGLE_CLIENT_ID**, paste the ID, and click **Save, rebuild and deploy**.

## Step 4: First sign-in (2 min)
1. Open the Render URL and click **Sign in with Google** using hemant.bajaj@propertypistol.com. That email is set as `BOOTSTRAP_ADMIN_EMAILS`, so it becomes Admin automatically.
2. Go to **Admin → Users & roles**. Only your account exists; no demo users are created in production.
3. Click **Approve a new user** for each team member, entering their Google email and role: Sales User, Data Editor or Reviewer.
4. In Render → **Environment**, delete `BOOTSTRAP_ADMIN_EMAILS` and save. From now on, admins are added only from inside the app.

## Step 5: Your own domain through Cloudflare (10 min)
1. In Render → **project-explorer → Settings → Custom Domains → Add**, enter `explorer.propertypistol.com`.
2. In Cloudflare → **propertypistol.com → DNS → Add record**:
   - Type **CNAME**
   - Name `explorer`
   - Target `project-explorer.onrender.com`
   - Proxy status **DNS only** (grey cloud)
3. Back in Render, click **Verify**. Wait until the certificate shows **Issued**, which usually takes a few minutes.
4. Optionally, switch the Cloudflare record to **Proxied** (orange cloud) afterwards. If you do, set **SSL/TLS** mode to **Full (strict)**.
5. In Google Cloud → **Credentials → your OAuth client**, add `https://explorer.propertypistol.com` under **Authorised JavaScript origins** and save. It can take a few minutes to start working.

## Step 6: Before sales starts using it (15 min)
1. **Map tiles.** The default (CARTO/OpenStreetMap) is fine to start with. For heavy daily use:
   - Create a free MapTiler key at maptiler.com.
   - Go to **Admin → Business rules → Map provider** and set the Tile URL to `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY`.
   - Set the attribution to `© MapTiler © OpenStreetMap contributors`.
2. **Verify the 9 migrated projects.** Their map pins are approximate. Open each one under **Projects → Location**, drag the pin to the exact site, and set accuracy to *Verified on site*.
3. Review **Admin → Data quality** and fix the red items.
4. Do a test search on a phone: City → Configuration → Budget, open a project, then open the map.

## Step 7: Daily operations
- **Updating the app.** Edit or upload files in GitHub. Render redeploys automatically after each commit (about 3–5 minutes) with no downtime. Database changes are applied automatically at start-up.
- **Rolling back.** Render → **project-explorer → Events → Rollback** to any previous deploy.
- **Backups.** Paid Render Postgres takes daily backups (Render → **project-explorer-db → Recovery**). Before big imports, also use **Export**.
- **Someone leaves.** **Admin → Users & roles → Deactivate**. They are signed out everywhere immediately.
- **Logs and errors.** Render → **project-explorer → Logs**.

## If something goes wrong
| Symptom | Fix |
|---|---|
| Deploy fails at build | Check Render **Logs** for the build step. It is usually a file missing from the GitHub upload (the `server/package-lock.json` and `client/package-lock.json` files must be there). |
| "Google sign-in is not configured" | `GOOGLE_CLIENT_ID` is empty in Render → Environment. |
| Google button shows "origin not allowed" / error 400 | The exact URL you are on is not listed in **Authorised JavaScript origins**. Add it, then wait 5 minutes. |
| "…is not an approved user" | Approve that email in **Admin → Users & roles**. |
| "Only propertypistol.com accounts can sign in" | The person used a personal Gmail. Sign in with the company account. |
| Custom domain stuck on "Verifying" | The Cloudflare record must be **DNS only** (grey cloud) while Render issues the certificate. |
| Map shows pins but a grey background | The tile provider is blocked or the key is invalid. Check **Admin → Business rules → Map provider**. |
