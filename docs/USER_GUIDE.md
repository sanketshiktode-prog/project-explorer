# User guide

There are three ways of working, all on the same data:

- **Sales** search like a search engine.
- **Data editors** fill in a guided form.
- **Reviewers and admins** run a controlled data system.

---

## 1. Sales users: search during a call

*Customer: "2 BHK in Kharghar, around ₹1–1.5 Cr."*

1. Open **Search**. Pick **City → Location → Sub-location**; each list only shows places inside the one above it. Or type "Kharghar" in the search box, which searches names, developers, areas, landmarks, IDs and previous project names.
2. Tap **2 BHK** under Configuration.
3. Under **Budget**, tap the **₹1 – 1.5 Cr** chip. Alternatively, drag the slider, or type `1 Cr` and `1.5 Cr` in Min / Max (you can also type "85 L").
4. Read the results:
   - A **green bar** means *Exact match*: one configuration meets every requirement.
   - An **amber bar** means *Partial match*, with the reason underneath (e.g. "Price ₹1.55 Cr — is 3% above ₹1–1.5 Cr", "Price on request", "No configuration data yet").
   - Each card shows only the configurations that fit, grouped by type, with area and price ranges, ₹/sq.ft. and possession.
   - Switch **Exact + partial** to **Exact only** to hide near misses.
   - Use **Sort** for best match, price, earliest possession, recently updated or name.
5. Click a card or a map pin to open the **details panel**, in this order: snapshot → configurations → towers → parking → land → amenities → connectivity → location advantages → USPs → payment plans → current offers → EOI → developer → objection handling → other remarks.
6. **Detailed overview** opens the full page, which you can print.
7. **Needs re-check** (or a yellow note) means the information hasn't been updated recently or has changed since it was verified. Confirm price and possession with the developer before committing.
8. **Objection handling** (top menu) searches agreed answers to "price is high", "possession is late" and similar.
9. The page address contains your whole search, so you can bookmark it or send it to a colleague.

On a phone, use the **Filters / List / Map** tabs at the bottom.

---

## 2. Data editors: add and update projects

### Create a project

**Projects → New project**:

1. Enter the name, developer, city, location and sub-location.
2. While you type, similar existing projects are listed. If you click **Create project** and a likely match exists, you get three choices: **Open existing**, **Create anyway** (you must give a reason, which is kept in the audit log), or **Cancel**.
3. If the developer is missing, use **Developer not listed?** The system warns about similar names, such as "Hiranandani" versus "Hiranandani Group".
4. The project gets a permanent ID, e.g. **PRJ-MUM-000123**. It never changes, even if the project is renamed later.

### The 10 steps

You can move between steps freely.

| Step | What to enter |
|---|---|
| 1 Project identity | Name, developer, phase, city/location/sub-location. Renaming keeps the ID; the old name is remembered for searches |
| 2 Status & possession | Purpose, launch stage, project status, developer and RERA possession (month), RERA numbers |
| 3 Configurations | One row per type or size variant: area from–to (carpet, SBUA), price from–to, or tick **Price on request**, developer ₹/sq.ft., parking, inventory. The calculated ₹/sq.ft. is shown live. **Copy** duplicates a row; **Discontinue** removes it from searches but keeps history; **Available in towers** limits a configuration to certain towers |
| 4 Towers | Total towers. **Add towers**: create e.g. 10 towers at once ("Tower A…J" or "Tower 1…10") with shared details (G+40, 4 flats/floor, 3 lifts). **Apply the same details to selected towers**: tick towers, fill only the values to copy, apply (tick "only fill empty" to keep existing values). Then change any single tower directly in the table; cells that differ from most towers are highlighted so typos stand out. Use **Represents > 1** for a "typical tower × N" row when only project-level information is known |
| 5 Parking | Parking Yes / No / N/A / Unknown. Levels appear only when "Yes" |
| 6 Amenities & USPs | Tick amenities by category, add remarks. Residential and/or Investment USPs appear according to the purpose |
| 7 Location | Locality, landmark, address. **Click the map to drop the pin** (drag to adjust) and mark its accuracy. Connectivity (with travel time and distance), location advantages |
| 8 Commercial information | Land parcel, open space, payment plans, developer notes, remarks, internal notes (never shown to sales), data source |
| 9 EOI, offers & objections | EOI type (Bankable / Non-Bankable / N/A). Amount and dates appear unless the type is N/A. Offers with start and end dates (expired offers disappear from sales automatically). Objections with agreed answers |
| 10 Review & submit | Full checklist, record status, review trail, change history; **Submit for review** |

