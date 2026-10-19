export type DeviceStatus = "online" | "warning" | "offline";

export interface MbusSecondaryAddress {
  identificationNumber: string;
  manufacturerRaw: number;
  version: number;
  medium: number;
}

export interface MbusDevice {
  id: string;
  primaryAddress?: number;
  secondaryAddress?: MbusSecondaryAddress;
  manufacturer?: string;
  manufacturerRaw?: number;
  model?: string;
  identificationNumber?: string;
  fabricationNumber?: string;
  version?: string;
  medium?: string;
  mediumRaw?: number;
  baudRate: number;
  status: DeviceStatus;
  lastReadAt?: string;
  accessNumber?: number;
  statusByte?: number;
  statusFlags?: string[];
  signature?: string;
  protocolHint?: string;
  padPulsConfiguration?: PadPulsConfiguration;
  cybleConfiguration?: CybleConfiguration;
}

export interface CybleConfiguration {
  primaryAddress: number;
  secondaryId: string;
  customerId: string;
  medium: number;
  volume: string;
  volumeRaw: number;
  volumeVif: number;
  volumeResolution: string;
  pulseWeightLitres: number;
  gasConfiguration?: { x10: boolean; correctedVolume: boolean };
}

export interface PadPulsConfiguration {
  primaryAddress: number;
  secondaryId: string;
  manufacturerRaw: number;
  generation: number;
  medium: number;
  vif: number;
  counter: number;
  numerator: number;
  denominator: number;
  writeProtected: boolean;
}

export function completeSecondaryIdentityKey(device: MbusDevice): string | undefined {
  const identity = device.secondaryAddress;
  if (!identity) return undefined;
  return `${identity.identificationNumber}-${identity.manufacturerRaw}-${identity.version}-${identity.medium}`;
}

export function hasMissingPrimaryAddress(device: MbusDevice): boolean {
  return completeSecondaryIdentityKey(device) !== undefined
    && !(Number.isInteger(device.primaryAddress) && device.primaryAddress! >= 0 && device.primaryAddress! <= 250);
}
