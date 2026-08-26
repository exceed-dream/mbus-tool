export interface MbusMediumOption { code: number; label: string; }

export const MBUS_MEDIUM_GAS = 0x03;
export const MBUS_MEDIUM_COLD_WATER = 0x16;

export const mbusMediumOptions: MbusMediumOption[] = [
  { code: 0x00, label: "Other" }, { code: 0x01, label: "Oil" }, { code: 0x02, label: "Electricity" },
  { code: MBUS_MEDIUM_GAS, label: "Gas" }, { code: 0x04, label: "Heat outlet" }, { code: 0x05, label: "Steam" },
  { code: 0x06, label: "Hot water" }, { code: 0x07, label: "Water" }, { code: 0x08, label: "Heat cost allocator" },
  { code: 0x09, label: "Compressed air" }, { code: 0x0a, label: "Cooling outlet" }, { code: 0x0b, label: "Cooling inlet" },
  { code: 0x0c, label: "Heat inlet" }, { code: 0x0d, label: "Combined heat/cooling" }, { code: 0x0e, label: "Bus/system" },
  { code: 0x0f, label: "Unknown medium" }, { code: MBUS_MEDIUM_COLD_WATER, label: "Cold water" }, { code: 0x17, label: "Dual water" },
  { code: 0x18, label: "Pressure" }, { code: 0x19, label: "A/D converter" },
];

export function mediumLabel(code: number): string { return mbusMediumOptions.find((option) => option.code === code)?.label ?? `Unknown (0x${code.toString(16).padStart(2, "0").toUpperCase()})`; }