### Saving

- **Project fields** (steps 1, 2, 4–9) share one draft. Click **Save changes**; unsaved changes are kept while you move between steps.
- **Lists** (configurations, towers, offers, plans, objections, RERA, highlights) save item by item with their own **Add** / **Save** buttons.

### Empty is not the same as "no"

Next to most fields there are **N/A** and **Unknown** markers:

- *Leave blank* = not provided yet.
- **N/A** = it doesn't apply to this project.
- **Unknown** = nobody knows yet.
- For yes/no questions, choose **No** explicitly.

Example: a blank EOI is *not* the same as "No EOI". Choose N/A if the project has no EOI.

### Checks panel

- **Red: to fix.** Must be fixed before submitting (e.g. Price From greater than Price To).
- **Amber: unusual.** Allowed, but worth checking (e.g. developer possession later than RERA).
- **Blue: missing.** Allowed (e.g. investment USP not provided).

Click an item to jump to its step. Nothing except red items ever blocks you.

### If someone else edited the same project

- If they changed *other* fields, your save simply works.
- If they changed the *same* field, you see their value and yours, and choose **Keep their version** or **Overwrite with mine**. Either way the change is recorded.

---

## 3. Reviewers

- **Review queue** (top menu) lists projects that are *Under review*.
- Open the project and go to **Review & submit**. From there:
  - **Verify**, then **Publish to sales** (or publish directly).
  - **Send back to editor**, with a reason.
- For live projects:
  - **Confirm still accurate** resets the "needs re-check" timer.
  - **Flag as needing update** keeps the project visible but marked.
  - **Unpublish** takes it out of sales.
- **Deactivate** (e.g. a cancelled project) and **Archive** hide a project from sales and lock editing. **Restore** brings it back as a draft. Nothing is permanently deleted in normal work.

---

## 4. Admins

### Data quality (Admin → Data quality)

Counts of projects with missing location, missing or suspicious map pins (> 60 km from the city), no configurations, missing prices, carpet or inventory, missing possession, developer after RERA possession, stale data, changes since verification, invalid towers, tower-count mismatches, expired or undated offers, unanswered objections, EOI conflicts, possible duplicate projects and possible duplicate developers. Click a tile to list the projects, then **Fix**.

### Master data (Admin → Master data)

- **Cities & locations.** Cities, then **Locations** for a city, then **Sub-locations**. The city code (MUM, PUN…) goes into new project IDs, and city coordinates centre the map.
- **Developers.** Add, rename and set aliases. **Merge…** moves all projects of a duplicate developer to the right one and keeps the old name as an alias.
- **Configurations.** Studio, BHKs, Jodi, Plot, Villa, Office… with category, bedrooms and area label.
- **Dropdown lists.** Purpose, launch stage, project status, EOI type, inventory status, amenity category, and any new list you create for custom fields. *Meta* holds behaviour flags (e.g. `{"shows_investment_usp": true}`, `{"excludes_from_match": true}`).
- **Amenities.** The catalogue by category.

Values that are in use can't be deleted; **deactivate** them instead. Existing projects keep them, and new entries can't choose them.

### Filters (Admin → Filters)

Each row is one filter on the sales screen:

| Column | Meaning |
|---|---|
| Label | What sales sees |
| Source | Which field it filters (core fields, or any filterable custom field) |
| Control | multiselect / select / range (slider + band chips) / bands (chips only) / toggle |
| Matching | *graded* (configuration filters can give partial matches) or *hard* (exact only) |
| Depends on | Parent filter, e.g. Location depends on City |
| Band set | Which bands to show as chips |
| Format | inr / sqft / psf / year / floors / number |
| Min / Max / Step | Slider limits |
| Order, Open by default, Active | Position, whether it starts expanded, whether it shows |

