# Project Explorer — lightweight GitHub prototype

A static web app (plain HTML + CSS + JavaScript, no build step, no backend) that replaces the
Excel *Project Explorer Dashboard – Navi Mumbai* for sales executives.
Data lives in JSON files in `/data`. GitHub is the source of truth; GitHub Pages hosts it for free.

> **Prototype authentication — suitable for controlled internal prototype use, not production security.**

---

## 1. Repository structure

```
index.html              single page; loads the scripts below
css/styles.css
js/utils.js             data loading, formatting, shared table editor, password hashing
js/auth.js              login / logout / roles
js/filters.js           builds filters from data/filters.json + filtering logic
js/dashboard.js         filters + map + matching projects + project card
js/project-details.js   Detailed Overview page (sections come from data/fields.json)
js/editor.js            add / edit project wizard (draft auto-save, shared tower details)
js/validation.js        validation rules, duplicate check, data-quality report
js/admin.js             users, projects, master data, filters, bands, data quality, audit, publish
js/app.js               router
data/
  projects.json         one object per project (strongly structured fields + bullet lists)
  configurations.json   one row per configuration variant  -> project_id
  towers.json           one row per tower (or one "Project Level" row) -> project_id
  developers.json       developer master
  locations.json        { cities: [...], locations: [...] }  (location -> city, with lat/lng)
  master-data.json      settings + dropdown lists (configurations, launch stages, statuses …)
  filters.json          dashboard filter definitions
  bands.json            price / carpet / elevation bands
  fields.json           project fields & sections (editor steps + detailed overview)
  users.json            users (salted password hashes, never plain text)
  audit-log.json        prototype audit trail
tools/excel_to_json.py  optional: regenerate project data from the Excel workbook
```

Relationship: **Developer → Project → Configurations** and **Project → Towers**.
A tower is *not* forced under a configuration (one tower can hold many configurations); a tower may
optionally list its configurations in `"configurations": ["2 BHK","3 BHK"]`.
For future unit-level inventory add `floors.json` / `units.json` keyed by `tower_id` — nothing existing has to change.

## 2. Run locally

The app fetches JSON files, so it must be served over HTTP (double-clicking `index.html` will not work):

```
cd project-explorer
python -m http.server 8000
```
Open http://localhost:8000 . Login works on `localhost` and `https://` only (browser crypto requirement).

### Starting logins — change these immediately (Admin → Users → Reset password)

| User ID | Password | Role |
|---|---|---|
| admin | Admin@123 | Admin |
| editor01 | Editor@123 | Editor |
| sales01 | Sales@123 | Sales |
| olduser | Old@123 | Sales (disabled — for testing) |

## 3. Deploy on GitHub Pages

1. Create a repo (e.g. `project-explorer`) and upload the **contents** of this folder (GitHub web: *Add file → Upload files*, drag everything in, Commit).
2. Repo → **Settings → Pages** → *Source: Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
3. After ~1 minute the site is live at `https://<your-user>.github.io/project-explorer/`.
4. Every commit to `main` re-deploys automatically (1–2 minutes).

**Important — visibility.** Free GitHub Pages needs a **public** repo, which means anyone with the URL of
`data/projects.json` can read the data (including internal notes / SPOC numbers) without logging in.
Options, no code change needed:
- GitHub Pro/Team (paid) → Pages from a private repo; or
- **Cloudflare Pages (free)** connected to the same *private* GitHub repo + **Cloudflare Access (free up to 50 users)** in front of it — this gives real login protection for the whole site including the JSON files. Build command: none; output directory: `/`.

## 4. How the data flows (and the static-site limitation)

There is no server, so the browser cannot write to GitHub by itself:

