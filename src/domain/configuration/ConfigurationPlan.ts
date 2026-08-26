import type { ConfigurationValue } from "./DeviceConfiguration";

export type ConfigurationPlanOperationKind = "primaryAddress" | "manufacturerFrame";

export interface ConfigurationPlanOperation {
  parameter: string;
  label: string;
  previousValue: ConfigurationValue;
  requestedValue: ConfigurationValue;
  kind: ConfigurationPlanOperationKind;
  targetAddress: number;
  frame?: number[];
  confidence: "CONFIRMED";
}

export interface ConfigurationPlan {
  preparation?: "cybleUnlockTotal";
  operations: ConfigurationPlanOperation[];
  unsupported: { parameter: string; reason: string; confidence: "UNKNOWN" | "INFERRED" }[];
}

export class UnsupportedConfigurationError extends Error {
  constructor(public readonly parameter: string, message = "Configuration combination not supported by this device profile") {
    super(message);
    this.name = "UnsupportedConfigurationError";
  }
}
