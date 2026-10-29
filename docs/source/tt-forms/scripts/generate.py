"""Generates docs/forms/*.md, supabase/migrations/0002_form_views.sql and 0003_seed_forms.sql
from spec/forms/*.json (the single source of truth).  Run: python3 scripts/generate.py"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec" / "forms"
DOCS = ROOT / "docs" / "forms"
MIG = ROOT / "supabase" / "migrations"
ORDER = ["deal", "delivery-note", "release-form", "request-for-invoice", "store-room",
         "trailer-inspection-checklist", "job-card"]

specs = [json.loads((SPEC / f"{s}.json").read_text()) for s in ORDER]


def snake(name: str) -> str:
    s = name.lstrip("_")
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").lower()
    if s[:1].isdigit():
        s = "f_" + s
    return s


def type_desc(f):
    t = f["type"]
    bits = [t]
    if f.get("style"): bits.append(f["style"])
    if f.get("multi"): bits.append("multiple")
    if f.get("maxFiles"): bits.append(f"max {f['maxFiles']} files")
    if f.get("parts"): bits.append("(" + ", ".join(f["parts"]) + ")")
    if f.get("integer"): bits.append("integer, 0 dp")
    if f.get("mode"): bits.append(f["mode"])
    return " ".join(bits)


def rules(f):
    out = []
    if f.get("required"): out.append("**Required**")
    if f.get("default"): out.append(f"Default: `{f['default']}`")
    if f.get("options"): out.append("Options: " + ", ".join(f["options"]))
    if f.get("customError"):
        ce = f["customError"]
        out.append(f"Error when {ce['when']} → \"{ce['message']}\" (`{ce['cognitoExpr']}`)")
    if f.get("lookup"):
        out.append(f"Lookup → {f['lookup']['sourceForm']} (shows {f['lookup']['displayField']})")
    if f.get("hideLabel"): out.append("Label hidden")
    if f.get("protected"): out.append("Protected/masked")
    if f.get("accept"): out.append(f"accept {f['accept']}")
    if f.get("note"): out.append(f["note"])
    if f.get("purpose"): out.append(f["purpose"])
    if f.get("rebuildAs"): out.append("Rebuild: " + f["rebuildAs"])
    return "; ".join(out)


def md_for(s):
    L = [f"# {s['name']}", "",
         f"- Route (public): `/f/{s['slug']}`  ·  Admin: `/admin/forms/{s['slug']}`",
         f"- Cognito form id: {s['cognitoFormId']}  ·  internal name `{s['internalName']}`",
         f"- Entries at export: {s.get('entryCountAtExport')}",
         f"- Entry summary / title template: `{s['settings'].get('entrySummary')}`"]
    st = s["settings"]
    if st.get("encryptEntries"): L.append("- Entries encrypted at rest (Cognito 'Encrypt entries' ON) → encrypt `data` column / use pgsodium or app-level encryption")
    if st.get("preventLookup"): L.append("- Prevent lookup ON: this form cannot be used as a lookup source")
    if st.get("pages"): L.append(f"- Multi-page: {', '.join(st['pages'])} (step progress bar, show page numbers + titles)")
    L += ["", "## Fields (in display order; 24-column grid)", "",
          "| Row | Col | Span | Field key (Cognito) | DB key | Label | Type | Rules / notes |",
          "|---|---|---|---|---|---|---|---|"]
    for f in s["fields"]:
        if f["type"] == "pagebreak":
            L.append(f"| {f['row']} | | 24 | — | — | **— page break {f.get('pageTitle','')}** | pagebreak | Next button: \"{f['nextButton']}\"" +
                     (f", Back button: \"{f['backButton']}\"" if f.get('showBackButton') else "") + " |")
            continue
        if f["type"] == "content":
            src = f.get("contentRef") or ("inline: " + re.sub("<[^>]+>", "", f.get("html", "")).replace("&nbsp;", " ").strip())
            L.append(f"| {f['row']} | {f['col']} | {f['span']} | — | — | (content block) | content | {src} |")
            continue
        label = f.get("label", "").replace("|", "\\|")
        L.append(f"| {f['row']} | {f['col']} | {f['span']} | `{f.get('cognitoFieldName', f['name'])}` | `{snake(f['name'])}` | {label} | {type_desc(f)} | {rules(f).replace('|','/')} |")
    if s.get("checklist"):
        L += ["", "## Checklist items (section `Trailer Inspection Results`)", "",
              "Each item renders as a sub-section titled with the item text, containing: **Fail** (checkbox, col 1 span 12) · **Pass** (checkbox, col 13 span 12) · **Comments** (multi-line, full width). No validation (Pass/Fail are independent checkboxes, both can be ticked in Cognito).", "",
              "| # | Item | Cognito names (Fail / Pass / Comments) |", "|---|---|---|"]
        for it in s["checklist"]:
            n = [x["cognitoName"] for x in it["fields"]]
            L.append(f"| {it['itemNo']} | {it['label']} | {n[0]} / {n[1]} / {n[2]} |")
    wf = s["workflow"]
    L += ["", "## Workflow", "", "**Roles:** " + ", ".join(
        f"{r['name']} ({'public' if r.get('public') else 'internal'})" for r in wf["roles"]), "",
          "**Statuses:** " + ", ".join(
              f"{x['name']} [{x['color']}]" + (" (archived → " + x['replacedBy'] + ")" if x.get('archived') else "") for x in wf["statuses"]), "",
          "| Action | Button | Allowed when | → New status | Emails |", "|---|---|---|---|---|"]
    for a in wf["actions"]:
        em = []
        for e in a.get("emails", []):
            d = "to " + ", ".join(e["to"])
            if e.get("from"): d += f" (from {e['from']})"
            if e.get("subject"): d += f"; subject \"{e['subject']}\""
            if e.get("body") and not e["body"].startswith("<p>"): d += f"; body \"{e['body']}\""
            elif e.get("body"): d += "; body = link to entry"
            flags = [k for k in ("includeReceipt", "includeEntryDetails", "includeAttachments", "includeDocumentAttachments") if e.get(k)]
            if e.get("attachDocuments"): flags.append(f"attach PDF doc #{e['attachDocuments']}")
            if e.get("linkForRole"): flags.append(f"contains link for role '{e['linkForRole']}'")
            if flags: d += " [" + ", ".join(flags) + "]"
            em.append(d)
        note = f" — _{a['note']}_" if a.get("note") else ""
        L.append(f"| {a['name']} | {a['button']} | `{a['allowedWhen']}` | {a.get('newStatus','(unchanged)')} | {'<br>'.join(em) or '—'}{note} |")
    L += ["", "Confirmation message (all actions): \"Thank you for filling out the form. Your response has been recorded.\"", "",
          "## Documents (PDF)", ""]
    for d in s["documents"]:
        L.append(f"- #{d['number']} {d['mode']} → {d['output']}" + (f" — name `{d['name']}`" if d.get('name') else "") +
                 (f" — {d['template']}" if d.get('template') else "") + (f" — {d['note']}" if d.get('note') else ""))
    return "\n".join(L) + "\n"


def sql_view(s):
    cols = ["e.id", "e.number", "e.status", "e.summary", "e.created_at", "e.submitted_at", "e.updated_at"]
    for f in s["fields"]:
        t = f["type"]
        if t in ("pagebreak", "content", "section"): continue
        k, c = f["name"], snake(f["name"])
        if t in ("text", "textarea", "email"):
            cols.append(f"e.data->>'{k}' as {c}")
        elif t == "choice":
            cols.append(f"e.data->'{k}' as {c}" if f.get("multi") else f"e.data->>'{k}' as {c}")
        elif t == "date":
            cols.append(f"nullif(e.data->>'{k}','')::date as {c}")
        elif t == "number":
            cols.append(f"nullif(e.data->>'{k}','')::numeric as {c}")
        elif t == "yesno":
            cols.append(f"(e.data->>'{k}')::boolean as {c}")
        elif t == "name":
            cols.append(f"e.data->'{k}'->>'First' as {c}_first")
            cols.append(f"e.data->'{k}'->>'Last' as {c}_last")
        elif t == "address":
            for p in f["parts"]:
                cols.append(f"e.data->'{k}'->>'{p}' as {c}_{snake(p)}")
        elif t == "lookup":
            cols.append(f"nullif(e.data->>'{k}','')::uuid as {c}_entry_id")
        elif t in ("file", "signature"):
            cols.append(f"(select count(*) from public.entry_files ef where ef.entry_id = e.id and ef.field_key = '{k}') as {c}_count")
    name = "v_" + s["slug"].replace("-", "_")
    return (f"create or replace view public.{name} with (security_invoker = true) as\nselect\n  " + ",\n  ".join(cols) +
            f"\nfrom public.entries e join public.forms f on f.id = e.form_id\nwhere f.slug = '{s['slug']}';\n")


DOCS.mkdir(parents=True, exist_ok=True)
for s in specs:
    (DOCS / f"{s['slug']}.md").write_text(md_for(s))

views = ["-- GENERATED by scripts/generate.py from spec/forms/*.json — do not edit by hand", ""]
views += [sql_view(s) for s in specs]
v_insp = """create or replace view public.v_trailer_inspection_items with (security_invoker = true) as
select e.id as entry_id, e.number, (item->>'itemNo')::int as item_no, item->>'label' as item,
       coalesce((item->>'fail')::boolean,false) as fail, coalesce((item->>'pass')::boolean,false) as pass, item->>'comments' as comments
