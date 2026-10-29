// DEAL custom documents, reproduced from the fields Make fills (BUILD_PLAN §4.1) until the Cognito Word
// template (content/templates/deal.docx) is available:
//   #3 deal sheet: Deal no, Month, Quote no, Sales rep, Collection, Part no + Line 1..8, Total, Date created
//   #4 collection sheet: TO = first collection location, Date, lines 1..4
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { displayValue, type EntryData } from '@/lib/spec/values';
import { formatTime, styles } from './EntryPdf';

interface DealProps {
  entryNumber: number;
  data: EntryData;
  timezone: string;
  generatedAt: string;
}

const v = (d: EntryData, k: string) => displayValue(d[k]);

function KV({ k, val }: { k: string; val: string }) {
  return (
    <View style={styles.tr}>
      <Text style={[styles.label, { width: '30%' }]}>{k}</Text>
      <Text style={{ width: '70%' }}>{val || ' '}</Text>
    </View>
  );
}

function Lines({ d, count }: { d: EntryData; count: number }) {
  return (
    <View style={[styles.table, { marginTop: 10 }]}>
      <View style={styles.tr}>
        <Text style={[styles.label, { width: '8%' }]}>#</Text>
        <Text style={[styles.label, { width: '27%' }]}>PART NO</Text>
        <Text style={[styles.label, { width: '65%' }]}>LINE</Text>
      </View>
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <View key={n} style={styles.tr}>
          <Text style={{ width: '8%' }}>{n}</Text>
          <Text style={{ width: '27%' }}>{v(d, `PARTNO${n}`) || ' '}</Text>
          <Text style={{ width: '65%' }}>{v(d, `LINE${n}`) || ' '}</Text>
        </View>
      ))}
    </View>
  );
}

function Header({ title, generatedAt, timezone }: { title: string; generatedAt: string; timezone: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.org}>TRAILERS & TANKERS</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>Generated {formatTime(generatedAt, timezone)}</Text>
    </View>
  );
}

export function DealSheetPdf({ entryNumber, data, timezone, generatedAt }: DealProps) {
  const title = `DEAL - ${entryNumber}`;
  return (
    <Document title={title} author="Trailers & Tankers">
      <Page size="A4" style={styles.page}>
        <Header title={title} generatedAt={generatedAt} timezone={timezone} />
        <View style={styles.table}>
          <KV k="DEAL NO" val={String(entryNumber)} />
          <KV k="MONTH" val={v(data, 'MONTH')} />
          <KV k="QUOTE NO" val={v(data, 'QUOTENO')} />
          <KV k="SALES REP" val={v(data, 'SALESREP')} />
          <KV k="COLLECTION" val={v(data, 'COLLECTIONLOCATION')} />
          <KV k="DATE CREATED" val={v(data, 'DATECREATED')} />
        </View>
        <Lines d={data} count={8} />
        <View style={[styles.table, { marginTop: 10 }]}>
          <KV k="TOTAL" val={v(data, 'Total')} />
        </View>
      </Page>
    </Document>
  );
}

export function CollectionSheetPdf({ entryNumber, data, timezone, generatedAt }: DealProps) {
  const title = `COLLECTION - DEAL ${entryNumber}`;
  const locations = Array.isArray(data.COLLECTIONLOCATION) ? (data.COLLECTIONLOCATION as string[]) : [];
  return (
    <Document title={title} author="Trailers & Tankers">
      <Page size="A4" style={styles.page}>
        <Header title={title} generatedAt={generatedAt} timezone={timezone} />
        <View style={styles.table}>
          <KV k="TO" val={locations[0] ?? ''} />
          <KV k="DATE" val={v(data, 'DATECREATED')} />
          <KV k="QUOTE NO" val={v(data, 'QUOTENO')} />
        </View>
        <Lines d={data} count={4} />
      </Page>
    </Document>
  );
}
