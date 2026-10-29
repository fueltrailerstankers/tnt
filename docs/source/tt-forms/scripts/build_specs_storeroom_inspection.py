"""One-off: writes spec/forms/store-room.json and trailer-inspection-checklist.json
from compact tables transcribed from the Cognito form-builder model."""
import json, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "spec" / "forms"

STD_ROLES = [{"id": 0, "name": "Public", "public": True}, {"id": 1, "name": "Internal", "internal": True}]
CONF = "Thank you for filling out the form. Your response has been recorded."
ADMIN_LINK_BODY = '<p>&nbsp;<a href="[Entry.AdminLink]">View full entry at CognitoForms.com.</a>&nbsp;</p>'

# ---------------- STORE ROOM (Cognito form 12) ----------------
# (row, col, span, FieldName, Label)  -- all are single-line Text fields
sr = [
    (1, 1, 12, "_14INCX5HoleTIRESMIN50", "14INC x 5 hole TIRES MIN 50"),
    (2, 1, 12, "_13INCH4HOLETIRESMIN10", "13INCH4 HOLE TIRES MIN 10"),
    (3, 1, 12, "_16INCHX6HOLETIRES5", "16INCH X 6 HOLE TIRES 5"),
    (4, 1, 18, "OTHER", "OTHER "),
    ("PB", 5, "Page 1", "Next", False),
    (6, 1, 12, "_1450455HOLEBRAKEDMOQ12", "1450 45 5 HOLE BRAKED MOQ 12"),
    (6, 13, 12, "_2100455HOLEBRAKEDMOQ6", "2100 45 5 HOLE BRAKED MOQ 6"),
    (7, 1, 12, "_1850455HOLEBRAKEDONLYIFCHASSIS", "1850 45 5 HOLE BRAKED ONLY IF CHASSIS "),
    (7, 13, 12, "_1150404HOLENOBRAKEONLYIFLIGHTTOWER", "1150 40 4 HOLE NO BRAKE ONLY IF LIGHT TOWER"),
    (8, 1, 12, "_1350404HOLENOBRAKEONLYCHASSIS", "1350 40 4 HOLE NO BRAKE ONLY CHASSIS"),
    (8, 13, 12, "OTHER2", "OTHER "),
    (9, 1, 8, "_8BLADELEAFSPRINGSMOQ30", "8 BLADE LEAF SPRINGS MOQ 30"),
    (9, 9, 8, "_2TONCOUPLERMINONSHELF10", "2 TON COUPLER MIN ON SHELF 10"),
    (9, 17, 8, "_3TONCOUPLERMINONSHELF6", "3 TON COUPLER MIN ON SHELF 6"),
    (10, 1, 12, "_48MMSINGELWHEELJOCKEYMIN10", "48 MM SINGEL WHEEL JOCKEY MIN 10"),
    (10, 13, 12, "_60MMDOUBBELWHEELJOCKEYMIN7", "60 MM DOUBBEL WHEEL JOCKEY MIN 7"),
    (11, 1, 12, "RECTANGULARLAMPS6INONEMIN100", "RECTANGULAR LAMPS 6 IN ONE MIN 100"),
    (11, 13, 12, "_45KGSFIREEXTINGUISHERSMIN20", "4.5 KGS FIRE EXTINGUISHERS MIN 20"),
    (12, 1, 7, "_5COREWIREMIN5", "5 CORE WIRE MIN 5"),
    (12, 8, 10, "YELLOWTAPEMIN5", "YELLOW TAPE MIN 5"),
    (12, 18, 7, "READYBARMIN30", "READY BAR MIN 30"),
    (13, 1, 8, "BRAKECABLELONGMIN20", "BRAKE CABLE LONG MIN 20"),
    (13, 9, 8, "BRAKECABLESHORTMIN20", "BRAKE CABLE SHORT MIN 20"),
    (13, 17, 8, "WELDONUSCHACELSMIN100", "WELD ON U SCHACELS MIN 100"),
    (14, 1, 12, "_3HOLEWELDONPLATEFORBRAKESMIN50", "3 HOLE WELD ON PLATE FOR BRAKES MIN 50"),
    (14, 13, 12, "_5HOLEWELDONPLATEFORBRAKESMIN50", "5 HOLE WELD ON PLATE FOR BRAKES MIN 50"),
    (15, 1, 12, "SINGLECOMPENSATORMIN30", "SINGLE COMPENSATOR MIN 30"),
    (15, 13, 12, "TWINCOMPENSATORMIN30", "TWIN COMPENSATOR MIN 30"),
    (16, 1, 12, "CHEVRONSHORTSTICKONMIN20", "CHEVRON SHORT STICK ON MIN 20"),
    (16, 13, 6, "WHITEREFLECTORSMIN100", "WHITE REFLECTORS MIN 100"),
    (16, 19, 6, "REDREFLECTORMIN100", "RED REFLECTOR MIN 100"),
    (17, 1, 8, "DROPSIDEHINGESHONGPINMIN50", "DROPSIDE HINGES HONG PIN MIN 50"),
    (17, 9, 8, "_45MMUBOLTMIN100", "45 MM U BOLT MIN 100"),
    (17, 17, 8, "_5HOLE45MMPLATEMIN50", "5 HOLE 45 MM PLATE MIN 50"),
    (18, 1, 6, "_40MMUBOLTMIN100", "40 MM U BOLT MIN 100"),
    (18, 7, 8, "_40MM5HOLEPLATEMIN50", "40 MM 5 HOLE PLATE MIN 50"),
    (18, 15, 10, "_7PINTRAILERPLUGMIN50", "7 PIN TRAILER PLUG MIN 50"),
    (19, 1, 24, "SINGLEDISCHOLDER1BOLTMIN50", "SINGLE DISC HOLDER 1 BOLT MIN 50"),
    ("PB", 20, "Page 2", "Next", True),
    (21, 1, 12, "NUTS12MM", "NUTS 12MM"),
    (21, 13, 12, "BOLT50X12", "BOLT 50X12"),
    (22, 1, 12, "NUTS6MM", "NUTS 6MM"),
    (23, 1, 12, "NUTS8MM", "NUTS 8 MM"),
    (24, 1, 12, "WASHER6X10X2", "WASHER 6X10X2"),
    ("PB", 25, "Page 3", "Submit", True),
]
fields = []
for t in sr:
    if t[0] == "PB":
        _, row, title, nxt, back = t
        pb = {"type": "pagebreak", "row": row, "pageTitle": title, "nextButton": nxt}
        if back:
            pb.update(showBackButton=True, backButton="Back")
        fields.append(pb)
    else:
        row, col, span, name, label = t
        fields.append({"name": name, "label": label, "type": "text", "row": row, "col": col, "span": span,
                       "note": "Stock count; label carries the minimum / MOQ"})

