export interface MbusDataRecord {
  id: string;
  recordIndex: number;
  label: string;
  function: "Instantaneous" | "Maximum" | "Minimum" | "Error state";
  storageNumber: number;
  unit: string;
  value: string | number;
  rawValue: string;
  rawBytes?: string;
  dif?: string;
  vif?: string;
  dife?: string[];
  vife?: string[];
  lvar?: string;
  vifDescription?: string;
  parseStatus?: "Decoded" | "Unsupported" | "Error";
  supported?: boolean;
}
