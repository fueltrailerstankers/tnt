// DEAL documents:
//   #3 deal slip: the Cognito custom Word template, reproduced from content/templates/deal.docx
//   #4 collection sheet: Make's Google Sheets document (BUILD_PLAN §4.1), provisional until M3 checks it
//      against Make: TO = first collection location, Date, lines 1..4
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { displayValue, type EntryData } from '@/lib/spec/values';
import { dealSlipBlocks } from './deal-slip';
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

// Layout of the Cognito custom template (content/templates/deal.docx, DEAL template #3): a 72 x 210 mm slip,
// title "DEAL" (12 pt), then one block per field in template order: bold 8 pt label, 8 pt value. A block is
// printed only when its field has a value ({ if FIELD } ... { end if } in the template). Collection locations
// print one per line and use a wider cell. The template has no Total, deal number or date-generated line.
const MM = 72 / 25.4;
export function DealSheetPdf({ entryNumber, data }: DealProps) {
  return (
    <Document title={`DEAL - ${entryNumber}`} author="Trailers & Tankers">
      <Page
        size={[72 * MM, 210 * MM]}
        style={{ paddingTop: 72, paddingBottom: 72, paddingLeft: 7.1, paddingRight: 5.65, fontFamily: 'Helvetica', fontSize: 8, color: '#000' }}
      >
        <Text style={{ fontSize: 12, paddingLeft: 36, marginBottom: 8 }}>DEAL</Text>
        {dealSlipBlocks(data).map((b) => (
          <View key={b.label} wrap={false} style={{ width: b.wide ? '50%' : '41.66%', paddingLeft: 3.6, paddingRight: 2.9 }}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginTop: 6 }}>{b.label}</Text>
            <Text>{b.value}</Text>
          </View>
        ))}
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