from public.entries e join public.forms f on f.id = e.form_id
cross join lateral jsonb_array_elements(e.data->'checklist') item
where f.slug = 'trailer-inspection-checklist';
"""
views.append(v_insp)
(MIG / "0002_form_views.sql").write_text("\n".join(views))

seed = ["-- GENERATED by scripts/generate.py — seeds forms, statuses, roles from the spec", ""]
for i, s in enumerate(specs):
    spec_json = json.dumps(s, ensure_ascii=False).replace("'", "''")
    seed.append(f"insert into public.forms (slug, name, internal_name, cognito_form_id, sort_order, entry_summary_template, encrypt_entries, spec)\n"
                f"values ('{s['slug']}', '{s['name'].replace(chr(39), chr(39)*2)}', '{s['internalName']}', {s['cognitoFormId']}, {i+1}, "
                f"'{s['settings'].get('entrySummary','')}', {str(bool(s['settings'].get('encryptEntries'))).lower()}, '{spec_json}'::jsonb)\n"
                f"on conflict (slug) do update set spec = excluded.spec, name = excluded.name;")
    for j, st in enumerate(s["workflow"]["statuses"]):
        seed.append(f"insert into public.form_statuses (form_id, name, color, sort_order, archived) select id, '{st['name']}', '{st['color']}', {j}, {str(bool(st.get('archived'))).lower()} from public.forms where slug='{s['slug']}' on conflict do nothing;")
    for r in s["workflow"]["roles"]:
        seed.append(f"insert into public.form_roles (form_id, name, is_public) select id, '{r['name']}', {str(bool(r.get('public'))).lower()} from public.forms where slug='{s['slug']}' on conflict do nothing;")
    seed.append("")
(MIG / "0003_seed_forms.sql").write_text("\n".join(seed))
print("generated", len(specs), "forms")
