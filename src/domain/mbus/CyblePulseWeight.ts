export interface CyblePulseWeightOption {
  value: string;
  resolutionCode: number;
}

export const cyblePulseWeightOptions: CyblePulseWeightOption[] = [
  { value: "0.000001", resolutionCode: 0x10 },
  { value: "0.00001", resolutionCode: 0x11 },
  { value: "0.0001", resolutionCode: 0x12 },
  { value: "0.001", resolutionCode: 0x13 },
  { value: "0.01", resolutionCode: 0x14 },
  { value: "0.1", resolutionCode: 0x15 },
  { value: "1", resolutionCode: 0x16 },
  { value: "10", resolutionCode: 0x17 },
];

export function deriveCybleResolutionCodeFromPulseWeight(pulseWeight: string | number): number {
  const value = typeof pulseWeight === "number" ? String(pulseWeight) : pulseWeight.trim();
  const option = cyblePulseWeightOptions.find((candidate) => candidate.value === value);
  if (!option) throw new Error("Pulse weight must be one of 0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.1, 1 or 10 m³/p.");
  return option.resolutionCode;
}

export function deriveCyblePulseWeightFromResolutionCode(resolutionCode: number): string {
  const option = cyblePulseWeightOptions.find((candidate) => candidate.resolutionCode === resolutionCode);
  if (!option) throw new Error(`Unsupported Cyble Pulse weight resolution code: 0x${resolutionCode.toString(16).toUpperCase().padStart(2, "0")}.`);
  return option.value;
}

export function cyblePulseWeightForResolutionCode(resolutionCode: number): string | undefined {
  return cyblePulseWeightOptions.find((candidate) => candidate.resolutionCode === resolutionCode)?.value;
}

export function sameCyblePulseWeight(left: unknown, right: unknown): boolean {
  try { return deriveCybleResolutionCodeFromPulseWeight(String(left)) === deriveCybleResolutionCodeFromPulseWeight(String(right)); }
  catch { return false; }
}