### Bands (Admin → Bands)

Pick a set (Price, Carpet, ₹/sq.ft., Elevation). Edit labels and bounds: *from* is included, *up to* is not. The **Means** column spells each band out, and gaps or overlaps are warned about. Bands only label stored numbers, so changing a band never changes any project's data.

### Fields (Admin → Fields)

For each entity (project / configuration / tower):

- **Core fields:** rename, change section and order, mark as required, and choose where they appear: **Card** (search result card), **Summary** (details snapshot), **Detail** (overview), **Form** (wizard).
- **Custom fields:** **Add custom field** with a type (text, long text, number, integer, money, area, date, yes/no, Yes/No/N/A/Unknown, select, multi-select), a unit and a section. Select types need an options list (create one under Master data → Dropdown lists).

### Business rules (Admin → Business rules)

- Exact-match definition, partial tolerance %, and how missing prices or areas are treated.
- ₹/sq.ft. display rule.
- Stale period.
- Which record statuses sales can see.
- Duplicate sensitivity and radius.
- Coordinate sanity radius and plausible ₹/sq.ft. range.
- Map tile provider and default centre.
- Project-ID prefix.

### Users & roles

- **Approve a new user**: their Google email plus a role. Only approved, active users can sign in.
- **Deactivate** someone who leaves; they are signed out everywhere immediately and their history stays.
- **New role**: tick permissions (e.g. *Regional lead* = search + view all + edit + verify).

### Bulk import (Admin → Bulk import)

1. Choose **projects**, **configurations** or **towers**, then upload CSV or Excel. **Download template** gives the expected columns.
2. Map each file column to a field. Common headings are recognised automatically, including the old workbook's ("Project Name", "Sub-Location", "Carpet", "Price"…).
3. **Check all rows.** Each row is marked ready, warning, possible duplicate or error, with reasons. **Download error report** gives a CSV to fix in Excel.
4. Tick **Genuinely different — import anyway** on any duplicates you want to keep, then **Import**. Rows with errors are skipped. Projects arrive as **Drafts** and still need review.

Prices can be written `13500000`, `1.35 Cr` or `85 L`. Dates can be written `2030-06-01`, `06/2030`, `Jun 2030` or `15/08/2029`.

### Audit log

Filter by text, record type, action and dates. Every row shows who, when, what, the old value and the new value.

---

## 5. Configuration recipes

| Business change | Steps |
|---|---|
| Add **"Floor Preference"** as a filter | Master data → Dropdown lists → Manage lists → add list `floor_preference` and its values. Fields → configuration → **Add custom configuration field**: key `floor_preference`, type *select*, options list Floor Preference. Filters → **Add filter**: source "Floor Preference (custom configuration field)", control *multiselect*. Editors now see the field on each configuration, and sales get the filter |
| Change **₹1–1.5 Cr** to **₹1–1.25 Cr** | Bands → Price → edit label and "Up to" = 12500000 → Save. Add a ₹1.25–1.5 Cr band if needed; the gap warning reminds you |
| Add **Villa** | Master data → Configurations → Add (category villa) |
| Add **Pune** | Master data → Cities & locations → Add city (code PUN, coordinates) → Locations → Sub-locations |
| Stop showing **Land Parcel** on the quick card | Fields → project → Land Parcel → untick *Card* (keep *Detail*) |
| Add **Clubhouse Area** to project details | Fields → project → Add custom field: type *area*, unit sq.ft., section *amenities*, tick *Summary* and/or *Detail*. (It already exists in this install as an example) |
| Make **Open Space %** filterable | Filters → Add filter: source "Open space %", control *range*, format *number*, min 0, max 100 |
| Treat any price overlap as exact | Business rules → Matching rules → Exact match means: *Any overlap* |
| Let reviewers' re-check period be 60 days | Business rules → Stale after (days) = 60 |