```
Admin/Editor edits in the UI ─► saved in that browser only ("working copy", orange banner)
        │
        ├─ Admin: Admin → Publish / Export → "Commit to GitHub"   (uses a GitHub token, optional)
        │          or download the changed JSON files and upload them to /data on GitHub
        └─ Editor: "Submit changes" → downloads a change file → sends to Admin
                   Admin → Publish / Export → Import a change file → publish
        ▼
GitHub commit ─► GitHub Pages redeploys ─► everyone sees the update
```
- Two people editing at once do not merge automatically — last published file wins. Fine for a prototype with one Admin publishing.
- **Commit to GitHub** needs a fine-grained personal access token (GitHub → Settings → Developer settings → Fine-grained tokens → this repo only → *Contents: Read and write*). It is used only in that browser tab and not stored.

## 5. Data-maintenance guide (no JavaScript needed)

Edit on GitHub (open file → ✏️ pencil → edit → *Commit changes*) **or** use the Admin screens and publish.
JSON tips: keep the commas between `{ … }` objects, use `null` for unknown, numbers without quotes, and no trailing comma after the last item.

| I want to… | Edit | Example |
|---|---|---|
| Add a project | `data/projects.json` | copy an existing project block, give a new `project_id` (e.g. `P010`). Easier: **Add project** in the app |
| Add configuration rows | `data/configurations.json` | `{ "configuration_id": "P010_2_1", "project_id": "P010", "configuration": "2 BHK", "carpet_from": 750, "carpet_to": 850, "price_from": 12000000, "price_to": 14000000, ... }` |
| Add towers | `data/towers.json` | `{ "tower_id": "P010_T1", "project_id": "P010", "tower_name": "A", "floors_above_ground": 40, ... }` |
| Add a developer | `data/developers.json` | `{ "developer_id": "DEV008", "name": "Lodha", "active": true }` |
| Add a city | `data/locations.json` → `cities` | `{ "city_id": "PUNE", "name": "Pune", "active": true }` |
| Add a location | `data/locations.json` → `locations` | `{ "location_id": "WAKAD", "city_id": "PUNE", "name": "Wakad", "lat": 18.598, "lng": 73.765, "active": true }` |
| Add a configuration type (5 BHK, Penthouse…) | `data/master-data.json` → `configurations` | `{ "value": "6 BHK", "code": "6", "order": 11, "active": true }` |
| Add a master value (status, stage, EOI type) | `data/master-data.json` → the list | `{ "value": "Ready to Move", "active": true }` |
| Change price bands (₹80L–1Cr → ₹75L–1Cr) | `data/bands.json` → `price` | set `"lower": 7500000` and update `"label"` |
| Add a band (₹7–10 Cr) | `data/bands.json` → `price` | `{ "label": "₹7 – 10 Cr", "lower": 70000000, "upper": 99999999, "order": 9, "active": true }` |
| Change carpet bands | `data/bands.json` → `carpet` | numbers in sq.ft.; `null` = open-ended |
| Disable a filter (e.g. Elevation) | `data/filters.json` | `"active": false` |
| Reorder filters | `data/filters.json` | change `"order"` numbers (Configuration first → give it `0`) |
| Add a filter (e.g. Land Parcel) | `data/filters.json` | already included, just set `"active": true`. Pattern below |
| Add a project field (e.g. Clubhouse Area) | `data/fields.json` | add `{ "key": "clubhouse_area", "label": "Clubhouse Area", "type": "text" }` to a section — it appears in the editor and the Detailed Overview |
| Add a user | Admin → Users (then publish `users.json`) | passwords are hashed in the browser; never type them into JSON |
| Stale-data threshold, map centre, title | `data/master-data.json` → `settings` | `"stale_after_days": 60` |

Rules worth knowing
- **Prices** are full rupees (₹1.25 Cr = `12500000`); **carpet** in sq.ft.; possession as `"YYYY-MM"`.
- A single price/carpet: put the same number in *from* and *to*. A range: different numbers.
- **Blank is never zero:** `null` → "Not Provided", `"Unknown"` → Unknown, `"N/A"` → Not Applicable, `false` → No.
- Bullet-type fields (amenities, USPs, connectivity, offers…) are lists: `["Pool", "Gym"]`.
- `lat`/`lng` per project drive the map pin; if missing, the location's lat/lng is used. Current pins are **approximate** (`"coords_approx": true`) — please verify.

