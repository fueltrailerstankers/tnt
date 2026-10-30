// Stock locations and the 52 product models, as data. Pure.
// Same order and spelling as the seed in supabase/migrations/0011_stock.sql (tests/unit/stock-models.test.ts
// parses the SQL and compares). Keep the client's spelling ("SINGEL", "CRADEL", "Dubbel axel") so descriptions
// match the DEAL form and Xero text.

export const MODEL_CATEGORIES = [
  'animal_trailer',
  'car_trailer',
  'metal_bowser',
  'poly_bowser',
  'stainless_bowser',
  'cradle_tank',
  'skid_tank',
  'cargo_trailer',
  'vendor_box',
] as const;
export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

export interface StockModelDef {
  partNumber: string;
  description: string;
  category: ModelCategory;
}

export const STOCK_MODELS: readonly StockModelDef[] = [
  { partNumber: 'CTLL1', description: '3 meter animal trailer NO BRAKES 750 KGS GWM', category: 'animal_trailer' },
  { partNumber: 'CTLL2', description: '3 meter animal trailer SINGEL BRAKE 1500KG GWM', category: 'animal_trailer' },
  { partNumber: 'CTLL3', description: '4 meter animal trailer SINGEL BRAKE 1500 KG GWM', category: 'animal_trailer' },
  { partNumber: 'CTLL3D', description: '4 meter animal trailer TWIN BRAKE 3000 KG GWM', category: 'animal_trailer' },
  { partNumber: 'CTTL4D', description: '5 meter animal trailer TWIN BRAKE 3000 KG GWM', category: 'animal_trailer' },
  { partNumber: 'CT1', description: '4 meter car trailer SINGEL BRAKE 1500 GWM', category: 'car_trailer' },
  { partNumber: 'CT2', description: '5 meter car trailer SINGEL BRAKE 1500 KG GWM', category: 'car_trailer' },
  { partNumber: 'CT3', description: '5 meter car trailer TWIN BRAKE 3000 KG GWM', category: 'car_trailer' },
  { partNumber: '500D', description: '500 litre metal bowser', category: 'metal_bowser' },
  { partNumber: '1000D', description: '1000 litre metal bowser', category: 'metal_bowser' },
  { partNumber: '1000DB', description: '1000 litre metal bowser', category: 'metal_bowser' },
  { partNumber: '2000D', description: '2000 litre metal bowser', category: 'metal_bowser' },
  { partNumber: '2500D', description: '2500 litre metal bowser', category: 'metal_bowser' },
  { partNumber: '3000D', description: '3000 litre metal bowser', category: 'metal_bowser' },
  { partNumber: '5000D', description: '5000 litre metal bowser', category: 'metal_bowser' },
  { partNumber: '500P', description: '500 litre polyurethane bowser', category: 'poly_bowser' },
  { partNumber: '1000PB', description: '1000 litre polyurethane bowser', category: 'poly_bowser' },
  { partNumber: '1000P', description: '1000 litre polyurethane bowser', category: 'poly_bowser' },
  { partNumber: '2500P', description: '2500 litre polyurethane bowser', category: 'poly_bowser' },
  { partNumber: '500S', description: '500 litre stainless bowser MADE FROM 3CR12', category: 'stainless_bowser' },
  { partNumber: '1000SB', description: '1000 litre stainless bowser MADE FROM 3CR12', category: 'stainless_bowser' },
  { partNumber: '2000S', description: '2000 litre stainless steel bowser MADE FROM 3CR12', category: 'stainless_bowser' },
  { partNumber: '2500S', description: '2500 litre stainless bowser MADE FROM 3CR12', category: 'stainless_bowser' },
  { partNumber: '3000S', description: '3000 litre stainless bowser MADE FROM 3CR12', category: 'stainless_bowser' },
  { partNumber: 'TS1', description: '1000 LITER TANK ON LOOSE CRADEL STAND', category: 'cradle_tank' },
  { partNumber: 'TS2', description: '2000 LITER TANK ON LOOSE CRADEL STAND', category: 'cradle_tank' },
  { partNumber: 'TS25', description: '2500 LITER TANK ON LOOSE CRADEL STAND', category: 'cradle_tank' },
  { partNumber: 'TS3', description: '3000 LITER TANK ON LOOSE CRADEL STAND', category: 'cradle_tank' },
  { partNumber: 'TS5', description: '5000 LITER TANK ON LOOSE CRADEL STAND', category: 'cradle_tank' },
  { partNumber: 'SK5P', description: '500 LITER PLASTIC TANK ON METAL SKID BASE', category: 'skid_tank' },
  { partNumber: 'SK1P', description: '1000 LITER PLASTIC TANK ON METAL SKID BASE', category: 'skid_tank' },
  { partNumber: 'SK25P', description: '2500 LITER PLASTIC TANK ON METAL SKID BASE', category: 'skid_tank' },
  { partNumber: 'SK1', description: '500 LITER TANK ON SKID', category: 'skid_tank' },
  { partNumber: 'SK2', description: '1000 LITER TANK ON SKID', category: 'skid_tank' },
  { partNumber: 'SK3', description: '2000 LITER TANK ON SKID', category: 'skid_tank' },
  { partNumber: 'SK4', description: '2500 LITER TANK ON SKID', category: 'skid_tank' },
  { partNumber: 'SK5', description: '3000 LITER TANK ON SKID', category: 'skid_tank' },
  { partNumber: 'SK6', description: '5000 LITER TANK ON SKID', category: 'skid_tank' },
  { partNumber: 'C200', description: '2 meter cargo trailer', category: 'cargo_trailer' },
  { partNumber: 'C30075', description: '3 meter cargo trailer', category: 'cargo_trailer' },
  { partNumber: 'C30015', description: '3 meter cargo trailer', category: 'cargo_trailer' },
  { partNumber: 'C400', description: '4 meter cargo trailer', category: 'cargo_trailer' },
  { partNumber: 'C400D', description: '4 meter cargo trailer double axel', category: 'cargo_trailer' },
  { partNumber: 'C300D', description: '3 meter cargo trailer Dubbel axel', category: 'cargo_trailer' },
  { partNumber: 'FTE', description: 'VENDOR TRAILER', category: 'vendor_box' },
  { partNumber: 'BOX01', description: '2, 4 METER BOX', category: 'vendor_box' },
  { partNumber: 'BOX02', description: '3 METER BOX', category: 'vendor_box' },
  { partNumber: 'BOX04', description: '4 METER BOX', category: 'vendor_box' },
  { partNumber: 'BOX07', description: 'ISOLATED VENDOR TRAILER', category: 'vendor_box' },
  { partNumber: 'BOX08', description: '2 METER ISOLATED VENDOR TRAILER', category: 'vendor_box' },
  { partNumber: 'BOX09', description: '3 METER ISOLATED VENDOR TRAILER', category: 'vendor_box' },
  { partNumber: 'BOX10', description: '4 METER ISOLATED VENDOR TRAILER', category: 'vendor_box' },
];

export interface StockLocationDef {
  id: string;
  name: string;
  isFactory: boolean;
  sortOrder: number;
}

/** Seeded for the default org. FACTORY is not a branch: it is excluded from branch counts. */
export const STOCK_LOCATIONS: readonly StockLocationDef[] = [
  { id: 'FACTORY', name: 'Factory', isFactory: true, sortOrder: 0 },
  { id: 'JHB', name: 'Johannesburg', isFactory: false, sortOrder: 1 },
  { id: 'CPT', name: 'Cape Town', isFactory: false, sortOrder: 2 },
  { id: 'DBN', name: 'Durban', isFactory: false, sortOrder: 3 },
];

/** Part number key used for matching: upper case, no whitespace ("ctll 3d " -> "CTLL3D"). */
export function partKey(v: string | null | undefined): string {
  return (v ?? '').replace(/\s/g, '').toUpperCase();
}
