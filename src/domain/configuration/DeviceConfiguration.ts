export type ConfigurationFieldType = "integer" | "decimal" | "text" | "select" | "boolean" | "ratio";
export type ConfigurationCategory = "STANDARD_MBUS" | "MANUFACTURER_SPECIFIC" | "LOCAL_METADATA";
export interface ConfigurationRatio { numerator: number; denominator: number; }
export type ConfigurationValue = string | number | boolean | ConfigurationRatio | null;
export type ConfigurationSupport = "SUPPORTED" | "READ_ONLY" | "LOCAL_ONLY" | "NOT_IMPLEMENTED";

export interface ConfigurationOption {
  value: string | number | boolean;
  label: string;
}

export interface ConfigurationFieldDefinition {
  id: string;
  label: string;
  type: ConfigurationFieldType;
  category: ConfigurationCategory;
  unit?: string;
  required: boolean;
  editable: boolean;
  minimum?: number;
  maximum?: number;
  options?: ConfigurationOption[];
  pattern?: string;
  readSupport: ConfigurationSupport;
  writeSupport: ConfigurationSupport;
  verificationSupport: ConfigurationSupport;
  kind?: "VALUE" | "ACTION";
}

export interface ConfigurationField extends ConfigurationFieldDefinition {
  currentValue: ConfigurationValue;
  requestedValue: ConfigurationValue;
}

export interface DeviceConfiguration {
  deviceId: string;
  profileId?: string;
  readAt: string;
  fields: ConfigurationField[];
  device?: import("../mbus/MbusDevice").MbusDevice;
  writeProtected?: boolean;
}

export interface ConfigurationValidationIssue {
  fieldId: string;
  message: string;
}

export interface ConfigurationValidation {
  valid: boolean;
  issues: ConfigurationValidationIssue[];
}

export type ConfigurationWriteStatus =
  | "Success"
  | "Rejected"
  | "NoAck"
  | "Timeout"
  | "ProtocolError"
  | "Unsupported"
  | "VerificationFailed"
  | "AddressInUse";

export interface TechnicalTelegram {
  timestamp: string;
  direction: "TX" | "RX";
  operation: string;
  primaryAddress?: number;
  secondaryId?: string;
  rawTelegram: string;
  parsedResult?: string;
}

export interface ConfigurationWriteResult {
  status: ConfigurationWriteStatus;
  message: string;
  telegrams: TechnicalTelegram[];
}

export interface ConfigurationFieldVerification {
  fieldId: string;
  requestedValue: ConfigurationValue;
  readBackValue: ConfigurationValue;
  verified: boolean;
}

export interface ConfigurationVerificationResult {
  status: "Verified" | "VerificationFailed" | "Unsupported";
  message: string;
  fields: ConfigurationFieldVerification[];
}

export interface ConfigureDeviceResult {
  status: ConfigurationWriteStatus;
  commandsAttempted: number;
  commandsAcknowledged: number;
  rereadSuccessful: boolean;
  validationSuccessful: boolean;
  errors: ConfigurationError[];
  write: ConfigurationWriteResult;
  readBack?: DeviceConfiguration;
  verification: ConfigurationVerificationResult;
}

export interface ConfigurationError {
  stage: "validation" | "writing" | "ack" | "reread" | "verification";
  message: string;
}

export function changedFields(configuration: DeviceConfiguration): ConfigurationField[] {
  const mediumField = configuration.fields.find((field) => field.id === "medium");
  const requestedMedium = mediumField?.requestedValue;
  return configuration.fields.filter((field) => {
    const inactiveCybleGasField = configuration.profileId === "itron-cyble-mbus-v2" && mediumField !== undefined && requestedMedium !== 0x03 && (field.id === "pulseWeightX10" || field.id === "correctedVolume");
    return !inactiveCybleGasField && !sameValue(field.requestedValue, field.currentValue);
  });
}

export function sameValue(left: ConfigurationValue, right: ConfigurationValue): boolean {
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) return left.numerator === right.numerator && left.denominator === right.denominator;
  return left === right;
}

export function withRequestedValue(configuration: DeviceConfiguration, fieldId: string, value: ConfigurationValue): DeviceConfiguration {
  return {
    ...configuration,
    fields: configuration.fields.map((field) => field.id === fieldId ? { ...field, requestedValue: value } : field),
  };
}

export function resetRequestedValues(configuration: DeviceConfiguration): DeviceConfiguration {
  return {
    ...configuration,
    fields: configuration.fields.map((field) => ({ ...field, requestedValue: field.currentValue })),
  };
}
