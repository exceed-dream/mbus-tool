use std::collections::HashSet;

use super::models::{DeviceReadResult, MbusDeviceDto};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecondaryAddressMask {
    pub identification_number: String,
    pub manufacturer: Option<u16>,
    pub version: Option<u8>,
    pub medium: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecondaryProbeKind {
    NoDevice,
    SingleDevice,
    Collision,
}

impl SecondaryAddressMask {
    pub fn identification_only(value: &str) -> Result<Self, String> {
        let normalized = value.trim().to_ascii_uppercase();
        if normalized.len() != 8
            || !normalized
                .chars()
                .all(|character| character.is_ascii_digit() || character == 'F')
        {
            return Err(
                "Secondary identification must contain exactly 8 digits or F wildcards".to_string(),
            );
        }
        Ok(Self {
            identification_number: normalized,
            manufacturer: None,
            version: None,
            medium: None,
        })
    }

    pub fn encode(&self) -> Result<[u8; 8], String> {
        let digits = self.identification_number.as_bytes();
        if digits.len() != 8 {
            return Err("Secondary identification must contain exactly 8 digits".to_string());
        }
        let mut bytes = [0xff_u8; 8];
        for byte_index in 0..4 {
            let right = 7 - byte_index * 2;
            let left = right - 1;
            bytes[byte_index] = (nibble(digits[left])? << 4) | nibble(digits[right])?;
        }
        if let Some(manufacturer) = self.manufacturer {
            bytes[4..6].copy_from_slice(&manufacturer.to_le_bytes());
        }
        bytes[6] = self.version.unwrap_or(0xff);
        bytes[7] = self.medium.unwrap_or(0xff);
        Ok(bytes)
    }

    pub fn is_exact(&self) -> bool {
        !self.identification_number.contains('F')
    }
}

pub fn initial_masks() -> Vec<SecondaryAddressMask> {
    (0..=9)
        .map(|digit| SecondaryAddressMask {
            identification_number: format!("{digit}FFFFFFF"),
            manufacturer: None,
            version: None,
            medium: None,
        })
        .collect()
}

pub fn refine_mask(mask: &SecondaryAddressMask) -> Vec<SecondaryAddressMask> {
    let Some(position) = mask.identification_number.find('F') else {
        return Vec::new();
    };
    (0..=9)
        .map(|digit| {
            let mut child = mask.clone();
            child
                .identification_number
                .replace_range(position..=position, &digit.to_string());
            child
        })
        .collect()
}

#[cfg(test)]
pub fn branch_children(
    mask: &SecondaryAddressMask,
    outcome: SecondaryProbeKind,
) -> Vec<SecondaryAddressMask> {
    match outcome {
        SecondaryProbeKind::Collision => refine_mask(mask),
        SecondaryProbeKind::NoDevice | SecondaryProbeKind::SingleDevice => Vec::new(),
    }
}

pub fn deduplicate_devices(devices: Vec<DeviceReadResult>) -> Vec<DeviceReadResult> {
    let mut seen = HashSet::new();
    devices
        .into_iter()
        .filter(|result| {
            let key = result
                .device
                .secondary_address
                .as_ref()
                .map(|secondary| {
                    format!(
                        "{}-{:04X}-{:02X}-{:02X}",
                        secondary.identification_number,
                        secondary.manufacturer_raw,
                        secondary.version,
                        secondary.medium
                    )
                })
                .unwrap_or_else(|| format!("primary-{:?}", result.device.primary_address));
            seen.insert(key)
        })
        .collect()
}

pub fn retain_explicit_primary_address(result: &mut DeviceReadResult) {
    result.device.primary_address = result.records.iter().find_map(|record| {
        if !record.supported || !record.label.eq_ignore_ascii_case("Primary address") {
            return None;
        }
        record
            .value
            .trim()
            .parse::<u8>()
            .ok()
            .filter(|address| *address <= 250)
    });
}

pub fn same_complete_secondary_identity(left: &MbusDeviceDto, right: &MbusDeviceDto) -> bool {
    match (&left.secondary_address, &right.secondary_address) {
        (Some(left), Some(right)) => {
            left.identification_number == right.identification_number
                && left.manufacturer_raw == right.manufacturer_raw
                && left.version == right.version
                && left.medium == right.medium
        }
        _ => false,
    }
}

pub fn set_confirmed_primary_address(result: &mut DeviceReadResult, address: u8) {
    result.device.primary_address = Some(address);
    if let Some(configuration) = result.device.pad_puls_configuration.as_mut() {
        configuration.primary_address = address;
    }
    if let Some(configuration) = result.device.cyble_configuration.as_mut() {
        configuration.primary_address = address;
    }
}

pub fn primary_address_candidate(
    response_address: Option<u8>,
    decoded_address: Option<u8>,
) -> Option<u8> {
    response_address
        .or(decoded_address)
        .filter(|address| *address <= 250)
}

pub fn confirmed_candidate_address(
    candidate: u8,
    discovered: &MbusDeviceDto,
    verified: &MbusDeviceDto,
) -> Option<u8> {
    (candidate <= 250 && same_complete_secondary_identity(discovered, verified))
        .then_some(candidate)
}

fn nibble(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'F' => Ok(0x0f),
        _ => Err("Secondary identification contains a non-BCD digit".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        branch_children, confirmed_candidate_address, deduplicate_devices, initial_masks,
        primary_address_candidate, refine_mask, retain_explicit_primary_address,
        same_complete_secondary_identity, set_confirmed_primary_address, SecondaryAddressMask,
        SecondaryProbeKind,
    };
    use crate::mbus::models::{
        DeviceReadResult, MbusDataRecordDto, MbusDeviceDto, RawTelegram, SecondaryAddressDto,
    };

    #[test]
    fn encodes_secondary_mask_in_mode_one_order() {
        let mask = SecondaryAddressMask::identification_only("22075482").expect("valid ID");
        assert_eq!(
            mask.encode().expect("encodable"),
            [0x82, 0x54, 0x07, 0x22, 0xff, 0xff, 0xff, 0xff]
        );
    }

    #[test]
    fn creates_ten_initial_wildcard_branches() {
        let masks = initial_masks();
        assert_eq!(masks.len(), 10);
        assert_eq!(masks[0].identification_number, "0FFFFFFF");
        assert_eq!(masks[9].identification_number, "9FFFFFFF");
    }

    #[test]
    fn refines_the_next_wildcard_digit() {
        let mask = SecondaryAddressMask::identification_only("2FFFFFFF").expect("valid mask");
        let children = refine_mask(&mask);
        assert_eq!(children[0].identification_number, "20FFFFFF");
        assert_eq!(children[9].identification_number, "29FFFFFF");
    }

    #[test]
    fn skips_an_empty_branch() {
        let mask = SecondaryAddressMask::identification_only("2FFFFFFF").expect("valid mask");
        assert!(branch_children(&mask, SecondaryProbeKind::NoDevice).is_empty());
    }

    #[test]
    fn refines_a_colliding_branch() {
        let mask = SecondaryAddressMask::identification_only("2FFFFFFF").expect("valid mask");
        assert_eq!(
            branch_children(&mask, SecondaryProbeKind::Collision).len(),
            10
        );
    }

    #[test]
    fn deduplicates_the_same_secondary_identity() {
        let first = synthetic_result(Some(0));
        let second = synthetic_result(None);
        assert_eq!(deduplicate_devices(vec![first, second]).len(), 1);
    }

    #[test]
    fn selected_transport_address_is_never_kept_without_explicit_data() {
        let mut result = synthetic_result(Some(0xfd));
        retain_explicit_primary_address(&mut result);
        assert_eq!(result.device.primary_address, None);
    }

    #[test]
    fn explicit_primary_address_record_is_retained() {
        let mut result = synthetic_result(Some(0xfd));
        result.records.push(primary_address_record("12"));
        retain_explicit_primary_address(&mut result);
        assert_eq!(result.device.primary_address, Some(12));
    }

    #[test]
    fn reserved_explicit_primary_address_is_rejected() {
        let mut result = synthetic_result(Some(0xfd));
        result.records.push(primary_address_record("253"));
        retain_explicit_primary_address(&mut result);
        assert_eq!(result.device.primary_address, None);
    }

    #[test]
    fn complete_secondary_identity_uses_all_four_fields() {
        let original = synthetic_result(None);
        let mut different = synthetic_result(None);
        assert!(same_complete_secondary_identity(
            &original.device,
            &different.device
        ));
        different.device.secondary_address.as_mut().unwrap().medium = 4;
        assert!(!same_complete_secondary_identity(
            &original.device,
            &different.device
        ));
    }

    #[test]
    fn confirmed_primary_address_updates_device_configurations() {
        let mut result = synthetic_result(None);
        set_confirmed_primary_address(&mut result, 4);
        assert_eq!(result.device.primary_address, Some(4));
    }

    #[test]
    fn valid_response_address_becomes_a_verification_candidate() {
        assert_eq!(primary_address_candidate(Some(4), None), Some(4));
    }

    #[test]
    fn selected_slave_address_is_never_a_verification_candidate() {
        assert_eq!(primary_address_candidate(Some(0xfd), Some(0xfd)), None);
    }

    #[test]
    fn matching_targeted_read_confirms_the_candidate() {
        let discovered = synthetic_result(None);
        let verified = synthetic_result(Some(4));
        assert_eq!(
            confirmed_candidate_address(4, &discovered.device, &verified.device),
            Some(4)
        );
    }

    #[test]
    fn different_targeted_identity_rejects_the_candidate() {
        let discovered = synthetic_result(None);
        let mut verified = synthetic_result(Some(4));
        verified.device.secondary_address.as_mut().unwrap().version = 2;
        assert_eq!(
            confirmed_candidate_address(4, &discovered.device, &verified.device),
            None
        );
    }

    fn primary_address_record(value: &str) -> MbusDataRecordDto {
        MbusDataRecordDto {
            id: "record-primary-address".to_string(),
            record_index: 0,
            label: "Primary address".to_string(),
            function: "Instantaneous".to_string(),
            storage_number: 0,
            unit: String::new(),
            value: value.to_string(),
            raw_value: value.to_string(),
            raw_bytes: value.to_string(),
            dif: "01".to_string(),
            vif: "7C".to_string(),
            dife: Vec::new(),
            vife: Vec::new(),
            lvar: None,
            vif_description: Some("Primary address".to_string()),
            parse_status: "Decoded".to_string(),
            supported: true,
        }
    }

    fn synthetic_result(primary_address: Option<u8>) -> DeviceReadResult {
        DeviceReadResult {
            device: MbusDeviceDto {
                id: "secondary-22075482".to_string(),
                primary_address,
                secondary_address: Some(SecondaryAddressDto {
                    identification_number: "22075482".to_string(),
                    manufacturer_raw: 0x1234,
                    version: 1,
                    medium: 7,
                }),
                manufacturer: None,
                manufacturer_raw: Some(0x1234),
                model: None,
                identification_number: Some("22075482".to_string()),
                fabrication_number: None,
                version: Some("1".to_string()),
                medium: Some("Water".to_string()),
                medium_raw: Some(7),
                baud_rate: 2400,
                status: "online".to_string(),
                last_read_at: None,
                access_number: None,
                status_byte: None,
                status_flags: Vec::new(),
                signature: None,
                protocol_hint: None,
                pad_puls_configuration: None,
                cyble_configuration: None,
            },
            records: Vec::new(),
            raw_telegram: RawTelegram {
                direction: "RX".to_string(),
                timestamp: "synthetic".to_string(),
                length: 0,
                hex: String::new(),
            },
        }
    }
}
