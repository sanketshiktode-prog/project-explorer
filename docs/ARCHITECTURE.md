# Architecture

## 1. What the Excel prototype does

*5.2 Project Explorer Dashboard – Navi Mumbai.xlsm* is a live-call search tool. A salesperson narrows projects with eight slicers: Location, Configuration, Price Band, Carpet Band, Project Status, Launch Stage, Developer Possession Year and Purpose of Purchase. The workbook then:

1. filters a hidden `DashboardSource` table that holds **one row per configuration** (62 rows built from the masters with XLOOKUP);
2. shows or hides hand-drawn shapes named `Map_P001`… on a Google Maps **screenshot** through VBA (`UpdateProjectMap`, using `SUBTOTAL(103)` visibility);
3. lists the visible configuration rows under "Matching projects";
4. when a row or a map shape is clicked, writes `"P003 - Godrej City Panvel"` into `ProjectDetails!B2` (VBA `SelectDashboardProject` / `SelectMapProject`), and dozens of `XLOOKUP(LEFT(B2,4), …)` formulas fill the right-hand panel: configurations, towers, possession, EOI and text blocks;
5. offers a "Detailed Overview" button that jumps to the full `ProjectDetails` sheet.

## 2. What was found in the workbook

| Sheet | Content |
|---|---|
| Dashboard | 8 slicers (top-left), a map screenshot with 9 shape groups (centre), a project-details panel (right: ID, name, developer, location, sub-location, landmark, a configurations table, tower information, possession, purpose, stage, status, land parcel, open space, EOI), and "Matching projects" (bottom: a project/config/carpet/price/₹ psf/possession row per configuration, via `AGGREGATE(15,6,…)` array formulas) |
| ProjectDetails | The same blocks at full size, plus 11 text sections (connectivity, location advantages, amenities, USPs, payment plans, offers, about developer, objection handling, remarks) mirrored into text boxes `PD_Info_46…56` |
| ProjectMaster | 9 projects × 34 columns (`tblProjectMaster`); IDs `P001…P009` |
| ConfigurationMaster | 62 rows; IDs like `P003_2_1` (project + type code + sequence); calculated ₹/sq.ft. = Price ÷ Carpet; displayed ₹/sq.ft. = developer figure if present, otherwise calculated |
| TowerMaster | 34 rows; "Information Scope" = *Project Level* (one row standing for all towers) or *Tower Specific*; Elevation Band looked up from floors |
| Lists (hidden) | Dropdown sources: purpose, stage, status, configuration + code, inventory status, scope, **two different sets of price/carpet bands**, elevation bands, EOI types, and slicer helper lists |
| DashboardSource (hidden) | The flattened row-per-configuration table that drives slicers, list and map |
| VBA | `Sheet1_SelectionChange` (row click → select project by **name**), `Module1` (map show/hide, highlight, info text boxes), `Sheet7_Calculate` (re-runs the map on every recalculation) |

**Fragile or broken in the prototype**

- **Bands defined twice, and the two definitions disagree.** `Lists!H:M` has `<80L … 6Cr<` and carpet `<300 … 2500<`. The slicers actually use a hard-coded `IF` chain in `DashboardSource!R:S` (`Below 750 Sqft`, `750–1,000`…). Editing the Lists sheet changes nothing.
- **Typos break filters.** Location `Khargar` (should be Kharghar). "Sub-Location" mixes sectors, roads and addresses ("Off Old Mumbai-Pune Highway, Khanawale, Panvel"), so it cannot be used as a filter.
- **Excel changed data on entry.** Godrej Kharghar's tower names were stored as dates (`46031` = 9 Jan 2026), because "1/9" was auto-converted.
- **The map is a screenshot.** Every new project needs a hand-placed shape, and there are no coordinates anywhere.
- **Fragile IDs.** Project ID parsing uses `LEFT(B2,4)`, which breaks at P1000. Row-click selection looks projects up **by name**, which breaks on renames and duplicate names.
- **Text blobs.** Amenities, USPs, connectivity, offers, payment plans and objections are bulleted text in single cells. Offers have no dates, so expired offers can't be hidden. Objections are placeholders ("Project area: How to handle?").
- **Blank, N/A and No are indistinguishable.** For example, L&T Panvel has EOI Type = N/A but EOI Remarks = "2 Lakhs Cheque".
- **Mixed tower scopes.** "Project Level" and "Tower Specific" rows share one table with different meanings.
- **Plot rows hold plot area in "Carpet".**
- The data shows the expected pattern of developer possession earlier than RERA possession. The opposite would be the anomaly (see validation).

