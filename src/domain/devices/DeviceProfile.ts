import type { ConfigurationFieldDefinition } from "../configuration/DeviceConfiguration";

export type ConfigurationProtocol = "STANDARD_MBUS" | "ITRON_CYBLE" | "RELAY" | "SONTEX" | "KAMSTRUP";

export interface DeviceProfileIdentification {
  manufacturerCode?: string;
  manufacturerRaw?: number;
  medium?: string;
  mediumRaw?: number;
  version?: string;
  identificationPattern?: string;
  telegramSignature?: string;
}

export interface DeviceProfile {
  id: string;
  manufacturer: string;
  model: string;
  deviceType: string;
  identification: DeviceProfileIdentification;
  supportedBaudRates: number[];
  configurationProtocol: ConfigurationProtocol;
  installerFields: ConfigurationFieldDefinition[];
  isMock: boolean;
}

export interface DeviceProfileRepository {
  getAll(): DeviceProfile[];
  findById(id: string): DeviceProfile | undefined;
}

export type DeviceProfileMatch =
  | { status: "known"; profile: DeviceProfile; matches: DeviceProfile[] }
  | { status: "unknown"; matches: [] }
  | { status: "possible"; profile: DeviceProfile; matches: DeviceProfile[] }
  | { status: "ambiguous"; matches: DeviceProfile[] };