store_room = {
    "slug": "store-room", "cognitoFormId": 12, "name": "STORE ROOM", "internalName": "STOREROOM",
    "entryCountAtExport": 8,
    "settings": {"entrySummary": "[_14INCX5HoleTIRESMIN50]", "progressBar": "Steps",
                 "showPageNumbers": True, "showPageTitles": True, "pages": ["Page 1", "Page 2", "Page 3"]},
    "fields": fields,
    "workflow": {
        "roles": STD_ROLES,
        "statuses": [
            {"id": 0, "name": "Incomplete", "color": "gray"},
            {"id": 1, "name": "Submitted", "color": "teal", "archived": True, "replacedBy": "APPROVAL"},
            {"id": 2, "name": "APPROVAL", "color": "red"},
            {"id": 3, "name": "APPROVED EMAILED", "color": "green", "note": "No action sets this - changed manually by staff"},
        ],
        "actions": [
            {"id": 1, "name": "Submit", "button": "Submit", "allowedWhen": "status == 'Incomplete'", "newStatus": "APPROVAL",
             "confirmation": CONF, "includeEntryDetails": True,
             "emails": [{"to": ["factory@fueltrailers.co.za"], "body": ADMIN_LINK_BODY, "includeReceipt": True,
                         "includeEntryDetails": True, "attachDocuments": [1]}]},
            {"id": 2, "name": "Update", "button": "Update", "allowedWhen": "status != 'Incomplete'",
             "confirmation": CONF, "emails": []},
        ],
    },
    "documents": [
        {"number": 1, "mode": "view", "name": "STORE ROOM - [Entry.Number]", "output": "pdf"},
        {"number": 2, "mode": "edit", "name": "STORE ROOM - [Entry.Number]", "output": "pdf"},
    ],
}

