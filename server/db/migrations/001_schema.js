// Migration 001 — core schema (kept as a JS module so it bundles for Cloudflare Workers).
export default String.raw`-- =====================================================================
-- Project Explorer — core schema
-- Conventions
--   * Money is stored as BIGINT whole rupees (₹1.35 Cr = 13500000).
--   * Areas are NUMERIC sq.ft. Land is NUMERIC acres.
--   * NULL means "Not provided". Why a value is NULL (Not applicable /
--     Unknown) is recorded in the row's field_states JSONB, e.g.
--     {"open_space_acres":"na","eoi_type_id":"unknown"}.
--   * Nothing is hard-deleted in normal workflows: is_active / record_status.
--   * Every table that users edit carries row_version for optimistic locking.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- Users, roles, sessions
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id           SERIAL PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name         TEXT NOT NULL,
  description  TEXT,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL,
  name           TEXT,
  role_id        INT NOT NULL REFERENCES roles(id),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  google_sub     TEXT,
  picture_url    TEXT,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     INT REFERENCES users(id),
  deactivated_at TIMESTAMPTZ,
  row_version    INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------------------
-- Settings (business rules as data)
-- ---------------------------------------------------------------------
CREATE TABLE app_settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL,
  label        TEXT,
  description  TEXT,
  updated_by   INT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Generic master lists (small enumerations administrators manage)
-- ---------------------------------------------------------------------
CREATE TABLE master_lists (
  key            TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name           TEXT NOT NULL,
  description    TEXT,
  is_system      BOOLEAN NOT NULL DEFAULT FALSE,   -- system lists cannot be deleted
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE master_values (
  id           SERIAL PRIMARY KEY,
  list_key     TEXT NOT NULL REFERENCES master_lists(key) ON UPDATE CASCADE,
  code         TEXT NOT NULL,
  label        TEXT NOT NULL,
  sort_order   INT NOT NULL DEFAULT 100,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  meta         JSONB NOT NULL DEFAULT '{}',   -- behaviour flags, e.g. {"shows_investment_usp":true}
  row_version  INT NOT NULL DEFAULT 1,
  UNIQUE (list_key, code)
);
CREATE UNIQUE INDEX master_values_label_uq ON master_values (list_key, lower(label));

-- ---------------------------------------------------------------------
-- Geography: City -> Location -> Sub-location
-- ---------------------------------------------------------------------
CREATE TABLE cities (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,5}$'),  -- used in project IDs
  name        TEXT NOT NULL,
  state       TEXT,
  latitude    NUMERIC(9,6),
  longitude   NUMERIC(9,6),
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX cities_name_uq ON cities (lower(name));

CREATE TABLE locations (
  id          SERIAL PRIMARY KEY,
  city_id     INT NOT NULL REFERENCES cities(id),
  name        TEXT NOT NULL,
  latitude    NUMERIC(9,6),
  longitude   NUMERIC(9,6),
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX locations_name_uq ON locations (city_id, lower(name));

CREATE TABLE sub_locations (
  id          SERIAL PRIMARY KEY,
  location_id INT NOT NULL REFERENCES locations(id),
  name        TEXT NOT NULL,
  latitude    NUMERIC(9,6),
  longitude   NUMERIC(9,6),
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX sub_locations_name_uq ON sub_locations (location_id, lower(name));

-- ---------------------------------------------------------------------
-- Developers
-- ---------------------------------------------------------------------
CREATE TABLE developers (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases         TEXT[] NOT NULL DEFAULT '{}',
  about           TEXT,
  website         TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  merged_into_id  INT REFERENCES developers(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version     INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX developers_norm_uq ON developers (normalized_name) WHERE merged_into_id IS NULL;
CREATE INDEX developers_trgm ON developers USING gin (normalized_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Configuration types (1 BHK, 2 BHK, Jodi, Plot, Villa, Office...)
-- ---------------------------------------------------------------------
CREATE TABLE configuration_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'residential'
              CHECK (category IN ('residential','commercial','plot','villa','other')),
  bedrooms    NUMERIC(3,1),
  area_label  TEXT NOT NULL DEFAULT 'Carpet',   -- "Plot Area" for plots
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX configuration_types_label_uq ON configuration_types (lower(label));

-- ---------------------------------------------------------------------
-- Amenities catalogue
-- ---------------------------------------------------------------------
CREATE TABLE amenities (
  id          SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES master_values(id),   -- list 'amenity_category'
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX amenities_name_uq ON amenities (lower(name));

-- ---------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------
CREATE TYPE record_status AS ENUM
  ('draft','under_review','verified','published','needs_update','inactive','archived');
CREATE TYPE tristate AS ENUM ('yes','no','na','unknown');

CREATE SEQUENCE project_public_seq START 1;

CREATE TABLE projects (
  id                    SERIAL PRIMARY KEY,
  public_id             TEXT NOT NULL UNIQUE,                 -- PRJ-MUM-000001, never changes
  name                  TEXT NOT NULL,
  normalized_name       TEXT NOT NULL,
  developer_id          INT REFERENCES developers(id),
  parent_project_id     INT REFERENCES projects(id),          -- phases of a township
  phase_name            TEXT,

  -- location
  city_id               INT NOT NULL REFERENCES cities(id),
  location_id           INT REFERENCES locations(id),
  sub_location_id       INT REFERENCES sub_locations(id),
  locality              TEXT,                                  -- sector / road / area text
  landmark              TEXT,
  address               TEXT,
  pincode               TEXT,
  latitude              NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude             NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
  coords_status         TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (coords_status IN ('unverified','approximate','verified')),

  -- classification
  purpose_id            INT REFERENCES master_values(id),      -- list 'purpose'
  launch_stage_id       INT REFERENCES master_values(id),      -- list 'launch_stage'
  sales_status_id       INT REFERENCES master_values(id),      -- list 'sales_status'
  record_status         record_status NOT NULL DEFAULT 'draft',

  -- possession
  dev_possession_date   DATE,
  dev_possession_year   INT GENERATED ALWAYS AS (EXTRACT(YEAR FROM dev_possession_date)::INT) STORED,
  rera_possession_date  DATE,
  rera_possession_year  INT GENERATED ALWAYS AS (EXTRACT(YEAR FROM rera_possession_date)::INT) STORED,
  possession_remarks    TEXT,

  -- land & density
  land_parcel_acres     NUMERIC(10,2) CHECK (land_parcel_acres >= 0),
  land_parcel_remarks   TEXT,
  open_space_acres      NUMERIC(10,2) CHECK (open_space_acres >= 0),
  open_space_pct        NUMERIC(5,2) CHECK (open_space_pct BETWEEN 0 AND 100),
  open_space_remarks    TEXT,
  total_towers          INT CHECK (total_towers >= 0),

  -- parking (project level)
  has_parking           tristate,
  basement_levels       INT CHECK (basement_levels >= 0),
  stilt_levels          INT CHECK (stilt_levels >= 0),
  podium_levels         INT CHECK (podium_levels >= 0),
  parking_remarks       TEXT,

  -- EOI
  eoi_type_id           INT REFERENCES master_values(id),      -- list 'eoi_type'
  eoi_amount            BIGINT CHECK (eoi_amount >= 0),
  eoi_date              DATE,
  eoi_valid_until       DATE,
  eoi_remarks           TEXT,

  -- narrative
  amenity_remarks       TEXT,
  developer_remarks     TEXT,
  other_location_remarks TEXT,
  other_remarks         TEXT,
  internal_notes        TEXT,                                 -- never shown to sales role
  data_source           TEXT,

  -- flexibility
  attributes            JSONB NOT NULL DEFAULT '{}',          -- admin-defined custom fields
  field_states          JSONB NOT NULL DEFAULT '{}',          -- why a field is empty

  -- lifecycle
  row_version           INT NOT NULL DEFAULT 1,
  created_by            INT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            INT REFERENCES users(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by          INT REFERENCES users(id),
  submitted_at          TIMESTAMPTZ,
  verified_by           INT REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  published_by          INT REFERENCES users(id),
  published_at          TIMESTAMPTZ,
  archived_at           TIMESTAMPTZ,
  status_reason         TEXT
);
CREATE INDEX projects_status_idx    ON projects (record_status);
CREATE INDEX projects_city_idx      ON projects (city_id, location_id, sub_location_id);
CREATE INDEX projects_dev_idx       ON projects (developer_id);
CREATE INDEX projects_poss_idx      ON projects (dev_possession_year);
CREATE INDEX projects_name_trgm     ON projects USING gin (normalized_name gin_trgm_ops);
CREATE INDEX projects_attrs_gin     ON projects USING gin (attributes);
CREATE INDEX projects_geo_idx       ON projects (latitude, longitude);

CREATE TABLE project_aliases (
  id          SERIAL PRIMARY KEY,
  project_id  INT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'previous_name' CHECK (kind IN ('previous_name','alias')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  INT REFERENCES users(id)
);
CREATE INDEX project_aliases_trgm ON project_aliases USING gin (normalized gin_trgm_ops);

CREATE TABLE project_rera (
  id                   SERIAL PRIMARY KEY,
  project_id           INT NOT NULL REFERENCES projects(id),
  rera_number          TEXT NOT NULL,
  phase_label          TEXT,
  rera_possession_date DATE,
  remarks              TEXT,
  sort_order           INT NOT NULL DEFAULT 100,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  row_version          INT NOT NULL DEFAULT 1
);
CREATE INDEX project_rera_project_idx ON project_rera(project_id);

-- ---------------------------------------------------------------------
-- Towers
-- ---------------------------------------------------------------------
CREATE TABLE towers (
  id                    SERIAL PRIMARY KEY,
  project_id            INT NOT NULL REFERENCES projects(id),
  name                  TEXT NOT NULL,
  phase                 TEXT,
  represents_count      INT NOT NULL DEFAULT 1 CHECK (represents_count >= 1), -- "typical tower x N"
  flats_per_floor       INT CHECK (flats_per_floor >= 0),
  floors_above_ground   INT CHECK (floors_above_ground >= 0),
  habitable_from_floor  INT CHECK (habitable_from_floor >= 0),
  main_lifts            INT CHECK (main_lifts >= 0),
  service_lifts         INT CHECK (service_lifts >= 0),
  parking_remarks       TEXT,
  remarks               TEXT,
  sort_order            INT NOT NULL DEFAULT 100,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  attributes            JSONB NOT NULL DEFAULT '{}',
  field_states          JSONB NOT NULL DEFAULT '{}',
  row_version           INT NOT NULL DEFAULT 1,
  created_by            INT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            INT REFERENCES users(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX towers_project_idx ON towers(project_id) WHERE is_active;
CREATE INDEX towers_floors_idx  ON towers(floors_above_ground);

-- ---------------------------------------------------------------------
-- Configurations (the unit of matching)
-- ---------------------------------------------------------------------
CREATE TABLE project_configurations (
  id                  SERIAL PRIMARY KEY,
  project_id          INT NOT NULL REFERENCES projects(id),
  config_type_id      INT NOT NULL REFERENCES configuration_types(id),
  variant             TEXT,                          -- "With balcony", "Type B"
  carpet_from         NUMERIC(10,2) CHECK (carpet_from > 0),
  carpet_to           NUMERIC(10,2) CHECK (carpet_to > 0),
  sbua_from           NUMERIC(10,2) CHECK (sbua_from > 0),
  sbua_to             NUMERIC(10,2) CHECK (sbua_to > 0),
  price_from          BIGINT CHECK (price_from > 0),
  price_to            BIGINT CHECK (price_to > 0),
  price_on_request    BOOLEAN NOT NULL DEFAULT FALSE,
  dev_psf             NUMERIC(12,2) CHECK (dev_psf > 0),   -- official / developer-quoted, never overwritten
  calc_psf            NUMERIC(12,2),                       -- derived by the server
  psf_basis           TEXT NOT NULL DEFAULT 'carpet' CHECK (psf_basis IN ('carpet','sbua')),
  parking_count       INT CHECK (parking_count >= 0),
  parking_remarks     TEXT,
  inventory_status_id INT REFERENCES master_values(id),    -- list 'inventory_status'
  inventory_details   TEXT,
  inventory_remarks   TEXT,
  remarks             TEXT,
  sort_order          INT NOT NULL DEFAULT 100,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,       -- false = discontinued
  discontinued_at     TIMESTAMPTZ,
  attributes          JSONB NOT NULL DEFAULT '{}',
  field_states        JSONB NOT NULL DEFAULT '{}',
  row_version         INT NOT NULL DEFAULT 1,
  created_by          INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          INT REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- normalised ranges used by the matching engine
  carpet_min NUMERIC(10,2) GENERATED ALWAYS AS (COALESCE(carpet_from, carpet_to)) STORED,
  carpet_max NUMERIC(10,2) GENERATED ALWAYS AS (COALESCE(carpet_to, carpet_from)) STORED,
  price_min  BIGINT        GENERATED ALWAYS AS (CASE WHEN price_on_request THEN NULL ELSE COALESCE(price_from, price_to) END) STORED,
  price_max  BIGINT        GENERATED ALWAYS AS (CASE WHEN price_on_request THEN NULL ELSE COALESCE(price_to, price_from) END) STORED,
  CONSTRAINT carpet_order CHECK (carpet_to IS NULL OR carpet_from IS NULL OR carpet_to >= carpet_from),
  CONSTRAINT sbua_order   CHECK (sbua_to   IS NULL OR sbua_from   IS NULL OR sbua_to   >= sbua_from),
  CONSTRAINT price_order  CHECK (price_to  IS NULL OR price_from  IS NULL OR price_to  >= price_from)
);
CREATE INDEX configs_project_idx ON project_configurations(project_id) WHERE is_active;
CREATE INDEX configs_match_idx   ON project_configurations(config_type_id, price_min, price_max, carpet_min, carpet_max) WHERE is_active;
CREATE INDEX configs_attrs_gin   ON project_configurations USING gin (attributes);

CREATE TABLE configuration_towers (
  configuration_id INT NOT NULL REFERENCES project_configurations(id),
  tower_id         INT NOT NULL REFERENCES towers(id),
  PRIMARY KEY (configuration_id, tower_id)
);

-- ---------------------------------------------------------------------
-- Commercial & sales content (one row per item, not text blobs)
-- ---------------------------------------------------------------------
CREATE TABLE project_amenities (
  project_id INT NOT NULL REFERENCES projects(id),
  amenity_id INT NOT NULL REFERENCES amenities(id),
  remarks    TEXT,
  PRIMARY KEY (project_id, amenity_id)
);

CREATE TABLE project_highlights (
  id                SERIAL PRIMARY KEY,
  project_id        INT NOT NULL REFERENCES projects(id),
  kind              TEXT NOT NULL CHECK (kind IN ('connectivity','location_advantage','usp_residential','usp_investment')),
  text              TEXT NOT NULL,
  travel_time_mins  INT CHECK (travel_time_mins >= 0),
  distance_km       NUMERIC(6,2) CHECK (distance_km >= 0),
  sort_order        INT NOT NULL DEFAULT 100,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  row_version       INT NOT NULL DEFAULT 1
);
CREATE INDEX project_highlights_idx ON project_highlights(project_id, kind);

CREATE TABLE payment_plans (
  id            SERIAL PRIMARY KEY,
  project_id    INT NOT NULL REFERENCES projects(id),
  name          TEXT NOT NULL,
  structure     TEXT,            -- "20:80", "25:25:50"
  applicable_to TEXT,            -- "NRI", "All"
  remarks       TEXT,
  sort_order    INT NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  row_version   INT NOT NULL DEFAULT 1
);
CREATE INDEX payment_plans_idx ON payment_plans(project_id);

CREATE TABLE offers (
  id          SERIAL PRIMARY KEY,
  project_id  INT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  description TEXT,
  start_date  DATE,
  end_date    DATE,
  remarks     TEXT,
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INT NOT NULL DEFAULT 1,
  CONSTRAINT offer_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX offers_idx ON offers(project_id);

CREATE TABLE objections (
  id          SERIAL PRIMARY KEY,
  project_id  INT REFERENCES projects(id),   -- NULL = generic objection library entry
  objection   TEXT NOT NULL,
  response    TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INT NOT NULL DEFAULT 1
);
CREATE INDEX objections_idx  ON objections(project_id);
CREATE INDEX objections_trgm ON objections USING gin ((objection || ' ' || coalesce(response,'')) gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Metadata: fields, filters, bands
-- ---------------------------------------------------------------------
CREATE TABLE field_definitions (
  id               SERIAL PRIMARY KEY,
  entity           TEXT NOT NULL CHECK (entity IN ('project','configuration','tower')),
  key              TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label            TEXT NOT NULL,
  data_type        TEXT NOT NULL CHECK (data_type IN
                   ('text','longtext','number','integer','money','area','date','boolean','tristate','select','multiselect')),
  storage          TEXT NOT NULL DEFAULT 'attribute' CHECK (storage IN ('column','attribute','derived')),
  master_list_key  TEXT REFERENCES master_lists(key) ON UPDATE CASCADE,
  unit             TEXT,
  section          TEXT NOT NULL DEFAULT 'other',
  sort_order       INT NOT NULL DEFAULT 100,
  show_in_card     BOOLEAN NOT NULL DEFAULT FALSE,
  show_in_summary  BOOLEAN NOT NULL DEFAULT FALSE,
  show_in_detail   BOOLEAN NOT NULL DEFAULT TRUE,
  show_in_form     BOOLEAN NOT NULL DEFAULT TRUE,
  is_required      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  is_system        BOOLEAN NOT NULL DEFAULT FALSE,
  help_text        TEXT,
  validation       JSONB NOT NULL DEFAULT '{}',   -- {"min":0,"max":100}
  visible_when     JSONB,                          -- {"field":"has_parking","in":["yes"]}
  row_version      INT NOT NULL DEFAULT 1,
  UNIQUE (entity, key)
);

CREATE TABLE band_sets (
  key            TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label          TEXT NOT NULL,
  unit           TEXT,
  display_format TEXT NOT NULL DEFAULT 'number',
  description    TEXT
);

CREATE TABLE band_definitions (
  id           SERIAL PRIMARY KEY,
  band_set_key TEXT NOT NULL REFERENCES band_sets(key) ON UPDATE CASCADE,
  label        TEXT NOT NULL,
  lower_bound  NUMERIC,          -- inclusive; NULL = open
  upper_bound  NUMERIC,          -- exclusive; NULL = open
  sort_order   INT NOT NULL DEFAULT 100,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  row_version  INT NOT NULL DEFAULT 1,
  CONSTRAINT band_order CHECK (lower_bound IS NULL OR upper_bound IS NULL OR upper_bound > lower_bound)
);
CREATE INDEX band_definitions_set_idx ON band_definitions(band_set_key, sort_order);

CREATE TABLE filter_definitions (
  id              SERIAL PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label           TEXT NOT NULL,
  control         TEXT NOT NULL CHECK (control IN ('multiselect','select','range','bands','toggle')),
  source_key      TEXT NOT NULL,      -- whitelisted source (see server/src/services/filterSources.js)
  depends_on      TEXT,               -- key of the parent filter (hierarchy)
  match_mode      TEXT NOT NULL DEFAULT 'graded' CHECK (match_mode IN ('graded','hard')),
  min_value       NUMERIC,
  max_value       NUMERIC,
  step            NUMERIC,
  unit            TEXT,
  display_format  TEXT,               -- inr | sqft | year | number | psf | floors
  band_set_key    TEXT REFERENCES band_sets(key) ON UPDATE CASCADE,
  sort_order      INT NOT NULL DEFAULT 100,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,   -- shown above the fold / on mobile
  default_value   JSONB,
  help_text       TEXT,
  row_version     INT NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- Audit, verification, import staging
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INT REFERENCES users(id),
  action      TEXT NOT NULL,     -- create | update | delete | deactivate | status | import | merge | login ...
  entity      TEXT NOT NULL,     -- project | configuration | tower | offer | master_value | filter | band | setting | user ...
  entity_id   TEXT,
  project_id  INT REFERENCES projects(id),
  field       TEXT,
  old_value   JSONB,
  new_value   JSONB,
  batch_id    UUID,
  note        TEXT
);
CREATE INDEX audit_project_idx ON audit_log(project_id, at DESC);
CREATE INDEX audit_entity_idx  ON audit_log(entity, entity_id, at DESC);
CREATE INDEX audit_user_idx    ON audit_log(user_id, at DESC);
CREATE INDEX audit_at_idx      ON audit_log(at DESC);

CREATE TABLE verifications (
  id          SERIAL PRIMARY KEY,
  project_id  INT NOT NULL REFERENCES projects(id),
  user_id     INT REFERENCES users(id),
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  action      TEXT NOT NULL,       -- submitted | verified | sent_back | published | unpublished ...
  scope       TEXT NOT NULL DEFAULT 'project',
  field       TEXT,
  remarks     TEXT
);
CREATE INDEX verifications_project_idx ON verifications(project_id, at DESC);

CREATE TABLE import_batches (
  id           UUID PRIMARY KEY,
  user_id      INT REFERENCES users(id),
  entity       TEXT NOT NULL CHECK (entity IN ('projects','configurations','towers')),
  file_name    TEXT,
  status       TEXT NOT NULL DEFAULT 'uploaded'
               CHECK (status IN ('uploaded','validated','committed','cancelled')),
  headers      JSONB NOT NULL DEFAULT '[]',
  rows         JSONB NOT NULL DEFAULT '[]',
  mapping      JSONB NOT NULL DEFAULT '{}',
  report       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ
);
`;
