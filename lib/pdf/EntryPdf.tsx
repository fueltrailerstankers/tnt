// Generic "view" PDF (document #1) for every form: title, entry number and status, every field in
// spec order including blanks, content blocks (T&Cs, waiver) verbatim, checklist, signatures as images.
// The Delivery Note's #1 is this document: T&Cs, waiver and all five signatures are spec fields.
import { Document, Image, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { contentBlocks, type Block, type Span } from '@/lib/spec/content';
import { pages } from '@/lib/spec/layout';
import type { FormSpec } from '@/lib/spec/types';
import { displayValue, type ChecklistRow, type EntryData } from '@/lib/spec/values';

export interface PdfEntry {
  number: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PdfProps {
  spec: FormSpec;
  title: string;
  entry: PdfEntry;
  data: EntryData;
  /** File names per file field (documents for staff; never logged). */
  files: Record<string, string[]>;
  /** PNG bytes per signature field. */
  signatures: Record<string, Buffer>;
  /** Display-only lookup panel text (Delivery Note customer details). */
  lookupPanel?: Array<[string, string]>;
  timezone: string;
  generatedAt: string;
}

export const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  header: { borderBottom: '1pt solid #333', paddingBottom: 6, marginBottom: 10 },
  org: { fontSize: 8, color: '#555' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  meta: { fontSize: 8, color: '#555', marginTop: 2 },
  pageTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
  row: { flexDirection: 'row', marginBottom: 4 },
  cell: { paddingRight: 6 },
  label: { fontSize: 7.5, color: '#555', fontFamily: 'Helvetica-Bold' },
  value: { fontSize: 9, minHeight: 11, borderBottom: '0.5pt solid #bbb', paddingBottom: 1 },
  content: { border: '0.5pt solid #bbb', padding: 6, marginBottom: 4 },
  para: { fontSize: 7.5, marginBottom: 3, lineHeight: 1.3 },
  bold: { fontFamily: 'Helvetica-Bold' },
  italic: { fontFamily: 'Helvetica-Oblique' },
  boldItalic: { fontFamily: 'Helvetica-BoldOblique' },
  link: { color: '#1a4f8b', textDecoration: 'underline' },
  heading: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 2 },
  help: { fontSize: 7, color: '#555', marginTop: 1 },
  sig: { height: 50, objectFit: 'contain', alignSelf: 'flex-start' },
  table: { borderTop: '0.5pt solid #bbb' },
  tr: { flexDirection: 'row', borderBottom: '0.5pt solid #bbb', paddingVertical: 2 },
  footer: { position: 'absolute', bottom: 16, left: 32, right: 32, fontSize: 7, color: '#777', flexDirection: 'row', justifyContent: 'space-between' },
});

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-ZA', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function spanStyle(s: Span) {
  if (s.href) return styles.link;
  if (s.bold && s.italic) return styles.boldItalic;
  if (s.italic) return styles.italic;
  return s.bold ? styles.bold : undefined;
}

function SpanText({ s }: { s: Span }) {
  return s.href ? <Link src={s.href} style={spanStyle(s)}>{s.text}</Link> : <Text style={spanStyle(s)}>{s.text}</Text>;
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'list') {
          return (
            <View key={i}>
              {b.items.map((it, j) => (
                <Text key={j} style={styles.para}>
                  {b.ordered ? `${j + 1}. ` : '• '}
                  {it.map((s, k) => <SpanText key={k} s={s} />)}
                </Text>
              ))}
            </View>
          );
        }
        if (b.kind === 'heading') {
          return (
            <Text key={i} style={[styles.para, styles.bold]}>
              {b.spans.map((s, j) => <SpanText key={j} s={s} />)}
            </Text>
          );
        }
        return (
          <Text key={i} style={styles.para}>
            {b.spans.map((s, j) => (s.italic || s.href ? <SpanText key={j} s={s} /> : <Text key={j} style={s.bold ? styles.bold : undefined}>{s.text}</Text>))}
          </Text>
        );
      })}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View wrap={false}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function EntryPdf(p: PdfProps) {
  const tz = p.timezone;
  return (
    <Document title={p.title} author="Trailers & Tankers" creator="Trailers & Tankers platform">
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.org}>TRAILERS & TANKERS</Text>
          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.meta}>
            Entry #{p.entry.number} · {p.entry.status} · created {formatTime(p.entry.createdAt, tz)} · updated {formatTime(p.entry.updatedAt, tz)}
          </Text>
        </View>
        {pages(p.spec).map((pg) => (
          <View key={pg.index}>
            {pg.title ? <Text style={styles.pageTitle}>{pg.title}</Text> : null}
            {pg.rows.map((row) => (
              <View key={row.row} style={styles.row}>
                {row.cells.map((c, i) => (
                  <View key={i} style={[styles.cell, { width: `${(c.span / 24) * 100}%` }]}>{renderCell(c.field, p)}</View>
                ))}
              </View>
            ))}
          </View>
        ))}
        <View style={styles.footer} fixed>
          <Text>{p.title}</Text>
          <Text>Generated {formatTime(p.generatedAt, tz)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function renderCell(f: ReturnType<typeof pages>[number]['rows'][number]['cells'][number]['field'], p: PdfProps) {
  switch (f.type) {
    case 'content':
      return (
        <View style={styles.content}>
          <Blocks blocks={contentBlocks(f)} />
        </View>
      );
    case 'signature': {
      const img = p.signatures[f.name];
      return (
        <Field label={f.label}>
          {/* react-pdf Image has no alt; the label above names it. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {img ? <Image style={styles.sig} src={{ data: img, format: 'png' }} /> : <Text style={styles.value}> </Text>}
        </Field>
      );
    }
    case 'file':
      return (
        <Field label={f.label}>
          <Text style={styles.value}>{(p.files[f.name] ?? []).join(', ') || ' '}</Text>
        </Field>
      );
    case 'table':
      return (
        <Field label="Customer details">
          {(p.lookupPanel ?? []).map(([k, v]) => (
            <Text key={k} style={styles.value}>{k}: {v}</Text>
          ))}
          {!p.lookupPanel?.length ? <Text style={styles.value}> </Text> : null}
        </Field>
      );
    case 'section': {
      const rows = (p.data.checklist as ChecklistRow[] | undefined) ?? [];
      return (
        <Field label={f.label}>
          <View style={styles.table}>
            {(p.spec.checklist ?? []).map((item) => {
              const r = rows.find((x) => x.itemNo === item.itemNo);
              return (
                <View key={item.itemNo} style={styles.tr} wrap={false}>
                  <Text style={{ width: '58%' }}>{item.label}</Text>
                  <Text style={{ width: '10%' }}>{r?.fail ? '[x] Fail' : '[ ] Fail'}</Text>
                  <Text style={{ width: '10%' }}>{r?.pass ? '[x] Pass' : '[ ] Pass'}</Text>
                  <Text style={{ width: '22%' }}>{r?.comments ?? ''}</Text>
                </View>
              );
            })}
          </View>
        </Field>
      );
    }
    default:
      return (
        <Field label={f.label.trim() || f.name}>
          <Text style={styles.value}>{displayValue(p.data[f.name]) || ' '}</Text>
        </Field>
      );
  }
}