# ---------------- TRAILER INSPECTION CHECKLIST (Cognito form 13) ----------------
items = [
    "1. Chassis inspected for weld quality, damage, cracks and overall finish.",
    "2. Suspension, axle(s), U-bolts and mounting hardware securely fastened and correctly aligned.",
    "3. Wheel bearings checked and correctly adjusted/lubricated.",
    "4. Wheel nuts/bolts torqued to manufacturer's specification.",
    "5. Tyres inspected for correct size, pressure, condition and tread.",
    "6. Coupler operates correctly, locks securely and matches the specified tow ball size.",
    "7. Safety chains correctly fitted, securely attached and undamaged.",
    "8. Jockey wheel fitted correctly and operates smoothly.",
    "9. Braking system (if fitted) tested and adjusted correctly, including handbrake operation.",
    "10. Breakaway cable/system (where applicable) installed and functioning correctly.",
    "11. Electrical wiring secured and protected against chafing or damage.",
    "12. Trailer plug tested and all electrical functions operate correctly.",
    "13. Brake lights, tail lights, indicators, number plate light and reflectors checked.",
    "14. Mudguards, fenders and mounting brackets securely fitted.",
    "15. Load body, floor, tailgate, hinges, latches and catches inspected and operating correctly.",
    "16. Fuel tank, water tank or bowser (where applicable) inspected for leaks, fittings secure and pressure tested where required.",
    "17. Pump, hose reel, valves and accessories (where fitted) tested for correct operation.",
    "18. Reflective tape, chevron board, warning decals and VIN plate correctly installed.",
    "19. General cosmetic inspection completed (paint, galvanizing, decals, cleanliness and presentation).",
    "20. Road test completed (where applicable) and final quality inspection passed.",
]
# Cognito internal names per item (inconsistent numbering preserved for data migration)
pass_names = ["Pass", "Pass1", "Pass2", "Pass3", "Pass4", "Pass5", "Pass6", "Pass7", "Pass8", "Pass9",
              "Pass", "Pass11", "Pass12", "Pass13", "Pass14", "Pass15", "Pass16", "Pass17", "Pass18", "Pass19"]
comment_names = ["Comments"] + [f"Comments{i}" for i in range(1, 20)]

checklist = []
for i, label in enumerate(items):
    checklist.append({
        "itemNo": i + 1, "label": label, "cognitoFieldSetId": f"Form.4.{i + 2}",
        "fields": [
            {"name": "fail", "cognitoName": "Fail", "label": "Fail", "type": "yesno", "style": "checkbox", "row": 1, "col": 1, "span": 12},
            {"name": "pass", "cognitoName": pass_names[i], "label": "Pass", "type": "yesno", "style": "checkbox", "row": 1, "col": 13, "span": 12},
            {"name": "comments", "cognitoName": comment_names[i], "label": "Comments", "type": "textarea", "row": 2, "col": 1, "span": 24},
        ],
    })