## 3. Retained

- The screen layout: filters on the left, results, map, details on the right.
- **Configuration-level rows** (the prototype's best idea).
- "Quick summary first, detail on selection" and a separate Detailed Overview.
- Developer ₹/sq.ft. versus calculated ₹/sq.ft., with "developer first" as the default rule.
- Inventory status per configuration.
- Tower table with elevation bands.
- Bands as numeric bounds with labels.

## 4. Redesigned

| Prototype | Application |
|---|---|
| Two conflicting band lists plus a hard-coded IF chain | `band_sets` / `band_definitions` tables, used by both the chips and the matching engine |
| Screenshot + VBA shapes | Leaflet with marker clustering on real lat/lng; the tile provider is a setting |
| `DashboardSource` + slicers | Server-side SQL over indexed tables (`search.js`) |
| `LEFT(B2,4)` IDs, selection by name | Surrogate keys + a permanent `public_id` (`PRJ-MUM-000001`) that never depends on the name |
| Text blobs | Child records: `project_highlights`, `payment_plans`, `offers` (with dates), `objections` (Q&A), `project_amenities` (catalogue + remarks), `project_rera` |
| "Project Level" tower rows | A tower row with `represents_count` > 1 ("typical tower × N") |
| Worksheet lists | `master_lists` / `master_values` + dedicated tables for hierarchy, developers and configuration types |
| Formulas | Backend logic (`computeCalcPsf`, generated columns, validation service) |
| Free-text sub-location | City → Location → Sub-location masters; the old text survives as `locality` |

## 5. Requirements added beyond the brief

- **Two statuses, not one.** *Record status* is the workflow (draft…archived) and is a fixed enum because application logic depends on it. *Project status* is the sales status (Active, Limited, Sold out…) and is master data.
- **RERA registrations as records.** One project can have several, by phase or tower.
- **Previous names (aliases).** A rename keeps the same project, and both search and duplicate detection still find the old name.
- **Phases.** `parent_project_id` links phase records of a township.
- **Price on request** as an explicit flag, so it is never confused with a missing price.
- **Area basis.** Configuration types carry an area label ("Plot Area" for plots), and ₹/sq.ft. records its basis (carpet or SBUA).
- **Field-level conflict detection.** Two people editing different fields both succeed.
- **Server-side sessions**, so deactivating a user takes effect immediately.
- **Coordinate accuracy** (not checked / approximate / verified) and a distance-from-city sanity check.
- **Developer merge** for duplicate developers.
- **Generic objection library** (answers not tied to one project).

## 6. Technology and why

| Choice | Reason |
|---|---|
| **PostgreSQL 16** | Real foreign keys and constraints (data integrity), fast indexed range queries, JSONB for admin-defined custom fields with GIN indexes, `pg_trgm` for fuzzy duplicate detection and search, generated columns, and transactions. Mature, free, and available on every host. |
| **Node.js 22 + Express** | One language across front and back end, a small dependency surface, and simple to deploy as one process that also serves the built client. Express is the most widely known Node framework, so it is easy to hand over. |
| **React 18 + Vite** | Component model suits metadata-driven forms and filters. Vite produces a static bundle. No server-side rendering is needed for an internal tool. |
| **Leaflet + markercluster** | Mature and free, with clustering built in. Tile provider agnostic, so OSM/CARTO can be swapped for MapTiler, Mapbox or Google through a setting. |
| **Google Identity Services** | The ID token is verified on the server with `google-auth-library`. Access requires an approved row in `users`; an optional Workspace domain restriction can be added. |
| **node:test + supertest** | Built in, no extra test framework. |

Not chosen: an ORM (it would hide the SQL that matters for the matching engine), a separate search engine (Postgres is enough at thousands of projects), and a "no-code" backend (it would be too weak for integrity and auditing).

## 7. Architecture

```
            ┌──────────────── Browser ────────────────┐
            │ React SPA                                │
            │  Explorer · Wizard · Review · Admin      │
            │  (renders filters/forms from metadata)   │
            └───────┬──────────────────────┬───────────┘
                    │ JSON over HTTPS      │ map tiles (configurable)
            ┌───────▼──────────────────────┴───────────┐
            │ Node API (Express)                        │
            │  auth (Google ID token → session cookie)  │
            │  permissions per route                    │
            │  services: search · records · projects ·  │
            │            validation · import · meta     │
            │  in-memory metadata cache (invalidated on │
            │  every admin change)                      │
            └───────┬───────────────────────────────────┘
                    │ SQL (parameterised; no browser access)
            ┌───────▼───────────────────────────────────┐
            │ PostgreSQL                                 │
            │  core tables · metadata · audit_log        │
            └────────────────────────────────────────────┘
```

The database is never exposed to the browser. Every write goes through `records.js`, which validates against the entity registry, checks conflicts, and writes the audit log in the same transaction.

## 8. Database schema

All tables are defined in `server/db/migrations/001_schema.sql`.

**Conventions:** money is stored as `BIGINT` rupees (₹1.35 Cr = 13500000), areas as `NUMERIC` sq.ft. and land as acres. `NULL` means *not provided*; `field_states` JSONB records why a value is empty (`na` or `unknown`). Every user-edited row has `row_version`, created/updated by/at, and `is_active` or `record_status`.

| Group | Tables | Notes |
|---|---|---|
| Identity & access | `roles` (permissions[]), `users`, `sessions` | New roles are rows; permissions are a fixed catalogue in code |
| Rules | `app_settings` | Matching rules, ₹ psf rule, stale days, visible statuses, duplicate sensitivity, map provider, ID format |
| Masters | `cities` (code used in IDs) → `locations` → `sub_locations`; `developers` (aliases, merge); `configuration_types` (category, bedrooms, area label); `amenities` (by category); `master_lists` + `master_values` (purpose, launch stage, sales status, EOI type, inventory status, amenity category, plus any new list) | `master_values.meta` holds behaviour flags (e.g. `shows_investment_usp`, `excludes_from_match`) |
| Core | `projects` | Typed columns for stable data. `dev_possession_year` / `rera_possession_year` are generated. `attributes` JSONB holds custom fields |
| | `project_configurations` | Ranges for carpet, SBUA and price; `price_on_request`; `dev_psf` (never overwritten); `calc_psf` + `psf_basis`; generated `price_min/max`, `carpet_min/max` for matching |
| | `towers`, `configuration_towers` | Final values per tower; `represents_count` for "typical tower × N"; configuration ↔ tower availability |
| Content | `project_highlights` (connectivity, location advantage, residential USP, investment USP), `payment_plans`, `offers` (start/end), `objections` (project or generic), `project_amenities`, `project_rera`, `project_aliases` | One row per item |
| Metadata | `field_definitions`, `filter_definitions`, `band_sets`, `band_definitions` | Drive the UI and the matching engine |
| History | `audit_log`, `verifications`, `import_batches` | Append-only history; staged imports |

**Differences from the suggested list, and why**

- *Offers, payment plans, connectivity, USPs, objections, EOIs.* Connectivity, location advantages and both USP types share one `project_highlights` table with a `kind`: they have the same shape (text + optional time/distance) and one table keeps the UI generic. EOI stays on `projects` because a project has one current EOI, and its history is in `audit_log`.
- *Master data.* Small enumerations share `master_lists` / `master_values`, so a new dropdown needs no table. Entities with their own attributes or relationships (cities/locations, developers, configuration types, amenities) get dedicated tables.
- *Tower configurations* is a link table (`configuration_towers`), not a copy of configuration data, so price and area live in one place.

**Indexes for speed:** configuration matching `(config_type_id, price_min, price_max, carpet_min, carpet_max) WHERE is_active`; project location/status/developer/possession; trigram GIN on project and developer names and aliases; GIN on `attributes`; and an audit index by project and time.

## 9. The matching engine (`server/src/services/search.js`)

Each active filter definition is resolved through a **whitelisted source** (`filterSources.js`) into SQL fragments. Values are always bound parameters.

| Level | Sources | Semantics |
|---|---|---|
| Project | city, location, sub-location, developer, purpose, stage, sales status, possession years, land, open space… | Hard filter (`WHERE`) |
| Tower | floors (elevation band), flats per floor, lifts | Hard filter: `EXISTS` over the project's active towers |
| Configuration | configuration type, price, carpet, ₹ psf, inventory status, custom configuration fields | **Graded per configuration row** |

For each configuration row, each criterion scores **2 = exact, 1 = partial, 0 = none**:

- *Range criteria* (price, carpet): exact when the configuration's range lies inside the requirement (setting `range_exact_rule`: `contained` or `overlap`). Partial when the ranges overlap, or when the configuration is within `tolerance_pct` (default 10%) outside it. Missing values score `missing_value` (partial by default, so a project is never hidden only because data is missing).
- *List criteria* (configuration type, custom selects) score 2 or 0.
- A configuration's score is the **lowest** of its criteria, so all of them must hold *for the same configuration*. A project's score is the **highest** of its configurations. This is what stops "3 BHK at ₹1.5–2 Cr" plus "2 BHK at ₹90 L" from matching "3 BHK, ₹1–1.3 Cr".
- Filters marked `hard` must score 2. Sold-out inventory (`excludes_from_match`) scores 0.
- A project with **no configurations ever entered** counts as "missing data" (partial). A project whose configurations were all discontinued scores 0.

Results are paginated in SQL. The map query returns light points only (id, name, lat/lng, status). A second query returns per-criterion scores for the page's configurations, and the server turns them into plain-language reasons ("Price ₹2.09–2.47 Cr — is 5% above ₹1–2 Cr"). On the seed data, typical searches take 15–30 ms.

## 10. Flexibility: what is configuration and what is code

| Change | How |
|---|---|
| New city, location, developer, configuration type (Villa), launch stage… | Admin → Master data (rows) |
| Change "₹1–1.5 Cr" to "₹1–1.25 Cr" | Admin → Bands (row edit). Search uses the new bounds immediately; stored prices are untouched |
| New filter on an existing or custom field ("Floor Preference") | Admin → Fields (add a custom field, e.g. select with a new dropdown list) → Admin → Filters (add a filter with source `config.attr.floor_preference`) |
| Hide "Land Parcel" on the quick card but keep it in detail | Admin → Fields → untick *Card* |
| New project field ("Clubhouse Area") | Admin → Fields → add a custom field. It appears in the wizard (its section), the summary or detail views (ticks), import mapping, and the filter source list (if numeric or select) |
| Matching strictness, ₹ psf display, stale period, visible statuses, duplicate sensitivity, map provider, ID prefix | Admin → Business rules |
| New role (e.g. "Regional lead") | Admin → Users & roles → New role (tick permissions) |

**What stays in code, deliberately:** core columns (name, location, possession, prices, areas, tower floors…), the workflow states, and the permission catalogue. These carry integrity rules, indexes and application behaviour. Turning them into generic key-value data would make filtering slow and validation weak.

**Hybrid custom fields.** Custom fields live in typed JSONB `attributes`. Values are coerced on write according to their `field_definitions` row, so a number is stored as a number. A field's type cannot change once data exists. Custom select, multiselect and numeric fields are filterable through the same engine.

**Promoting a custom field to a core column** later is a small migration: add the column, copy `attributes->>'key'`, and register the column in `registry.js` and `filterSources.js`.

## 11. UI architecture

- **Explorer** (`/`): filters rail · results · map + drawer. The URL stores the whole search (`?s=…`), so searches can be bookmarked or shared. On mobile the screen becomes Filters / List / Map tabs.
- **Detailed Overview** (`/p/PRJ-…`): every section, location, phases and previous names. Printable.
- **Projects** (`/manage`): status tabs with counts. The Review queue is the *Under review* tab.
- **Wizard** (`/manage/:id?step=…`): 10 steps. Project fields share one draft across steps (unsaved changes survive navigation), and child records save item by item. A validation panel is always visible.
- **Admin** (`/admin/*`): data quality, master data, filters, bands, fields, business rules, users & roles, bulk import, audit log.

Everything the UI renders for filters and custom fields comes from `/api/explorer/config` and `/api/reference`. No filter, band or custom field is hard-coded in the client.

## 12. Concurrency, deletion and safety

- **Field-level optimistic locking.** Clients send `{field: {from, to}}`. The server compares `from` with the current value for each field. If user A changes the price and user B the possession, both succeed. If both change the price, B gets `409` with *base / theirs / yours* and chooses "Keep theirs" or "Overwrite with mine" (the overwrite is audited). Admin edits use whole-row `row_version`.
- **Soft delete everywhere.** Configurations and towers are *discontinued* (`is_active=false`) and offers and plans deactivated. Highlights are deleted with a full snapshot in the audit log. Projects are deactivated or archived and can be restored. Permanent deletion is admin-only, for never-published drafts, and requires typing the project name. A snapshot is kept in the audit log.
- **Master data in use** cannot be deleted, only deactivated. Old projects keep the inactive value, and new entry cannot pick it.
- **Security.** Google ID tokens are verified server-side. Sessions are random 256-bit tokens stored hashed, in httpOnly SameSite=Lax cookies. A CSRF header is required on writes. Helmet sets the CSP. Every SQL value is parameterised, and filter sources are whitelisted. Sign-in is rate-limited. Sales users never receive internal notes or data-source fields.

## 13. Error scenarios (spec §54)

| Scenario | Handling |
|---|---|
| Duplicate project | Trigram name + alias similarity, same developer, same sub-location and ≤ 400 m distance give a score. Above the threshold, creation returns 409 with candidates: *Open existing* / *Create anyway (reason, audited)* / *Cancel*. Imports run the same check per row. The data-quality dashboard lists likely pairs |
| Duplicate developer | Normalised name (drops "Group", "Realty", "Ltd"…) is unique. Similar names need confirmation. Admins can merge (projects move, old name becomes an alias) |
| Renamed project | Same ID; the old name goes to `project_aliases`; search and duplicate checks use aliases |
| Cancelled / inactive project | Sales status "Cancelled" + record status Inactive with a reason. Hidden from sales and restorable |
| New / deleted / changed tower | Bulk create; soft remove and restore; per-field audit |
| New / discontinued configuration | Add or copy; discontinue with a reason (drops out of matching, stays in history) |
| Changed price | Audited with old and new values. The configuration's calculated ₹ psf is recomputed; the developer figure is unchanged |
| Missing price | Warning in validation, data-quality list; partial match in search (configurable) |
| Price on request | Explicit flag. Shown as "On request" and treated as missing data for matching |
| Missing area | Warning; ₹ psf not calculated; partial match for area criteria |
| Changed possession | Audited; validation re-checks developer versus RERA dates |
| Missing RERA | Info at save, data-quality list |
| Completed project | Warning when the RERA date has passed and the status isn't Completed or RTM |
| Multiple phases | Separate records linked by `parent_project_id`, or tower `phase` within one record |
| Different tower characteristics | Per-tower values; the editor highlights values that differ from most towers |
| Different parking by configuration | `parking_count` + remarks per configuration; tower parking remarks; project parking structure |
| Expired offers | Hidden from sales automatically (end date < today); counted in data quality |
| Changed EOI | Audited. A conflicting EOI (N/A plus details) raises a warning |
| Missing or incorrect coordinates | Not on the map ("N projects have no map location" note); data-quality checks for missing pins and pins > 60 km from the city centre; pin accuracy status |
| Stale data | "Needs re-check" badge and a warning after `stale_after_days`; data-quality list. Nothing is auto-deleted |
| Two users editing | Field-level locking (§12) |
| Unauthorised user | Not in `users` → 403 with a clear message; wrong Google domain → 403 |
| User leaves the organisation | Deactivate: all sessions are deleted immediately; history keeps their name |
| Accidental edit | Audit log shows before and after; the wizard has Discard and Undo per row |
| Accidental deletion | Soft delete and Restore everywhere; snapshots in the audit log |

## 14. Roadmap classification

**V1 (built):** core database, Google sign-in, roles, project create and edit, configurations, towers (bulk, shared, overrides), metadata-driven filters with bands and sliders, configuration-level graded matching, clustered map, project card, drawer, Detailed Overview, audit trail, validation, admin masters, filters, bands, fields, rules, users and roles, data-quality dashboard, workflow, soft delete, concurrency control.

**Also built early, because they cost little here:** bulk import with mapping, validation, duplicate check and error report (V1.5); advanced duplicate detection with trigram, distance and aliases (V1.5); shareable or bookmarkable searches via the URL (a light version of V1.5 saved filters); developer merge.

**V1.5 next:** named saved searches per user; field-level verification (verify the price only); reviewer diff ("what changed since last verification"); analytics on searches; email digest of stale projects.

**V2:** unit inventory (below), availability integration, external API, CRM integration (push matched projects to a lead), AI-assisted natural-language search ("2 BHK in Kharghar around 1.2"), AI-drafted objection answers, automated verification against RERA portals, price history and market analytics.

## 15. Future extension: unit inventory

Unit inventory slots in under towers without changing anything that exists:

```sql
CREATE TABLE units (
  id SERIAL PRIMARY KEY,
  tower_id INT NOT NULL REFERENCES towers(id),
  configuration_id INT REFERENCES project_configurations(id),
  floor INT NOT NULL, unit_no TEXT NOT NULL,
  carpet NUMERIC(10,2), sbua NUMERIC(10,2), price BIGINT, facing TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','blocked','sold')),
  attributes JSONB NOT NULL DEFAULT '{}', row_version INT NOT NULL DEFAULT 1,
  UNIQUE (tower_id, unit_no)
);
```

Configuration rows then become a summary (min/max per type, refreshed from units), and the matching engine stays as it is. A `price_history` table (configuration_id, price_from, price_to, valid_from) can be filled from the audit log, which already holds every price change.

## 16. Known limitations

- **Map tiles.** The default CARTO/OSM tiles are fine for internal use. Heavy production use needs a keyed provider (one setting).
- **Google sign-in** needs a configured OAuth client. The development sign-in is for local testing and is disabled when `NODE_ENV=production`.
- **Custom fields can't change type** once data exists (by design). Create a new field and migrate the values.
- **Imports create records only.** Updating existing projects by import is not in V1, to keep imports safe. Use the wizard or export/edit flows later.
- **Review state applies to the whole project.** A published project edited by an editor stays live and is flagged "changed since verified", rather than going back into a review queue. This is a deliberate choice to keep sales data available; the setting `sales_visible_statuses` controls visibility.
- **Search counts are not shown per filter option** (facet counts). Option lists respect the parent filter (city → location → sub-location) but don't show how many projects each would return.
- **Workbook coordinates.** The workbook had no coordinates, so the 9 migrated projects carry *approximate* pins at locality level, flagged in data quality for on-site verification.
- **Single region deployment.** There is no offline mode; the app needs connectivity during calls.
