use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub start_address: u8,
    pub end_address: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub current_address: u8,
    pub start_address: u8,
    pub end_address: u8,
    pub devices_found: usize,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryScanProgress {
    pub mask: String,
    pub devices_found: usize,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunicationLogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hex: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawTelegram {
    pub direction: String,
    pub timestamp: String,
    pub length: usize,
    pub hex: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MbusDeviceDto {
    pub id: String,
    pub primary_address: Option<u8>,
    pub secondary_address: Option<SecondaryAddressDto>,
    pub manufacturer: Option<String>,
    pub manufacturer_raw: Option<u16>,
    pub model: Option<String>,
    pub identification_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fabrication_number: Option<String>,
    pub version: Option<String>,
    pub medium: Option<String>,
    pub medium_raw: Option<u8>,
    pub baud_rate: u32,
    pub status: String,
    pub last_read_at: Option<String>,
    pub access_number: Option<u8>,
    pub status_byte: Option<u8>,
    pub status_flags: Vec<String>,
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pad_puls_configuration: Option<PadPulsConfigurationDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cyble_configuration: Option<CybleConfigurationDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryAddressDto {
    pub identification_number: String,
    pub manufacturer_raw: u16,
    pub version: u8,
    pub medium: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MbusDataRecordDto {
    pub id: String,
    pub record_index: usize,
    pub label: String,
    pub function: String,
    pub storage_number: u32,
    pub unit: String,
    pub value: String,
    pub raw_value: String,
    pub raw_bytes: String,
    pub dif: String,
    pub vif: String,
    pub dife: Vec<String>,
    pub vife: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vif_description: Option<String>,
    pub parse_status: String,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceReadResult {
    pub device: MbusDeviceDto,
    pub records: Vec<MbusDataRecordDto>,
    pub raw_telegram: RawTelegram,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadPulsConfigurationDto {
    pub primary_address: u8,
    pub secondary_id: String,
    pub manufacturer_raw: u16,
    pub generation: u8,
    pub medium: u8,
    pub vif: u8,
    pub counter: u64,
    pub numerator: u8,
    pub denominator: u8,
    pub write_protected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CybleConfigurationDto {
    pub primary_address: u8,
    pub secondary_id: String,
    pub customer_id: String,
    pub medium: u8,
    pub volume: String,
    pub volume_raw: u32,
    pub volume_vif: u8,
    pub volume_resolution: String,
    pub pulse_weight_litres: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PadPulsWriteRequest {
    pub current_address: u8,
    pub primary_address: u8,
    pub secondary_id: String,
    pub manufacturer_raw: u16,
    pub generation: u8,
    pub medium: u8,
    pub vif: u8,
    pub counter: u64,
    pub numerator: u8,
    pub denominator: u8,
    pub write_protected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryAddressWriteRequest {
    pub current_address: u8,
    pub new_address: u8,
    pub secondary_address: SecondaryAddressWriteIdentity,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManufacturerFrameWriteRequest {
    pub target_address: u8,
    pub operation: String,
    pub frame: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryAddressWriteIdentity {
    pub identification_number: String,
    pub manufacturer_raw: u16,
    pub version: u8,
    pub medium: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[allow(dead_code)]
pub enum ConfigurationWriteStatus {
    Success,
    Rejected,
    NoAck,
    Timeout,
    ProtocolError,
    Unsupported,
    VerificationFailed,
    AddressInUse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TechnicalTelegram {
    pub timestamp: String,
    pub direction: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_address: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_id: Option<String>,
    pub raw_telegram: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_result: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationWriteResult {
    pub status: ConfigurationWriteStatus,
    pub message: String,
    pub telegrams: Vec<TechnicalTelegram>,
}

pub fn now_timestamp() -> String {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", elapsed.as_secs(), elapsed.subsec_millis())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{ConfigurationWriteResult, ConfigurationWriteStatus};

    #[test]
    fn serializes_explicit_write_results() {
        let result = ConfigurationWriteResult {
            status: ConfigurationWriteStatus::NoAck,
            message: "No ACK".to_string(),
            telegrams: Vec::new(),
        };
        let json = serde_json::to_value(result).expect("serializable result");
        assert_eq!(json["status"], "NoAck");
    }

    #[test]
    fn keeps_all_required_write_outcomes_available() {
        let statuses = [
            ConfigurationWriteStatus::Success,
            ConfigurationWriteStatus::Rejected,
            ConfigurationWriteStatus::NoAck,
            ConfigurationWriteStatus::Timeout,
            ConfigurationWriteStatus::ProtocolError,
            ConfigurationWriteStatus::Unsupported,
            ConfigurationWriteStatus::VerificationFailed,
            ConfigurationWriteStatus::AddressInUse,
        ];
        assert_eq!(statuses.len(), 8);
    }
}
