# Validation rules and audit approach

## Three levels

| Level | Meaning | Effect |
|---|---|---|
| **Error** | Must be corrected | Blocks *saving* when it is a data-type or range violation, and blocks *submit / verify / publish* when it is a business rule |
| **Warning** | Unusual, possibly wrong | Shown, never blocks |
| **Info** | Missing but not wrong | Shown, never blocks |

Validation runs on the server (`validateProject` in `server/src/services/projects.js`) after every save, so the checks panel is always current. The `phase` decides strictness: `save` while drafting, `submit` before review. Required fields are *info* while drafting and *errors* at submit.

## Always rejected on save (input checks)

These checks are enforced by `registry.js` and database constraints:

- Wrong type: text in a number, a malformed date, an unknown dropdown value, or a value from the wrong list.
- Out of range: latitude/longitude, percentages 0–100, negative areas, prices, floors or lifts, unrealistic sizes.
- From > To for carpet, super built-up and price (also a database `CHECK`).
- Offer end before start.
- Required core values on create: project name and city; configuration type; tower name.
- Duplicate tower name inside a project (bulk create).
- Custom fields are coerced to their declared type (number, date, Yes/No/N/A/Unknown, list values).

## Project rules

| Rule | Level |
|---|---|
| Required fields from Admin → Fields (default: name, developer, city, location, purpose, launch stage, project status) | info (draft) / **error** (submit) |
| Location not in the selected city; sub-location not in the selected location | **error** |
| No map coordinates | info (draft) / warning (submit) |
| Coordinates more than *N* km from the city centre (rule `coordinate_sanity_km`, default 60) | warning |
| No developer or RERA possession date | info / warning |
| RERA possession not provided | info |
| **Developer possession later than RERA possession** | warning |
| RERA possession date has passed but the project is not Completed / Sold out / Ready to move | warning |
| EOI marked N/A but amount or dates entered | warning |
| EOI marked N/A but EOI remarks present | warning |
| EOI valid-until before EOI start | **error** |
| EOI type not given (and not marked Unknown) | info |
| Parking "No" but parking levels entered | warning |
| Residential USP missing (when purpose shows residential USPs) | info |
| Investment USP missing (when purpose shows investment USPs) | info |
| Connectivity missing | info |
| No configurations | info / warning |
| Tower rows represent more towers than the project total | warning |

> **Note on the brief's example.** The brief listed "developer possession is earlier than RERA possession" as a warning. In practice the developer's target date is usually *earlier* than the RERA commitment, as in all 9 workbook projects. The genuinely unusual case is the developer date being *later* than RERA, which would mean promising beyond the legal commitment, so that is the rule implemented. Reversing it is a one-line change.

## Configuration rules

| Rule | Level |
|---|---|
| Price From > Price To, Carpet From > Carpet To | **error** |
| Price missing and not marked *Price on request* | warning |
| Carpet missing | warning |
| Super built-up smaller than carpet | warning |
| Calculated ₹/sq.ft. outside the plausible range (rule `psf_sanity`, default ₹2,500–1,50,000) | warning |
| Developer ₹/sq.ft. differs from calculated by more than 25% | warning |
| Inventory status not set | info |

## Tower rules

| Rule | Level |
|---|---|
| Habitable floor starts above the top floor | **error** |
| Floors not provided | info |
| More than 10 floors and 0 main lifts | warning |

## Offers

| Rule | Level |
|---|---|
| End before start | **error** |
| Expired (hidden from sales automatically) | info |
| No end date | info |

## Duplicate rules

- **Projects.** A score is built from:
  - trigram similarity of the normalised name, including previous names (× 0.55)
  - same developer (+0.20)
  - same sub-location (+0.15) or same location (+0.10)
  - pin within *radius* metres (+0.25, default 400 m)

  At or above the threshold (default 0.45), creation is blocked until the user confirms with a reason. Imports apply the same check, plus a check for repeated rows within the file.
- **Developers.** Normalised names (dropping Group, Realty, Developers, Ltd, Pvt…) are unique. Similar names (≥ 45% similarity) need confirmation.

---

## Audit approach

- **Everything goes through one write path** (`records.js` for project data; the admin routes for configuration). Each write diffs the record field by field and inserts one `audit_log` row per changed field: *user, time, action, record type and id, project, field, old value, new value, batch id, note*. The audit rows are written in the same database transaction as the change, so the two cannot drift apart.
- **What is logged:**
  - project / configuration / tower / offer / plan / objection / highlight / RERA: create, update, discontinue or delete (with a full snapshot)
  - amenity set changes (added and removed)
  - configuration ↔ tower links
  - workflow transitions with reasons
  - imports (batch id on every created record)
  - master data, filters, bands, fields and settings changes
  - user and role changes
  - developer merges
  - sign-ins
- **Example.** "Abhay changed L&T Panvel's price from ₹1.20 Cr to ₹1.35 Cr on 03 Oct 2026 at 4:20 PM" is stored as `{user: Abhay, at: 2026-10-03T16:20+05:30, action: update, entity: configuration, entity_id: 57, project: L&T Panvel, field: price_from, old: 12000000, new: 13500000}`. It is visible in the project's *Change history* and in Admin → Audit log.
- **Verification trail.** Separately, `verifications` stores submitted / verified / published / sent-back events with remarks, and projects keep `created_by/at`, `updated_by/at`, `submitted_by/at`, `verified_by/at` and `published_by/at`.
- **Nothing is overwritten silently.** Field-level conflict detection stops concurrent overwrites, and resolved conflicts are logged like any other change.
- **Retention.** The audit log is append-only. Permanent deletion of a draft keeps a full snapshot of the deleted project in the log.
