import { StatusChip } from '@/components/ui/StatusChip';
import { unitStatusLabel } from '@/lib/stock/errors';

const TONE: Record<string, string> = { available: 'green', reserved: 'yellow', sold: 'gray' };

/** Available (green), Reserved (amber), Sold (grey), as the stock plan's badges. */
export function UnitStatusChip({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return <StatusChip status={unitStatusLabel(status)} color={TONE[status] ?? 'gray'} size={size} />;
}
