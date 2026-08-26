export interface MbusUnitOption { label: string; vif: number; quantity: "energy" | "volume" | "mass"; factor: number; symbol: string; }

export const padPulsUnitOptions: MbusUnitOption[] = [
  ...units(0x00, "energy", "Wh", [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000]),
  ...units(0x08, "energy", "J", [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000]),
  ...units(0x10, "volume", "m³", [0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.1, 1, 10]),
  ...units(0x18, "mass", "kg", [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000]),
];

export function unitForVif(vif: number): MbusUnitOption | undefined { return padPulsUnitOptions.find((option) => option.vif === (vif & 0x7f)); }

export function physicalRepresentationForVif(vif: number): string | undefined {
  const code = vif & 0x7f;
  if (code <= 0x07) return `10^${code - 0x03} Wh`;
  if (code <= 0x0f) return `10^${code - 0x08} J`;
  if (code <= 0x17) return `10^${code - 0x16} m³`;
  if (code <= 0x1f) return `10^${code - 0x1b} kg`;
  return undefined;
}

export function describePulseValue(numerator: number, denominator: number, vif: number): string {
  const unit = unitForVif(vif);
  if (!unit || denominator === 0) return "Pulse value unavailable";
  const [amount, ...symbol] = unit.label.split(" ");
  return `1 pulse = ${formatNumber((numerator / denominator) * Number(amount))} ${symbol.join(" ")}`;
}

function units(start: number, quantity: MbusUnitOption["quantity"], baseSymbol: string, factors: number[]): MbusUnitOption[] {
  return factors.map((factor, index) => ({ label: humanUnit(factor, baseSymbol), vif: start + index, quantity, factor, symbol: displaySymbol(factor, baseSymbol) }));
}

function humanUnit(factor: number, symbol: string): string { return displaySymbol(factor, symbol); }
function displaySymbol(factor: number, symbol: string): string {
  if (symbol === "Wh") return factor >= 1000 ? `${factor / 1000} kWh` : factor < 1 ? `${factor * 1000} mWh` : `${factor} Wh`;
  if (symbol === "J") return factor >= 1000000 ? `${factor / 1000000} MJ` : factor >= 1000 ? `${factor / 1000} kJ` : `${factor} J`;
  if (symbol === "m³") return factor >= 1 ? `${factor} m³` : `${factor * 1000} L`;
  if (symbol === "kg") return factor >= 1 ? `${factor} kg` : `${factor * 1000} g`;
  return `${factor} ${symbol}`;
}
function formatNumber(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""); }
