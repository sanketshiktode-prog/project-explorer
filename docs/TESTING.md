# Testing

## How to run

```bash
createdb explorer_test
TEST_DATABASE_URL=postgres://localhost/explorer_test npm test
```

The API suite drops and re-creates the test database, seeds it (reference data, the 9 workbook projects and 33 sample projects), and then calls the real HTTP API through `supertest`, logged in as each demo role.

## Result (3 Oct 2026)

**52 tests, 52 passed, 0 failed** (about 3.7 s on PostgreSQL 16.15 / Node 22).

| Area (spec §66) | Tests |
|---|---|
| Authentication | rejects unauthenticated calls · rejects writes without the CSRF header · signs in an approved Google account and refuses unknown or deactivated ones · rejects an invalid Google token · deactivating a user ends their sessions immediately |
| Authorization / role restrictions | sales cannot reach data entry or admin · sales only see published projects and never internal notes · data editors cannot publish, reviewers can · only admins can manage configuration |
| Filters, combined filters, range filtering, partial matches, map filtering | does not treat a project as a match just because some configuration fits the budget (the spec's Project A example) · overlapping ranges → partial with a reason; "Exact only" returns only exact · price on request → partial, not hidden · city + location + configuration + carpet + possession combined · tower elevation band · map points = filtered projects with coordinates · quick search by developer, area, ID and **previous name** · response time well under a second |
| Project creation & duplicate detection | likely duplicate blocked until confirmed with a reason (reason audited) · permanent ID survives renaming; old name stored |
| Missing information | N/A and Unknown stored separately from blank and cleared when a value is entered |
| Configuration creation | ₹/sq.ft. calculated, developer figure never overwritten · From > To rejected |
| Tower creation, shared tower information, overrides | bulk create 4 towers with shared details · override Tower C · apply shared value to all · override preserved · duplicate tower name rejected |
| Data validation | errors, warnings and info produced; submit blocked by errors, allowed after fixing; full verify → publish → visible to sales |
| Discontinued configuration | stops matching, stays in history |
| Concurrent edits | different fields by two users both succeed · same field → 409 conflict with base / theirs / yours; first change kept |
| Audit logs | user, field, old and new values recorded; project history endpoint |
| Archive | archived hidden from search, edits blocked, restore permission-checked · published projects cannot be permanently deleted |
| Master-data changes | new city + location instantly available; project IDs use the new city code · master values in use cannot be deleted · new configuration type appears in the filter |
| Band configuration changes | ₹1–1.5 Cr → ₹1–1.25 Cr changes results and labels |
| Filter configuration changes | **Floor Preference** added as list + custom field + filter, then used in search · invalid source or control rejected · deactivated filter disappears and is ignored |
| Field configuration | Land Parcel hidden from card but kept in detail; core field type locked · new custom project field appears without breaking existing projects |
| Business rules | tolerance 0 removes near-miss partials · ₹ psf display rule switches source · developer merge moves projects and keeps an alias |
| Data quality | flags missing coordinates, suspect coordinates, no configurations, invalid towers, stale data, possible duplicates, expired offers, EOI conflicts · expired offers hidden from sales |
| Data import | CSV upload → auto-mapping → validation (ok / duplicate / error / in-file duplicate) → error-report CSV → commit creates drafts with batch audit; re-commit refused · configuration import with "2.85 Cr" money format |
| Unit tests | Indian money and date parsing, ₹ formatting, name normalisation, ₹ psf midpoint calculation, band gap and overlap detection, input coercion messages |

## Manual browser checks (Playwright, Chromium)

- Explorer at 1440 px and 390 px: filters, band chips + slider, Exact / Partial bars and reasons, grouped configuration lines, map clustering and pins, detail drawer, mobile Filters / List / Map tabs.
- Data-entry flow as a **Data Editor**, end to end through the UI:
  1. typing an existing name shows the inline duplicate hint
  2. **Create project** opens the duplicate modal (Open existing / Create anyway with reason / Cancel)
  3. a new project is created
  4. purpose, stage, status and possession months are set and saved
  5. a 2 BHK is added with prices typed as "1.25 Cr" / "1.32 Cr"
  6. 4 towers are bulk-created with shared details, Tower C is overridden to G+30 (highlighted), and saved
  7. a map pin is dropped by clicking the map
  8. the project is submitted, giving status *Under review*
- Admin screens: data quality (tiles + drill-down), filters, bands (with "Means" column), fields, business rules, users & roles, import, audit.

A bug found during this pass is fixed and covered: optional empty values sent by the form (e.g. `sort_order: null`) overrode database defaults. Empty values now fall back to defaults, and child rows are appended at the end.

## Not automated

- Real Google sign-in. Token verification is exercised with a stubbed verifier; a live check needs a real OAuth client ID.
- Map tiles. External tile servers were unreachable from the test sandbox, so pins and clusters were verified on a blank basemap.
- Load testing beyond the seed size. The search query is index-backed and paginated; with a few thousand projects it should stay well under 100 ms on modest hardware. Verify with production data.
