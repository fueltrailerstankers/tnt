const COLORS: Record<string, string> = {
  gray: 'bg-neutral-100 text-neutral-800 ring-neutral-300',
  teal: 'bg-teal-50 text-teal-800 ring-teal-300',
  yellow: 'bg-yellow-50 text-yellow-900 ring-yellow-300',
  green: 'bg-green-50 text-green-800 ring-green-300',
  red: 'bg-red-50 text-red-800 ring-red-300',
};

export function StatusChip({ status, color }: { status: string; color: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${COLORS[color] ?? COLORS.gray}`}>
      {status}
    </span>
  );
}
