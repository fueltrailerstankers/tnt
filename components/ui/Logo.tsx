import Image from 'next/image';

const ALT = 'Trailers & Tankers — sales, spares, repairs';

/** The real logo (988x326). `on-dark` is the white wordmark for charcoal surfaces, `on-light` the charcoal one. Never recolour or stretch. */
export function Logo({ variant, height }: { variant: 'on-dark' | 'on-light'; height: number }) {
  return (
    <Image
      src={`/logo-${variant}.png`}
      alt={ALT}
      width={Math.round((height * 988) / 326)}
      height={height}
      priority
      style={{ height, width: 'auto', flex: 'none', display: 'block' }}
    />
  );
}
