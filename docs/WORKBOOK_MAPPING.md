# Workbook → application mapping

The source is *5.2 Project Explorer Dashboard – Navi Mumbai.xlsm*. The migration code is `server/db/seed/workbook.js`, and the raw extract is `server/db/seed/workbook_navi_mumbai.json`. All 9 projects, 62 configurations and 34 tower rows are migrated.

## Sheets

| Workbook sheet | In the application |
|---|---|
| Dashboard (slicers, map, panel, matching list) | Explorer page: filters rail, results list, Leaflet map, detail drawer |
| ProjectDetails | Detail drawer and the Detailed Overview page (`/p/PRJ-…`) |
| ProjectMaster | `projects` + child tables (see below) |
| ConfigurationMaster | `project_configurations` |
| TowerMaster | `towers` |
| Lists | `master_lists` / `master_values`, `configuration_types`, `band_sets` / `band_definitions` |
| DashboardSource | Not stored. The search query computes it on demand |
| VBA (map show/hide, selection) | React state + Leaflet. Selection uses the project ID, never the name |
| Slicers | `filter_definitions` rows |

## ProjectMaster columns

| Workbook column | Application | Notes |
|---|---|---|
| Project ID (P001) | `public_id` PRJ-MUM-000001; old ID kept in custom field `legacy_ref` | Permanent and independent of the name |
| Project Name | `name` (+ `project_aliases` on rename) | |
| Developer | `developer_id` → `developers` | Master data |
| Location (Sanpada, Khargar, Panvel, Juinagar, Alibaug) | `city_id` = Mumbai, `location_id` = Navi Mumbai (Raigad for Alibaug), `sub_location_id` = Sanpada / **Kharghar** / Panvel / Juinagar / Alibaug | "Khargar" typo fixed |
| Sub-Location (free text) | `locality` | Mixed sectors, roads and addresses; kept as text below the master hierarchy |
| Landmark | `landmark` | |
| — | `latitude`, `longitude`, `coords_status='approximate'` | The workbook had none; approximate pins added, flagged for verification |
| Purpose (Both / Investment / Residence) | `purpose_id` → master *purpose* (Both / Investment / Residential) | Drives which USP sections appear |
| Launch Stage | `launch_stage_id` | |
| Project Status | `sales_status_id` | The workflow status is separate (`record_status` = published for migrated rows) |
| Developer Possession | `dev_possession_date` | |
| Developer Possession Year (formula) | `dev_possession_year` (generated column) | |
| RERA Possession | `rera_possession_date` (+ `project_rera` rows) | |
| Basement / Stilt / Podium Parking Levels | `basement_levels`, `stilt_levels`, `podium_levels` | |
| Parking Structure (formula "2B+1S+3P") | Computed for display from the three levels | |
| Land Parcel ("32-38 acres", "55 acres - 30% residential…") | `land_parcel_acres` (first number) + `land_parcel_remarks` (original text when it says more) | |
| Open Space ("10 acres of oepn space", "Large township concept") | `open_space_acres` when it was a number, otherwise `open_space_remarks` | |
| Amenities (bullets) | `project_amenities` (matched to the amenity catalogue) + `amenity_remarks` (lines that didn't match or carried detail) | Clubhouse sizes (e.g. "Club house - 35,000 sq.ft.") → custom field `clubhouse_area` |
| USPs - Resident | `project_highlights` kind `usp_residential` (one row per bullet) | |
| USPs - Investment | `project_highlights` kind `usp_investment` | |
| Connectivity | `project_highlights` kind `connectivity`; travel minutes parsed from "~5 mins" into `travel_time_mins` | |
| Location Advantages | `project_highlights` kind `location_advantage` | |
| Payment Plans ("25:25:50", "20:80 (For NRIs)") | `payment_plans` (structure + applicable_to parsed) | |
| Offers | `offers` (no dates in the source → flagged "no end date") | |
| About Developer ("Rera Number: P520…") | RERA numbers → `project_rera`; any other text → `developer_remarks` | |
| Objection Handling ("Project area: How to handle?") | `objections` with an empty response (flagged in data quality) | |
| Other Location Remarks / Other Remarks | same-named columns | |
| EOI Type | `eoi_type_id` | L&T Panvel (N/A + "2 Lakhs Cheque") is flagged as an EOI conflict |
| EOI Remarks | `eoi_remarks` | |
| Last Updated | `updated_at` / `published_at` = 11 Sep 2026 | |
| Data Source | `data_source` | |
| Internal Notes | `internal_notes` (never sent to sales users) | |

## ConfigurationMaster columns

| Workbook | Application |
|---|---|
| Configuration ID (P003_2_1) | Surrogate `id` (the structured ID is no longer needed) |
| Configuration ("Office Variant 1", "Plots") | `config_type_id` (Office + `variant` "Variant 1"; Plot type with area label "Plot Area") |
| Carpet | `carpet_from` (`carpet_to` available for ranges) |
| Super Builtup | `sbua_from` |
| Price | `price_from` (`price_to` available for ranges) |
| ₹/Sqft. Calculated (formula) | `calc_psf`, computed by the server on the chosen basis |
| ₹/Sqft. Developer | `dev_psf` (never overwritten) |
| ₹/Sqft. (display formula) | Display rule setting `psf_display_rule` (default: developer first) |
| Parking | `parking_remarks` / `parking_count` |
| Inventory Status / Details / Remarks | `inventory_status_id`, `inventory_details`, `inventory_remarks` |
| Configuration Remarks ("With Balcony") | `remarks`; also custom field `balcony = yes` |

## TowerMaster columns

| Workbook | Application |
|---|---|
| Tower ID (P004_T1, P001_ALL) | Surrogate `id` |
| Information Scope = Project Level | One row named "Typical tower" with `represents_count` = Total No. of Towers |
| Information Scope = Tower Specific | One row per tower |
| Total No. of Towers | `projects.total_towers` |
| Tower ("1/11 (Phase 1)", "Greenfield - 1 of 8 (Phase 4 - Arena)", 46031) | `name` ("Tower 1", "Greenfield") + `phase` ("Phase 1") + remarks ("1 of 11"). Date serials restored ("Tower 1 … of 9") |
| No. of Flats on One Floor, Above Ground Floors, Habitable Floor Starts From, Main Lifts, Service Lifts, Tower Remarks | same-named columns |
| Elevation Band (XLOOKUP) | Computed from `floors_above_ground` against band set *elevation* |

## Lists

| Workbook list | Application |
|---|---|
| Purpose, Launch Stage, Project Status, Inventory Status, EOI Type | `master_values` lists (extended: e.g. Ready to Move, Sold Out, Cancelled) |
| Configuration + Code | `configuration_types` (code, category, bedrooms, area label) |
| Price Band / Carpet Band (two conflicting versions) | `band_definitions` sets *price* and *carpet*. One definition, editable in Admin → Bands |
| Elevation Band (min G+ floors) | Band set *elevation* (Low < 5, Mid 5–7, High 8–39, Skyscraper 40+) |
| Information Scope | Replaced by `represents_count` |
| Slicer helper lists, Project Display | Not needed (computed) |