inspection = {
    "slug": "trailer-inspection-checklist", "cognitoFormId": 13, "name": "Trailer Inspection Checklist",
    "internalName": "TrailerInspectionChecklist", "entryCountAtExport": 690,
    "settings": {"entrySummary": "[InspectedByName]", "progressBar": "Steps"},
    "fields": [
        {"name": "TRAILERVINNUMBER", "label": "TRAILER VIN NUMBER ", "type": "text", "row": 1, "col": 1, "span": 12},
        {"name": "_1STDATEINSPECTION", "label": "1ST DATE INSPECTION ", "type": "date", "row": 1, "col": 13, "span": 12},
        {"name": "InspectedByName", "label": "Inspected By (Name)", "type": "name", "parts": ["First", "Last"], "required": True, "row": 2, "col": 1, "span": 24},
        {"name": "InspectorEmail", "label": "Inspector Email", "type": "email", "required": True,
         "default": "admin@trailersandtankers.co.za", "row": 3, "col": 1, "span": 24},
        {"name": "TrailerInspectionResults", "label": "Trailer Inspection Results", "type": "section", "row": 4, "col": 1, "span": 24,
         "children": "checklist (20 sub-sections, each = Fail checkbox | Pass checkbox | Comments)"},
        {"name": "InspectorSignature", "label": "Inspector Signature", "type": "signature", "mode": "draw", "row": 5, "col": 1, "span": 24},
        {"name": "InspectionDate", "label": "Inspection Date", "type": "date", "row": 6, "col": 1, "span": 24},
        {"type": "pagebreak", "row": 7, "nextButton": "Submit"},
    ],
    "checklist": checklist,
    "workflow": {
        "roles": [
            {"id": 0, "name": "Inspector", "public": True},
            {"id": 1, "name": "Form Creator / Internal Reviewer", "internal": True},
        ],
        "statuses": [
            {"id": 0, "name": "Incomplete", "color": "gray"},
            {"id": 1, "name": "Submitted", "color": "teal"},
            {"id": 2, "name": "Reviewed", "color": "yellow"},
            {"id": 3, "name": "Approved", "color": "green"},
        ],
        "actions": [
            {"id": 0, "name": "SubmitInspection", "button": "SubmitInspection",
             "allowedWhen": "status == 'Incomplete' AND role == 'Inspector'", "newStatus": "Submitted", "confirmation": CONF,
             "emails": [{"from": "sales@fueltrailers.co.za", "to": ["sales@fueltrailers.co.za"],
                         "subject": "Trailer Inspection Submitted",
                         "body": "An inspector has submitted the Trailer Inspection Checklist. Please review the inspection results.",
                         "includeEntryDetails": True, "linkForRole": "Form Creator / Internal Reviewer"}]},
            {"id": 1, "name": "RequestReviewChanges", "button": "RequestReviewChanges",
             "allowedWhen": "status == 'Submitted' AND role == 'Form Creator / Internal Reviewer'", "newStatus": "Submitted",
             "confirmation": CONF,
             "note": "Cognito keeps status at Submitted (probably intended to go back to Incomplete so the Inspector can edit - confirm with client)",
             "emails": [{"from": "sales@fueltrailers.co.za", "to": ["[InspectorEmail]"],
                         "subject": "Trailer Inspection Needs Changes",
                         "body": "Your Trailer Inspection Checklist submission requires changes. Please update the inspection details and resubmit.",
                         "includeEntryDetails": True, "linkForRole": "Inspector"}]},
            {"id": 2, "name": "MarkReviewed", "button": "MarkReviewed",
             "allowedWhen": "status == 'Submitted' AND role == 'Form Creator / Internal Reviewer'", "newStatus": "Reviewed",
             "confirmation": CONF,
             "emails": [{"from": "sales@fueltrailers.co.za", "to": ["[InspectorEmail]"],
                         "subject": "Trailer Inspection Reviewed",
                         "body": "Your Trailer Inspection Checklist has been reviewed.",
                         "includeEntryDetails": True, "linkForRole": "Inspector"}]},
            {"id": 3, "name": "ApproveInspection", "button": "ApproveInspection",
             "allowedWhen": "status == 'Reviewed' AND role == 'Form Creator / Internal Reviewer'", "newStatus": "Approved",
             "confirmation": CONF,
             "emails": [{"from": "sales@fueltrailers.co.za", "to": ["[InspectorEmail]"],
                         "subject": "Trailer Inspection Approved",
                         "body": "Your Trailer Inspection Checklist has been approved.",
                         "includeEntryDetails": True, "linkForRole": "Inspector"}]},
        ],
    },
    "documents": [
        {"number": 1, "mode": "view", "output": "pdf"},
        {"number": 2, "mode": "edit", "output": "pdf"},
    ],
}

for obj in (store_room, inspection):
    (OUT / f"{obj['slug']}.json").write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print("wrote", obj["slug"])
