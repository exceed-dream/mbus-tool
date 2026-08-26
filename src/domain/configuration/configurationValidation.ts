import type { ConfigurationField, ConfigurationValidation, DeviceConfiguration } from "./DeviceConfiguration";

export function validateConfiguration(configuration: DeviceConfiguration): ConfigurationValidation {
  const issues = configuration.fields.flatMap((field) => validateField(field));
  return { valid: issues.length === 0, issues };
}

function validateField(field: ConfigurationField): { fieldId: string; message: string }[] {
  const issues: { fieldId: string; message: string }[] = [];
  if (field.currentValue === field.requestedValue) return issues;
  if (!field.editable || !["SUPPORTED", "LOCAL_ONLY"].includes(field.writeSupport)) {
    issues.push({ fieldId: field.id, message: `${field.label} is not writable.` });
    return issues;
  }
  if (field.type === "text" && field.pattern && (typeof field.requestedValue !== "string" || !new RegExp(field.pattern).test(field.requestedValue))) {
    issues.push({ fieldId: field.id, message: `${field.label} has an invalid format.` });
  }
  if (field.type === "ratio") {
    const ratio = field.requestedValue;
    if (typeof ratio !== "object" || ratio === null || !Number.isInteger(ratio.numerator) || ratio.numerator < 0 || ratio.numerator > 255 || !Number.isInteger(ratio.denominator) || ratio.denominator < 1 || ratio.denominator > 255) {
      issues.push({ fieldId: field.id, message: `${field.label} requires a numerator from 0 to 255 and a denominator from 1 to 255.` });
    }
  }
  if (field.required && (field.requestedValue === null || field.requestedValue === "")) {
    issues.push({ fieldId: field.id, message: `${field.label} is required.` });
    return issues;
  }
  if (field.type === "integer" || field.type === "decimal") {
    const value = Number(field.requestedValue);
    if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
      issues.push({ fieldId: field.id, message: `${field.label} must be a valid ${field.type}.` });
      return issues;
    }
    if (field.minimum !== undefined && value < field.minimum) issues.push({ fieldId: field.id, message: `${field.label} must be at least ${field.minimum}.` });
    if (field.maximum !== undefined && value > field.maximum) issues.push({ fieldId: field.id, message: `${field.label} must be at most ${field.maximum}.` });
  }
  if (field.type === "select" && field.options && !field.options.some((option) => option.value === field.requestedValue)) {
    issues.push({ fieldId: field.id, message: `${field.label} has an invalid option.` });
  }
  return issues;
}
