// Reference & configuration data. Everything here is editable later from the Admin screens;
// this file only provides the starting state.
import { PERMISSIONS } from '../../src/lib/permissions.js';

export const roles = [
  { key: 'admin', name: 'Admin', description: 'Everything, including configuration and users', permissions: PERMISSIONS.map((p) => p.key), is_system: true },
  { key: 'data_editor', name: 'Data Editor', description: 'Create and edit projects, submit for review, run imports', is_system: true,
    permissions: ['explorer.view', 'project.view_all', 'project.create', 'project.edit', 'project.submit', 'import.run', 'quality.view', 'audit.view'] },
  { key: 'reviewer', name: 'Reviewer', description: 'Verify and publish submitted information', is_system: true,
    permissions: ['explorer.view', 'project.view_all', 'project.edit', 'project.submit', 'project.verify', 'project.publish', 'project.archive', 'quality.view', 'audit.view'] },
  { key: 'sales', name: 'Sales User', description: 'Search and view published projects', is_system: true, permissions: ['explorer.view'] },
];

export const settings = [
  { key: 'psf_display_rule', label: '₹/sq.ft. display rule', value: 'developer_first',
    description: 'Which ₹/sq.ft. to show when both exist: developer_first | calculated_first | developer_only | calculated_only' },
  { key: 'stale_after_days', label: 'Stale after (days)', value: 90,
    description: 'Projects not updated for this many days show "Information may require verification"' },
  { key: 'matching', label: 'Matching rules', value: {
      range_exact_rule: 'contained', tolerance_pct: 10, missing_value: 'partial', show_partial_default: true },
    description: 'range_exact_rule: contained (config range must sit inside the requirement for an Exact match) or overlap (any overlap is Exact). tolerance_pct: how far outside the requirement still counts as Partial. missing_value: partial | exclude — how configurations with no price/area are treated.' },
  { key: 'sales_visible_statuses', label: 'Record statuses visible to sales', value: ['published', 'needs_update'],
    description: 'Only projects in these record statuses appear in the sales explorer' },
  { key: 'duplicate_detection', label: 'Duplicate detection', value: { threshold: 0.45, radius_m: 400 },
    description: 'Score (0–1) above which a project is flagged as a possible duplicate, and the distance that counts as "same site"' },
  { key: 'coordinate_sanity_km', label: 'Coordinate sanity radius (km)', value: 60,
    description: 'Projects plotted further than this from their city centre are flagged as possibly incorrect coordinates' },
  { key: 'psf_sanity', label: '₹/sq.ft. sanity range', value: { min: 2500, max: 150000 },
    description: 'Calculated ₹/sq.ft. outside this range raises a validation warning' },
  { key: 'map', label: 'Map provider', value: {
      tile_url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO', max_zoom: 19, default_center: [19.05, 73.02], default_zoom: 10 },
    description: 'Tile layer used by the map. Swap for MapTiler / Mapbox / Google tiles by changing the URL.' },
  { key: 'project_id_format', label: 'Project ID format', value: { prefix: 'PRJ', digits: 6 },
    description: 'Permanent IDs are PREFIX-CITYCODE-NNNNNN. Changing this only affects new projects.' },
];

export const masterLists = [
  { key: 'purpose', name: 'Purpose', is_system: true, values: [
    ['RES', 'Residential', { shows_residential_usp: true }],
    ['INV', 'Investment', { shows_investment_usp: true }],
    ['BOTH', 'Both', { shows_residential_usp: true, shows_investment_usp: true }]] },
  { key: 'launch_stage', name: 'Launch Stage', is_system: true, values: [
    ['PRE', 'Pre-Launch'], ['LAUNCHED', 'Launched'], ['SUSTENANCE', 'Sustenance'], ['RTM', 'Ready to Move']] },
  { key: 'sales_status', name: 'Project Status (sales)', is_system: true, values: [
    ['ACTIVE', 'Active'], ['LIMITED', 'Limited Inventory'], ['SOLD_OUT', 'Sold Out'], ['COMPLETED', 'Completed'],
    ['ON_HOLD', 'On Hold'], ['CANCELLED', 'Cancelled', { warn: true }]] },
  { key: 'eoi_type', name: 'EOI Type', is_system: true, values: [
    ['NA', 'N/A', { not_applicable: true }], ['BANKABLE', 'Bankable'], ['NON_BANKABLE', 'Non-Bankable']] },
  { key: 'inventory_status', name: 'Inventory Status', is_system: true, values: [
    ['ACTIVE', 'Active Selling'], ['LIMITED', 'Limited Inventory'], ['SPECIFIC_FLOORS', 'Specific Floors'], ['SOLD_OUT', 'Sold Out', { excludes_from_match: true }]] },
  { key: 'amenity_category', name: 'Amenity Category', is_system: true, values: [
    ['FITNESS', 'Fitness & Sports'], ['LEISURE', 'Clubhouse & Leisure'], ['KIDS', 'Kids & Family'],
    ['WELLNESS', 'Wellness'], ['GREEN', 'Green & Open Spaces'], ['CONVENIENCE', 'Convenience & Safety']] },
];

export const amenities = {
  FITNESS: ['Swimming Pool', 'Gymnasium', 'Jogging Track', 'Multipurpose Court', 'Box Cricket', 'Tennis Court', 'Badminton Court', 'Cycling Track'],
  LEISURE: ['Clubhouse', 'Mini Theatre', 'Indoor Games', 'Library & Business Lounge', 'Banquet Hall', 'Party Lawn', 'Golf Course'],
  KIDS: ["Kids' Play Area", 'Creche', 'Toddler Pool'],
  WELLNESS: ['Spa & Steam Room', 'Yoga / Meditation Zone', 'Senior Citizen Zone'],
  GREEN: ['Landscaped Gardens', 'Central Park', 'Podium Garden', 'Rooftop Garden'],
  CONVENIENCE: ['24x7 Security', 'Power Backup', 'EV Charging', 'Convenience Store', 'Co-working Space'],
};

export const configurationTypes = [
  // code, label, category, bedrooms, area_label
  ['S', 'Studio', 'residential', 0.5], ['1', '1 BHK', 'residential', 1], ['1.5', '1.5 BHK', 'residential', 1.5],
  ['2', '2 BHK', 'residential', 2], ['2.5', '2.5 BHK', 'residential', 2.5], ['3', '3 BHK', 'residential', 3],
  ['3.5', '3.5 BHK', 'residential', 3.5], ['4', '4 BHK', 'residential', 4], ['5', '5 BHK', 'residential', 5],
  ['11J', '1+1 BHK (Jodi)', 'residential', 2], ['22J', '2+2 BHK (Jodi)', 'residential', 4],
  ['23J', '2+3 BHK (Jodi)', 'residential', 5], ['33J', '3+3 BHK (Jodi)', 'residential', 6],
  ['PLOT', 'Plot', 'plot', null, 'Plot Area'], ['VILLA', 'Villa', 'villa', 4], ['ROW', 'Row House', 'villa', 3],
  ['OFFICE', 'Office', 'commercial', null], ['SHOP', 'Retail Shop', 'commercial', null],
];

export const bandSets = [
  { key: 'price', label: 'Price', unit: 'INR', display_format: 'inr', bands: [
    ['Below ₹80 L', null, 8000000], ['₹80 L – 1 Cr', 8000000, 10000000], ['₹1 – 1.5 Cr', 10000000, 15000000],
    ['₹1.5 – 2 Cr', 15000000, 20000000], ['₹2 – 3 Cr', 20000000, 30000000], ['₹3 – 4 Cr', 30000000, 40000000],
    ['₹4 – 5 Cr', 40000000, 50000000], ['Above ₹5 Cr', 50000000, null]] },
  { key: 'carpet', label: 'Carpet Area', unit: 'sq.ft.', display_format: 'sqft', bands: [
    ['Below 300', null, 300], ['300 – 500', 300, 500], ['500 – 1,000', 500, 1000], ['1,000 – 1,500', 1000, 1500],
    ['1,500 – 2,000', 1500, 2000], ['2,000 – 2,500', 2000, 2500], ['Above 2,500', 2500, null]] },
  { key: 'psf', label: '₹ per sq.ft.', unit: '₹/sq.ft.', display_format: 'psf', bands: [
    ['Below ₹10k', null, 10000], ['₹10k – 15k', 10000, 15000], ['₹15k – 20k', 15000, 20000],
    ['₹20k – 30k', 20000, 30000], ['Above ₹30k', 30000, null]] },
  { key: 'elevation', label: 'Elevation Band', unit: 'floors', display_format: 'floors', bands: [
    ['Low Rise (G+0–4)', null, 5], ['Mid Rise (G+5–7)', 5, 8], ['High Rise (G+8–39)', 8, 40], ['Skyscraper (G+40 and above)', 40, null]] },
];

// key, label, control, source_key, extra
export const filters = [
  ['city', 'City', 'multiselect', 'project.city', { is_primary: true, sort_order: 10 }],
  ['location', 'Location', 'multiselect', 'project.location', { depends_on: 'city', is_primary: true, sort_order: 20 }],
  ['sub_location', 'Sub-location', 'multiselect', 'project.sub_location', { depends_on: 'location', sort_order: 30 }],
  ['configuration', 'Configuration', 'multiselect', 'config.type', { is_primary: true, sort_order: 40, match_mode: 'hard' }],
  ['price', 'Budget', 'range', 'config.price', { is_primary: true, sort_order: 50, band_set_key: 'price', display_format: 'inr', unit: 'INR', min_value: 0, max_value: 60000000, step: 500000 }],
  ['carpet', 'Carpet Area', 'range', 'config.carpet', { sort_order: 60, band_set_key: 'carpet', display_format: 'sqft', unit: 'sq.ft.', min_value: 0, max_value: 3000, step: 25 }],
  ['developer', 'Developer', 'multiselect', 'project.developer', { sort_order: 70 }],
  ['launch_stage', 'Launch Stage', 'multiselect', 'project.launch_stage', { sort_order: 80 }],
  ['possession_year', 'Developer Possession Year', 'range', 'project.dev_possession_year', { sort_order: 90, display_format: 'year', min_value: 2024, max_value: 2035, step: 1 }],
  ['sales_status', 'Project Status', 'multiselect', 'project.sales_status', { sort_order: 100 }],
  ['purpose', 'Purpose', 'multiselect', 'project.purpose', { sort_order: 110 }],
  ['elevation', 'Elevation Band', 'bands', 'tower.floors', { sort_order: 120, band_set_key: 'elevation', display_format: 'floors' }],
  // Defined but inactive — switch on from Admin → Filters to demonstrate configurability
  ['psf', '₹ per sq.ft.', 'range', 'config.psf', { sort_order: 130, band_set_key: 'psf', display_format: 'psf', min_value: 0, max_value: 60000, step: 500, is_active: false }],
  ['land_parcel', 'Land Parcel (acres)', 'range', 'project.land_parcel_acres', { sort_order: 140, display_format: 'number', unit: 'acres', min_value: 0, max_value: 200, step: 1, is_active: false, match_mode: 'hard' }],
];

// Field metadata. storage=column → a core typed column; storage=attribute → custom field in JSONB.
// [entity, key, label, data_type, section, extra]
export const fields = [
  // ---------------- project ----------------
  ['project', 'name', 'Project Name', 'text', 'identity', { is_required: true, show_in_card: true, show_in_summary: true }],
  ['project', 'developer_id', 'Developer', 'select', 'identity', { is_required: true, show_in_card: true, show_in_summary: true }],
  ['project', 'phase_name', 'Phase', 'text', 'identity', {}],
  ['project', 'city_id', 'City', 'select', 'location', { is_required: true, show_in_summary: true }],
  ['project', 'location_id', 'Location', 'select', 'location', { is_required: true, show_in_card: true, show_in_summary: true }],
  ['project', 'sub_location_id', 'Sub-location', 'select', 'location', { show_in_card: true, show_in_summary: true }],
  ['project', 'locality', 'Locality / Sector', 'text', 'location', { help_text: 'Sector, road or area name below sub-location level' }],
  ['project', 'landmark', 'Landmark', 'text', 'location', { show_in_summary: true }],
  ['project', 'address', 'Address', 'longtext', 'location', {}],
  ['project', 'latitude', 'Latitude', 'number', 'location', { validation: { min: -90, max: 90 } }],
  ['project', 'longitude', 'Longitude', 'number', 'location', { validation: { min: -180, max: 180 } }],
  ['project', 'purpose_id', 'Purpose', 'select', 'status', { master_list_key: 'purpose', is_required: true, show_in_summary: true }],
  ['project', 'launch_stage_id', 'Launch Stage', 'select', 'status', { master_list_key: 'launch_stage', is_required: true, show_in_summary: true }],
  ['project', 'sales_status_id', 'Project Status', 'select', 'status', { master_list_key: 'sales_status', is_required: true, show_in_summary: true }],
  ['project', 'dev_possession_date', 'Developer Possession', 'date', 'possession', { show_in_card: true, show_in_summary: true }],
  ['project', 'rera_possession_date', 'RERA Possession', 'date', 'possession', { show_in_card: true, show_in_summary: true }],
  ['project', 'possession_remarks', 'Possession Remarks', 'longtext', 'possession', {}],
  ['project', 'land_parcel_acres', 'Land Parcel', 'number', 'land', { unit: 'acres', show_in_card: true, show_in_summary: true }],
  ['project', 'land_parcel_remarks', 'Land Parcel Remarks', 'text', 'land', {}],
  ['project', 'open_space_acres', 'Open Space', 'number', 'land', { unit: 'acres', show_in_summary: true }],
  ['project', 'open_space_pct', 'Open Space %', 'number', 'land', { unit: '%', validation: { min: 0, max: 100 } }],
  ['project', 'open_space_remarks', 'Open Space Remarks', 'text', 'land', {}],
  ['project', 'total_towers', 'Total Towers', 'integer', 'land', { show_in_summary: true }],
  ['project', 'has_parking', 'Parking Available', 'tristate', 'parking', {}],
  ['project', 'basement_levels', 'Basement Levels', 'integer', 'parking', { visible_when: { field: 'has_parking', in: ['yes'] } }],
  ['project', 'stilt_levels', 'Stilt Levels', 'integer', 'parking', { visible_when: { field: 'has_parking', in: ['yes'] } }],
  ['project', 'podium_levels', 'Podium Levels', 'integer', 'parking', { visible_when: { field: 'has_parking', in: ['yes'] } }],
  ['project', 'parking_remarks', 'Parking Remarks', 'text', 'parking', {}],
  ['project', 'eoi_type_id', 'EOI Type', 'select', 'eoi', { master_list_key: 'eoi_type', show_in_summary: true }],
  ['project', 'eoi_amount', 'EOI Amount', 'money', 'eoi', { visible_when: { field: 'eoi_type_id', not_codes: ['NA'] } }],
  ['project', 'eoi_date', 'EOI Start Date', 'date', 'eoi', { visible_when: { field: 'eoi_type_id', not_codes: ['NA'] } }],
  ['project', 'eoi_valid_until', 'EOI Valid Until', 'date', 'eoi', { visible_when: { field: 'eoi_type_id', not_codes: ['NA'] } }],
  ['project', 'eoi_remarks', 'EOI Remarks', 'longtext', 'eoi', {}],
  ['project', 'amenity_remarks', 'Amenity Remarks', 'longtext', 'amenities', {}],
  ['project', 'developer_remarks', 'About Developer (project-specific)', 'longtext', 'developer', {}],
  ['project', 'other_location_remarks', 'Other Location Remarks', 'longtext', 'remarks', {}],
  ['project', 'other_remarks', 'Other Remarks', 'longtext', 'remarks', {}],
  ['project', 'internal_notes', 'Internal Notes', 'longtext', 'internal', { help_text: 'Never shown to sales users' }],
  ['project', 'data_source', 'Data Source', 'text', 'internal', {}],
  // custom (attribute) fields — examples of admin-added fields
  ['project', 'clubhouse_area', 'Clubhouse Area', 'area', 'amenities', { storage: 'attribute', unit: 'sq.ft.', show_in_summary: true, help_text: 'Example of a custom field added via Admin → Fields' }],
  ['project', 'legacy_ref', 'Legacy Workbook ID', 'text', 'internal', { storage: 'attribute', show_in_detail: false }],
  // ---------------- configuration ----------------
  ['configuration', 'config_type_id', 'Configuration', 'select', 'configuration', { is_required: true, show_in_card: true }],
  ['configuration', 'variant', 'Variant', 'text', 'configuration', {}],
  ['configuration', 'carpet_from', 'Carpet From', 'area', 'configuration', { unit: 'sq.ft.', show_in_card: true }],
  ['configuration', 'carpet_to', 'Carpet To', 'area', 'configuration', { unit: 'sq.ft.' }],
  ['configuration', 'sbua_from', 'Super Built-up From', 'area', 'configuration', { unit: 'sq.ft.' }],
  ['configuration', 'sbua_to', 'Super Built-up To', 'area', 'configuration', { unit: 'sq.ft.' }],
  ['configuration', 'price_from', 'Price From', 'money', 'configuration', { show_in_card: true }],
  ['configuration', 'price_to', 'Price To', 'money', 'configuration', {}],
  ['configuration', 'price_on_request', 'Price on Request', 'boolean', 'configuration', {}],
  ['configuration', 'dev_psf', 'Developer ₹/sq.ft.', 'money', 'configuration', {}],
  ['configuration', 'psf_basis', '₹/sq.ft. Basis', 'select', 'configuration', {}],
  ['configuration', 'parking_count', 'Parking (nos.)', 'integer', 'configuration', {}],
  ['configuration', 'parking_remarks', 'Parking Remarks', 'text', 'configuration', {}],
  ['configuration', 'inventory_status_id', 'Inventory Status', 'select', 'configuration', { master_list_key: 'inventory_status' }],
  ['configuration', 'inventory_details', 'Inventory Details', 'text', 'configuration', {}],
  ['configuration', 'inventory_remarks', 'Inventory Remarks', 'text', 'configuration', {}],
  ['configuration', 'remarks', 'Configuration Remarks', 'text', 'configuration', {}],
  ['configuration', 'balcony', 'Balcony', 'tristate', 'configuration', { storage: 'attribute', help_text: 'Example of a custom configuration field' }],
  // ---------------- tower ----------------
  ['tower', 'name', 'Tower Name', 'text', 'tower', { is_required: true }],
  ['tower', 'phase', 'Phase', 'text', 'tower', {}],
  ['tower', 'represents_count', 'Represents (no. of towers)', 'integer', 'tower', { help_text: 'Use >1 for a "typical tower" row standing in for several identical towers' }],
  ['tower', 'flats_per_floor', 'Flats per Floor', 'integer', 'tower', {}],
  ['tower', 'floors_above_ground', 'Floors (G+)', 'integer', 'tower', {}],
  ['tower', 'habitable_from_floor', 'Habitable From Floor', 'integer', 'tower', {}],
  ['tower', 'main_lifts', 'Main Lifts', 'integer', 'tower', {}],
  ['tower', 'service_lifts', 'Service Lifts', 'integer', 'tower', {}],
  ['tower', 'parking_remarks', 'Tower Parking', 'text', 'tower', {}],
  ['tower', 'remarks', 'Tower Remarks', 'text', 'tower', {}],
];

// City -> Location -> Sub-location with approximate centre coordinates.
export const geography = [
  { code: 'MUM', name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777, locations: [
    ['Navi Mumbai', 19.033, 73.0297, [['Kharghar', 19.0473, 73.0699], ['Vashi', 19.0771, 72.9986], ['Sanpada', 19.0626, 73.0094],
      ['Juinagar', 19.0532, 73.0186], ['Panvel', 18.9894, 73.1175], ['Nerul', 19.0338, 73.0196], ['Ulwe', 18.97, 73.03],
      ['CBD Belapur', 19.0235, 73.04], ['Taloja', 19.066, 73.117]]],
    ['Thane', 19.2183, 72.9781, [['Ghodbunder Road', 19.258, 72.968], ['Majiwada', 19.221, 72.98], ['Kolshet Road', 19.23, 72.99]]],
    ['Western Suburbs', 19.1197, 72.8468, [['Andheri', 19.1197, 72.8468], ['Goregaon', 19.1663, 72.8526], ['Malad', 19.186, 72.8485]]],
    ['Central Suburbs', 19.08, 72.92, [['Powai', 19.1176, 72.906], ['Chembur', 19.0522, 72.9005], ['Mulund', 19.1726, 72.9566]]],
    ['Raigad', 18.75, 73.05, [['Alibaug', 18.6414, 72.8722], ['Karjat', 18.9107, 73.3236]]],
  ] },
  { code: 'PUN', name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567, locations: [
    ['West Pune', 18.58, 73.77, [['Hinjewadi', 18.5913, 73.7389], ['Baner', 18.559, 73.7868], ['Wakad', 18.598, 73.765]]],
    ['East Pune', 18.54, 73.94, [['Kharadi', 18.5515, 73.9348], ['Hadapsar', 18.5089, 73.926], ['Wagholi', 18.58, 73.985]]],
  ] },
  { code: 'BLR', name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946, locations: [
    ['North Bengaluru', 13.1, 77.62, [['Hebbal', 13.0358, 77.597], ['Yelahanka', 13.1007, 77.5963], ['Devanahalli', 13.2437, 77.7126]]],
    ['East Bengaluru', 12.95, 77.72, [['Whitefield', 12.9698, 77.75], ['Sarjapur Road', 12.91, 77.687], ['Varthur', 12.94, 77.747]]],
  ] },
  { code: 'HYD', name: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867, locations: [
    ['West Hyderabad', 17.43, 78.35, [['Gachibowli', 17.4401, 78.3489], ['Kokapet', 17.396, 78.335], ['Kondapur', 17.46, 78.357]]],
    ['North Hyderabad', 17.54, 78.43, [['Kompally', 17.536, 78.487], ['Bachupally', 17.545, 78.382]]],
  ] },
  { code: 'GGN', name: 'Gurugram', state: 'Haryana', lat: 28.4595, lng: 77.0266, locations: [
    ['Dwarka Expressway', 28.5, 77.0, [['Sector 102', 28.487, 76.983], ['Sector 113', 28.528, 77.023]]],
    ['Golf Course Extension Road', 28.405, 77.08, [['Sector 65', 28.4, 77.07], ['Sector 63A', 28.41, 77.095]]],
  ] },
  { code: 'NOI', name: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lng: 77.391, locations: [
    ['Noida Expressway', 28.47, 77.42, [['Sector 150', 28.419, 77.488], ['Sector 128', 28.528, 77.36]]],
    ['Greater Noida West', 28.6, 77.43, [['Gaur City', 28.605, 77.43], ['Techzone 4', 28.59, 77.45]]],
  ] },
];

export const demoUsers = [
  ['hemant.bajaj@propertypistol.com', 'Hemant Bajaj', 'admin'],
  ['admin@example.com', 'Demo Admin', 'admin'],
  ['abhay.editor@example.com', 'Abhay (Data Editor)', 'data_editor'],
  ['riya.editor@example.com', 'Riya (Data Editor)', 'data_editor'],
  ['neha.reviewer@example.com', 'Neha (Reviewer)', 'reviewer'],
  ['sales@example.com', 'Sameer (Sales)', 'sales'],
  ['former.employee@example.com', 'Former Employee', 'sales', false],
];
