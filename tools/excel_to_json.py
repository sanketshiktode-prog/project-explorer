"""
One-time / repeatable migration: Excel workbook -> data/*.json

Usage (optional, only if you still maintain data in the Excel file):
    pip install openpyxl
    python tools/excel_to_json.py "5.2 Project Explorer Dashboard - Navi Mumbai.xlsm"

It regenerates projects/configurations/towers/developers/locations from the
ProjectMaster, ConfigurationMaster and TowerMaster sheets.
filters.json, bands.json, fields.json, master-data.json and users.json are NOT
overwritten if they already exist (they are app configuration).
"""
import hashlib, json, os, re, sys, datetime as dt
import openpyxl

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")

# Approximate coordinates (manually placed; verify before relying on them)
COORDS = {
    "P001": (19.0612, 73.0068), "P002": (19.0405, 73.0640), "P003": (18.9560, 73.1960),
    "P004": (18.9350, 73.1650), "P005": (18.6050, 72.8880), "P006": (18.9620, 73.1130),
    "P007": (19.0505, 73.0170), "P008": (19.0518, 73.0190), "P009": (18.9270, 73.1700),
}
LOCATION_FIX = {"Khargar": "Kharghar"}
LOCATION_CITY = {"Alibaug": "RAIGAD"}  # everything else -> NAVI_MUMBAI
LOC_COORDS = {"Sanpada": (19.0626, 73.0103), "Kharghar": (19.0330, 73.0697), "Panvel": (18.9894, 73.1175),
              "Juinagar": (19.0532, 73.0180), "Alibaug": (18.6414, 72.8722)}
LIST_FIELDS = ["amenities", "usp_resident", "usp_investment", "connectivity", "location_advantages",
               "payment_plans", "offers", "about_developer", "objection_handling", "other_location_remarks",
               "other_remarks", "internal_notes"]
PM_MAP = {
    "Project ID": "project_id", "Project Name": "project_name", "Sub-Location": "sub_location", "Landmark": "landmark",
    "Purpose": "purpose", "Launch Stage": "launch_stage", "Project Status": "project_status",
    "Developer Possession": "developer_possession", "RERA Possession": "rera_possession",
    "Basement Parking Levels": "parking_basement", "Stilt Parking Levels": "parking_stilt",
    "Podium Parking Levels": "parking_podium", "Parking Structure": "parking_structure",
    "Land Parcel": "land_parcel", "Open Space": "open_space", "Amenities": "amenities",
    "USPs - Resident": "usp_resident", "USPs - Investment": "usp_investment", "Connectivity": "connectivity",
    "Location Advantages": "location_advantages", "Payment Plans": "payment_plans", "Offers": "offers",
    "About Developer": "about_developer", "Objection Handling": "objection_handling",
    "Other Location Remarks": "other_location_remarks", "Other Remarks": "other_remarks", "EOI Type": "eoi_type",
    "EOI Remarks": "eoi_remarks", "Last Updated": "last_updated", "Data Source": "data_source",
    "Internal Notes": "internal_notes",
}


def slug(s):
    return re.sub(r"[^A-Z0-9]+", "_", s.upper()).strip("_")


def to_list(v):
    if v is None:
        return []
    out = []
    for line in str(v).replace("\r", "").split("\n"):
        line = re.sub(r"^\s*[•\-\*]\s*", "", line).strip()
        if line:
            out.append(line)
    return out


def month(v):
    return v.strftime("%Y-%m") if isinstance(v, (dt.datetime, dt.date)) else None


