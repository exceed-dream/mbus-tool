import type { MbusMediumOption } from "./MbusMedium";
import type { ConfigurationValue, DeviceConfiguration } from "../configuration/DeviceConfiguration";

export const CYBLE_MEDIUM_CHANGE_WARNING = "Changing the medium may reset volume and medium-specific parameters.";

export const cybleMediumOptions: MbusMediumOption[] = [
  { code: 0x07, label: "Water" },
  { code: 0x03, label: "Gas" },
  { code: 0x16, label: "Cold Water" },
  { code: 0x06, label: "Hot Water" },
  { code: 0x00, label: "Other" },
];

export function isCybleFieldVisible(fieldId: string, medium: number | undefined): boolean {
  return !["pulseWeightX10", "correctedVolume"].includes(fieldId) || medium === 0x03;
}

export function withCybleMediumAndGasDefaults(configuration: DeviceConfiguration, requestedMedium: ConfigurationValue): DeviceConfiguration {
  const gasSelected = requestedMedium === 0x03;
  return {
    ...configuration,
    fields: configuration.fields.map((field) => {
      if (field.id === "medium") return { ...field, requestedValue: requestedMedium };
      if (field.id !== "pulseWeightX10" && field.id !== "correctedVolume") return field;
      if (!gasSelected) return { ...field, requestedValue: false };
      return {
        ...field,
        currentValue: typeof field.currentValue === "boolean" ? field.currentValue : false,
        requestedValue: typeof field.requestedValue === "boolean" ? field.requestedValue : false,
      };
    }),
  };
}
