import { cyblePulseWeightForResolutionCode } from "./CyblePulseWeight.ts";

export interface CybleVolumeEncoding {
  normalized: string;
  raw: number;
  resolution: string;
  vif: number;
  pulseWeightLitres: number;
}

export function deriveCybleVolumeEncoding(input: string): CybleVolumeEncoding {
  const normalizedInput = input.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalizedInput)) throw new Error("Volume must be a non-negative decimal with at most 6 decimal places.");
  const [integer, fraction = ""] = normalizedInput.split(".");
  if (`${integer}${fraction}`.length > 8) throw new Error("Volume must contain at most 8 digits in total.");
  const preferredScaleDigits = Math.min(2, Math.max(0, 8 - integer.length));
  const scaleDigits = Math.max(preferredScaleDigits, fraction.length);
  const vif = 0x16 - scaleDigits;
  const resolution = cyblePulseWeightForResolutionCode(vif) ?? (scaleDigits === 0 ? "1" : `0.${"0".repeat(scaleDigits - 1)}1`);
  const rawInteger = BigInt(`${integer}${fraction.padEnd(scaleDigits, "0")}`);
  if (rawInteger > 99_999_999n) throw new Error(`Volume cannot be represented exactly at ${resolution} m³ resolution.`);
  return {
    normalized: fraction ? `${integer}.${fraction}` : integer,
    raw: Number(rawInteger),
    resolution,
    vif,
    pulseWeightLitres: 1000 / (10 ** scaleDigits),
  };
}

export function sameCyblePhysicalVolume(left: string, right: string): boolean {
  try { return canonicalDecimal(deriveCybleVolumeEncoding(left).normalized) === canonicalDecimal(deriveCybleVolumeEncoding(right).normalized); }
  catch { return false; }
}

function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const canonicalInteger = integer.replace(/^0+(?=\d)/, "");
  const canonicalFraction = fraction.replace(/0+$/, "");
  return canonicalFraction ? `${canonicalInteger}.${canonicalFraction}` : canonicalInteger;
}