def parse_updated(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    m = re.match(r"(\d{1,2}) (\w{3})'(\d{2})", str(v or ""))
    if m:
        return dt.datetime.strptime(f"{m[1]} {m[2]} 20{m[3]}", "%d %b %Y").strftime("%Y-%m-%d")
    return None


def acres(v):
    m = re.search(r"([\d.]+)\s*(?:-\s*[\d.]+\s*)?acre", str(v or ""), re.I)
    return float(m[1]) if m else None


def rows(ws):
    it = ws.iter_rows(values_only=True)
    head = next(it)
    for r in it:
        if any(x is not None for x in r):
            yield dict(zip(head, r))


def dump(name, obj, overwrite=True):
    path = os.path.join(DATA, name + ".json")
    if not overwrite and os.path.exists(path):
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main(xl):
    wb = openpyxl.load_workbook(xl, data_only=True)
    os.makedirs(DATA, exist_ok=True)
    devs, locs, projects = {}, {}, []

    for r in rows(wb["ProjectMaster"]):
        p = {v: r.get(k) for k, v in PM_MAP.items()}
        dname = r["Developer"].strip()
        devs.setdefault(dname, {"developer_id": "DEV%03d" % (len(devs) + 1), "name": dname, "active": True})
        lname = LOCATION_FIX.get(r["Location"].strip(), r["Location"].strip())
        city = LOCATION_CITY.get(lname, "NAVI_MUMBAI")
        lat, lng = LOC_COORDS.get(lname, (None, None))
        locs.setdefault(lname, {"location_id": slug(lname), "city_id": city, "name": lname, "lat": lat, "lng": lng, "active": True})
        p.update(developer_id=devs[dname]["developer_id"], city_id=city, location_id=slug(lname))
        p["developer_possession"] = month(p["developer_possession"])
        p["rera_possession"] = month(p["rera_possession"])
        p["launch_date"] = None
        p["last_updated"] = parse_updated(p["last_updated"])
        p["land_parcel_acres"] = acres(p["land_parcel"])
        p["rera_numbers"] = re.findall(r"\b[PA][A-Z]?\d{8,}", str(r.get("About Developer") or ""))
        for f in LIST_FIELDS:
            p[f] = to_list(p[f])
        # "Rera Number: ..." lines were stored under About Developer in the workbook - move them to rera_numbers
        p["about_developer"] = [x for x in p["about_developer"] if not x.lower().startswith("rera number") and not re.fullmatch(r"[PA][A-Z]?\d{8,}", x)]
        p["lat"], p["lng"] = COORDS.get(p["project_id"], (None, None))
        p["coords_approx"] = True
        p["archived"] = False
        p["is_sample"] = False
        projects.append(p)

    configs = []
    for r in rows(wb["ConfigurationMaster"]):
        configs.append({
            "configuration_id": r["Configuration ID"], "project_id": r["Project ID"], "configuration": r["Configuration"],
            "carpet_from": r["Carpet"], "carpet_to": r["Carpet"], "super_builtup": r["Super Builtup (Sqft.)"],
            "price_from": r["Price"], "price_to": r["Price"], "psf_developer": r["₹/Sqft. Developer"],
            "parking": r["Parking"], "inventory_status": r["Inventory Status"],
            "inventory_details": r["Inventory Details"], "remarks": r["Configuration Remarks"] or r["Inventory Remarks"],
        })

    towers, seen = [], {}
    for r in rows(wb["TowerMaster"]):
        name = r["Tower"]
        if isinstance(name, (dt.datetime, dt.date)) or (isinstance(name, int) and name > 40000):
            # Excel auto-converted "1/9" (tower 1 of 9) into a date - undo it
            d = name if isinstance(name, (dt.datetime, dt.date)) else dt.datetime(1899, 12, 30) + dt.timedelta(days=name)
            name = f"{d.month}/{d.day}"
        tid = r["Tower ID"]
        seen[tid] = seen.get(tid, 0) + 1
        if seen[tid] > 1 or (tid.endswith("_ALL") and r["Project ID"] == "P002"):
            tid = f"{r['Project ID']}_T{seen[tid]}"
        towers.append({
            "tower_id": tid, "project_id": r["Project ID"], "scope": r["Information Scope"],
            "tower_name": None if name is None else str(name), "total_towers": r["Total No. of Towers"],
            "flats_per_floor": r["No. of Flats on One Floor"], "floors_above_ground": r["Above Ground Floors"],
            "habitable_from": r["Habitable Floor Starts From"], "main_lifts": r["Main Lifts"],
            "service_lifts": r["Service Lifts"], "configurations": [], "remarks": r["Tower Remarks"],
        })

    # ---- additional SAMPLE cases (clearly flagged, for testing only) ----
    devs["Sample Developer Ltd"] = {"developer_id": "DEV900", "name": "Sample Developer Ltd", "active": True}
    locs["Hinjewadi"] = {"location_id": "HINJEWADI", "city_id": "PUNE", "name": "Hinjewadi", "lat": 18.5912, "lng": 73.7389, "active": True}
    base = {k: None for k in PM_MAP.values()}
    for f in LIST_FIELDS:
        base[f] = []
    projects.append({**base, "project_id": "S001", "project_name": "[SAMPLE] Skyline Range Residences", "developer_id": "DEV900",
                     "city_id": "PUNE", "location_id": "HINJEWADI", "sub_location": "Phase 1", "landmark": "Near Rajiv Gandhi Infotech Park",
                     "purpose": "Residence", "launch_stage": "Launched", "project_status": "Active", "launch_date": "2026-01",
                     "developer_possession": "2029-03", "rera_possession": "2025-12", "land_parcel": "4 acres", "land_parcel_acres": 4,
                     "rera_numbers": [], "lat": 18.5930, "lng": 73.7350, "coords_approx": True, "last_updated": "2026-05-01",
                     "eoi_type": "N/A", "amenities": ["Clubhouse", "Pool"], "archived": False, "is_sample": True,
                     "other_remarks": ["Test case: price/carpet RANGES per configuration, overlapping ranges, RERA earlier than launch (warning), Penthouse configuration."]})
    configs += [
        {"configuration_id": "S001_2_1", "project_id": "S001", "configuration": "2 BHK", "carpet_from": 750, "carpet_to": 850, "super_builtup": None,
         "price_from": 8000000, "price_to": 10000000, "psf_developer": None, "parking": None, "inventory_status": "Active Selling", "inventory_details": None, "remarks": None},
        {"configuration_id": "S001_3_1", "project_id": "S001", "configuration": "3 BHK", "carpet_from": 1050, "carpet_to": 1250, "super_builtup": None,
         "price_from": 15000000, "price_to": 20000000, "psf_developer": None, "parking": None, "inventory_status": "Active Selling", "inventory_details": None, "remarks": None},
        {"configuration_id": "S001_3_2", "project_id": "S001", "configuration": "3 BHK", "carpet_from": 1200, "carpet_to": 1400, "super_builtup": None,
         "price_from": 18000000, "price_to": 23000000, "psf_developer": None, "parking": None, "inventory_status": "Limited Inventory", "inventory_details": None, "remarks": "Overlaps S001_3_1"},
        {"configuration_id": "S001_PH_1", "project_id": "S001", "configuration": "Penthouse", "carpet_from": 2800, "carpet_to": 3200, "super_builtup": None,
         "price_from": 60000000, "price_to": 75000000, "psf_developer": None, "parking": None, "inventory_status": "Limited Inventory", "inventory_details": None, "remarks": None},
    ]
    towers += [{"tower_id": f"S001_T{i}", "project_id": "S001", "scope": "Tower Specific", "tower_name": f"Tower {c}", "total_towers": 3,
                "flats_per_floor": 4, "floors_above_ground": f, "habitable_from": 3, "main_lifts": 3, "service_lifts": 1,
                "configurations": cf, "remarks": None}
               for i, (c, f, cf) in enumerate([("A", 22, ["2 BHK", "3 BHK"]), ("B", 22, ["3 BHK"]), ("C", 6, ["3 BHK", "Penthouse"])], 1)]
    projects.append({**base, "project_id": "S002", "project_name": "[SAMPLE] Incomplete Project", "developer_id": "DEV900",
                     "city_id": "NAVI_MUMBAI", "location_id": "PANVEL", "purpose": "Both", "launch_stage": "Pre-Launch", "project_status": "Active",
                     "rera_numbers": [], "lat": None, "lng": None, "coords_approx": True, "land_parcel_acres": None,
                     "archived": False, "is_sample": True, "last_updated": "2025-11-01",
                     "other_remarks": ["Test case: no configurations, no towers, no coordinates, no possession, stale."]})

    dump("projects", projects)
    dump("configurations", configs)
    dump("towers", towers)
    dump("developers", list(devs.values()))
    dump("locations", {
        "cities": [{"city_id": "NAVI_MUMBAI", "name": "Navi Mumbai", "active": True},
                   {"city_id": "RAIGAD", "name": "Raigad (Alibaug)", "active": True},
                   {"city_id": "PUNE", "name": "Pune", "active": True}],
        "locations": list(locs.values())})
    print(f"{len(projects)} projects, {len(configs)} configurations, {len(towers)} towers")


def make_user(uid, name, role, pw, active=True):
    salt = hashlib.sha256((uid + "pe-salt").encode()).hexdigest()[:32]
    return {"user_id": uid, "display_name": name, "role": role, "active": active, "salt": salt,
            "hash": hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 100000).hex()}


if __name__ == "__main__":
    main(sys.argv[1])
    if "--reset-users" in sys.argv:
        dump("users", [make_user("admin", "Administrator", "Admin", "Admin@123"),
                       make_user("editor01", "Editor One", "Editor", "Editor@123"),
                       make_user("sales01", "Sales One", "Sales", "Sales@123"),
                       make_user("olduser", "Disabled User", "Sales", "Old@123", active=False)])