### Filter definition reference (`data/filters.json`)

```json
{ "key": "land_parcel", "label": "Land Parcel", "type": "range", "level": "project",
  "field": "land_parcel_acres", "min": 0, "max": 600, "step": 1, "unit": "acres", "order": 14, "active": true }
```
| property | meaning |
|---|---|
| `type` | `select` (checkbox list) or `range` (dual slider) |
| `level` | `project` – tests the project; `configuration` – all configuration filters must match **the same** configuration row |
| `field` / `field_to` | data field to test; for ranges on configurations, `field`=from, `field_to`=to (overlap test) |
| `source` (select) | `cities`, `locations`, `developers`, `values` (distinct values in data), `master:<list>`, `bands:<kind>` |
| `depends_on` | parent filter key (City → Location → Sub-location cascade) |
| `bands` | adds quick-select band chips from `bands.json` |
| `unit` | `INR`, `sq.ft.`, `year`, anything else is shown as text |
| `also_matches` | e.g. `{"Residence": ["Both"]}` — picking Residence also returns "Both" projects |

Computed fields usable in filters: `_dev_year`, `_rera_year` (from possession), `_elevation` (from tower floors via elevation bands).
Range filters at full extent mean "Any". Once narrowed, records with no value (e.g. no possession date) are excluded.

**How price/carpet matching works:** a customer looking for *3 BHK, ₹1–1.3 Cr* only matches a project if one of its **3 BHK** rows overlaps ₹1–1.3 Cr. A project whose 2 BHK is ₹1 Cr but 3 BHK is ₹1.5 Cr is not shown. The results table shows only the configuration rows that matched.

## 6. Roles

| | Admin | Editor | Sales |
|---|---|---|---|
| Search, filter, view projects | ✓ | ✓ | ✓ |
| Internal notes | ✓ | ✓ | – |
| Add / edit projects, configurations, towers | ✓ | ✓ (submits a change file) | – |
| Archive projects, users, master data, filters, bands, data quality, audit, publish | ✓ | – | – |

## 7. What was migrated from the workbook

9 real projects, 62 configuration rows, 33 tower rows from ProjectMaster / ConfigurationMaster / TowerMaster, plus 2 clearly-marked **[SAMPLE]** projects for testing (price/carpet ranges with overlaps, Penthouse, Pune city, Mid-rise tower, an incomplete & stale project). Delete them from the JSON files when no longer needed.
Fixes applied: Godrej Kharghar tower names that Excel had turned into dates (now 1/9 … 5/9) and their duplicate IDs; "Khargar" → Kharghar; RERA numbers moved out of "About Developer" into `rera_numbers`; blank Developer Possession kept blank (the Excel showed 00:00); Land Parcel also stored as a number (`land_parcel_acres`) so it can be filtered.

## 8. Known prototype limitations

- **Security:** login is checked in the browser. Hashes are salted PBKDF2 (100k rounds) but a determined user can bypass the login screen or read the JSON files directly. Treat it as an access *convenience*, not a security boundary.
- **Data visibility on public Pages** — see §3.
- **No live sync:** edits are per-browser until published; no concurrent-edit merge.
- **Audit log** is written by the browser and stored in a normal file — useful history, not tamper-proof.
- **Map tiles** come from the free OpenStreetMap tile server (fair-use policy: fine for an internal tool with light traffic; no API key). For heavier use switch the tile URL in `js/dashboard.js` to another provider.
- Map pins are approximate until verified.

## 9. Upgrade path (when the prototype is proven)

1. Protect the site: Cloudflare Pages + Cloudflare Access (free tier) — no code change.
2. Real multi-user editing: move `/data` into a small database (e.g. Cloudflare D1 or Supabase) behind a thin API; the front-end already reads everything through `loadData()` / `saveLocal()` in `js/utils.js`, so only those two functions need replacing.
3. Server-side auth & immutable audit log come with step 2.
4. Unit-level inventory: add `floors`/`units` keyed by `tower_id`.
