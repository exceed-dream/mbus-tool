use super::models::{PadPulsConfigurationDto, PadPulsWriteRequest};

pub const PADPULS_MANUFACTURER: u16 = 0x48ac;
pub const PADPULS_GENERATION: u8 = 0x09;
pub const MAX_COUNTER: u64 = 0x00ff_ffff_ffff;

pub fn parse_configuration(
    primary_address: u8,
    identification_number: &str,
    manufacturer_raw: u16,
    generation: u8,
    medium: u8,
    status: u8,
    records: &[u8],
) -> Option<PadPulsConfigurationDto> {
    if manufacturer_raw != PADPULS_MANUFACTURER
        || generation != PADPULS_GENERATION
        || records.len() != 12
        || records[0] != 0x06
        || records[7] != 0
        || records[8] != 0x0f
        || records[9] != 0x01
        || records[11] == 0
    {
        return None;
    }
    Some(PadPulsConfigurationDto {
        primary_address,
        secondary_id: identification_number.to_string(),
        manufacturer_raw,
        generation,
        medium,
        vif: records[1] & 0x7f,
        counter: decode_counter(&records[2..8]).ok()?,
        numerator: records[10],
        denominator: records[11],
        write_protected: status & 0x80 != 0,
    })
}

pub fn encode_configuration_payload(request: &PadPulsWriteRequest) -> Result<Vec<u8>, String> {
    validate_write_request(request)?;
    let id = encode_mbus_bcd_id(&request.secondary_id)?;
    let counter = encode_counter(request.counter)?;
    let mut payload = vec![0x01, 0x7a, request.primary_address, 0x07, 0x79];
    payload.extend_from_slice(&id);
    payload.extend_from_slice(&request.manufacturer_raw.to_le_bytes());
    payload.extend_from_slice(&[request.generation, request.medium, 0x06, request.vif]);
    payload.extend_from_slice(&counter);
    payload.extend_from_slice(&[0x0f, 0x01, request.numerator, request.denominator]);
    Ok(payload)
}

pub fn encode_configuration_frame(request: &PadPulsWriteRequest) -> Result<Vec<u8>, String> {
    let payload = encode_configuration_payload(request)?;
    super::frame::encode_snd_ud(0x53, request.current_address, 0x51, &payload)
}

pub fn validate_write_request(request: &PadPulsWriteRequest) -> Result<(), String> {
    if request.write_protected {
        return Err("Configuration locked on device".to_string());
    }
    if request.current_address > 250 || request.primary_address > 250 {
        return Err("Primary address must be between 0 and 250".to_string());
    }
    if request.manufacturer_raw != PADPULS_MANUFACTURER {
        return Err("PadPuls M1 manufacturer must be REL (0x48AC)".to_string());
    }
    if request.generation != PADPULS_GENERATION {
        return Err("PadPuls M1 generation 0x09 is required".to_string());
    }
    encode_mbus_bcd_id(&request.secondary_id)?;
    if request.vif & 0x80 != 0 {
        return Err("PadPuls M1 VIF must have its MSB cleared".to_string());
    }
    if request.counter > MAX_COUNTER {
        return Err(format!("Counter must not exceed {MAX_COUNTER}"));
    }
    if request.denominator == 0 {
        return Err("Multiplicator denominator must be between 1 and 255".to_string());
    }
    Ok(())
}

pub fn encode_mbus_bcd_id(value: &str) -> Result<[u8; 4], String> {
    if value.len() != 8 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Secondary ID must contain exactly 8 digits".to_string());
    }
    let digits = value.as_bytes();
    let mut encoded = [0_u8; 4];
    for index in 0..4 {
        let right = 7 - index * 2;
        let left = right - 1;
        encoded[index] = ((digits[left] - b'0') << 4) | (digits[right] - b'0');
    }
    Ok(encoded)
}

pub fn decode_mbus_bcd_id(bytes: &[u8; 4]) -> Result<String, String> {
    if bytes.iter().any(|byte| byte >> 4 > 9 || byte & 0x0f > 9) {
        return Err("Secondary ID contains invalid BCD digits".to_string());
    }
    Ok(bytes
        .iter()
        .rev()
        .map(|byte| format!("{}{}", byte >> 4, byte & 0x0f))
        .collect())
}

pub fn encode_counter(value: u64) -> Result<[u8; 6], String> {
    if value > MAX_COUNTER {
        return Err(format!("Counter must not exceed {MAX_COUNTER}"));
    }
    let bytes = value.to_le_bytes();
    Ok([bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], 0])
}

pub fn decode_counter(bytes: &[u8]) -> Result<u64, String> {
    if bytes.len() != 6 || bytes[5] != 0 {
        return Err(
            "PadPuls counter must contain five effective bytes and Count6 = 00".to_string(),
        );
    }
    let mut value = [0_u8; 8];
    value[..5].copy_from_slice(&bytes[..5]);
    Ok(u64::from_le_bytes(value))
}

#[cfg(test)]
pub fn configuration_matches(
    expected: &PadPulsWriteRequest,
    actual: &PadPulsConfigurationDto,
) -> bool {
    expected.primary_address == actual.primary_address
        && expected.secondary_id == actual.secondary_id
        && expected.medium == actual.medium
        && expected.vif == actual.vif
        && expected.counter == actual.counter
        && expected.numerator == actual.numerator
        && expected.denominator == actual.denominator
}

#[cfg(test)]
fn vif_factor_in_base_unit(vif: u8) -> Option<f64> {
    match vif & 0x7f {
        value @ 0x00..=0x07 => Some(10_f64.powi(i32::from(value) - 3)),
        value @ 0x08..=0x0f => Some(10_f64.powi(i32::from(value) - 8)),
        value @ 0x10..=0x17 => Some(10_f64.powi(i32::from(value) - 22)),
        value @ 0x18..=0x1f => Some(10_f64.powi(i32::from(value) - 27)),
        _ => None,
    }
}

#[cfg(test)]
fn pulse_value_in_base_unit(vif: u8, numerator: u8, denominator: u8) -> Option<f64> {
    if denominator == 0 {
        return None;
    }
    Some(vif_factor_in_base_unit(vif)? * f64::from(numerator) / f64::from(denominator))
}

#[cfg(test)]
mod tests {
    use super::{
        configuration_matches, decode_counter, decode_mbus_bcd_id, encode_configuration_frame,
        encode_configuration_payload, encode_counter, encode_mbus_bcd_id, parse_configuration,
        pulse_value_in_base_unit, validate_write_request, MAX_COUNTER,
    };
    use crate::mbus::models::{PadPulsConfigurationDto, PadPulsWriteRequest};

    #[test]
    fn secondary_id_bcd_round_trip_preserves_leading_zeroes() {
        let encoded = encode_mbus_bcd_id("00125482").unwrap();
        assert_eq!(encoded, [0x82, 0x54, 0x12, 0x00]);
        assert_eq!(decode_mbus_bcd_id(&encoded).unwrap(), "00125482");
    }

    #[test]
    fn counter_round_trip_uses_five_effective_little_endian_bytes() {
        assert_eq!(encode_counter(15).unwrap(), [0x0f, 0, 0, 0, 0, 0]);
        let encoded = encode_counter(MAX_COUNTER).unwrap();
        assert_eq!(encoded, [0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
        assert_eq!(decode_counter(&encoded).unwrap(), MAX_COUNTER);
    }

    #[test]
    fn parses_the_real_padpuls_records_and_write_protection() {
        let records = [0x06, 0x13, 0x0f, 0, 0, 0, 0, 0, 0x0f, 0x01, 0x01, 0x0a];
        let parsed = parse_configuration(2, "22075482", 0x48ac, 9, 1, 0, &records).unwrap();
        assert_eq!(
            (
                parsed.vif,
                parsed.counter,
                parsed.numerator,
                parsed.denominator
            ),
            (0x13, 15, 1, 10)
        );
        assert!(!parsed.write_protected);
        assert!(
            parse_configuration(2, "22075482", 0x48ac, 9, 1, 0x80, &records)
                .unwrap()
                .write_protected
        );
    }

    #[test]
    fn profile_matching_requires_rel_generation_and_exact_structure() {
        let records = [0x06, 0x13, 0x0f, 0, 0, 0, 0, 0, 0x0f, 0x01, 0x01, 0x0a];
        assert!(parse_configuration(2, "22075482", 0x48ac, 9, 1, 0, &records).is_some());
        assert!(parse_configuration(2, "22075482", 0x48ac, 8, 1, 0, &records).is_none());
        let mut wrong_shape = records;
        wrong_shape[9] = 2;
        assert!(parse_configuration(2, "22075482", 0x48ac, 9, 1, 0, &wrong_shape).is_none());
    }

    #[test]
    fn validates_numerator_and_denominator_ranges() {
        assert!(validate_write_request(&request(0, 1)).is_ok());
        assert!(validate_write_request(&request(255, 255)).is_ok());
        assert!(validate_write_request(&request(1, 0)).is_err());
    }

    #[test]
    fn write_protection_blocks_payload_encoding() {
        let mut protected = request(1, 10);
        protected.write_protected = true;
        assert_eq!(
            encode_configuration_payload(&protected).unwrap_err(),
            "Configuration locked on device"
        );
    }

    #[test]
    fn medium_and_vif_round_trip_through_documented_records() {
        let request = request(1, 10);
        let payload = encode_configuration_payload(&request).unwrap();
        assert_eq!(payload[12], 0x01); // Oil medium
        assert_eq!(payload[14], 0x13); // 1 litre VIF
        let parsed =
            parse_configuration(2, "22075482", 0x48ac, 9, payload[12], 0, &payload[13..]).unwrap();
        assert_eq!((parsed.medium, parsed.vif), (0x01, 0x13));
    }

    #[test]
    fn documented_water_and_electricity_examples_are_representable() {
        let one_litre = pulse_value_in_base_unit(0x13, 1, 1).unwrap() * 1000.0;
        let ten_litres = pulse_value_in_base_unit(0x14, 1, 1).unwrap() * 1000.0;
        assert_eq!(one_litre, 1.0);
        assert_eq!(ten_litres, 10.0);
        assert_eq!(4512.0 * ten_litres, 45120.0);
        assert_eq!(45120.0 * one_litre, 45120.0);

        let pulse_wh = pulse_value_in_base_unit(0x06, 1, 64).unwrap();
        assert_eq!(pulse_wh / 1000.0, 0.015625);
        assert!(encode_counter(78346).is_ok());
    }

    #[test]
    fn full_read_back_comparison_handles_address_and_secondary_id_changes() {
        let mut expected = request(1, 10);
        expected.primary_address = 10;
        expected.secondary_id = "00125482".to_string();
        let actual = PadPulsConfigurationDto {
            primary_address: 10,
            secondary_id: "00125482".to_string(),
            manufacturer_raw: 0x48ac,
            generation: 9,
            medium: 1,
            vif: 0x13,
            counter: 15,
            numerator: 1,
            denominator: 10,
            write_protected: false,
        };
        assert!(configuration_matches(&expected, &actual));
        let mut wrong_id = actual;
        wrong_id.secondary_id = "00125483".to_string();
        assert!(!configuration_matches(&expected, &wrong_id));
    }

    #[test]
    fn encodes_the_complete_documented_payload() {
        let payload = encode_configuration_payload(&request(1, 10)).unwrap();
        assert_eq!(payload.len(), 25);
        assert_eq!(
            payload,
            vec![
                0x01, 0x7a, 0x02, 0x07, 0x79, 0x82, 0x54, 0x07, 0x22, 0xac, 0x48, 0x09, 0x01, 0x06,
                0x13, 0x0f, 0, 0, 0, 0, 0, 0x0f, 0x01, 0x01, 0x0a
            ]
        );
    }

    #[test]
    fn encodes_the_complete_documented_long_frame() {
        let request = request(1, 10);
        let frame = encode_configuration_frame(&request).unwrap();
        assert_eq!(
            frame,
            vec![
                0x68, 0x1c, 0x1c, 0x68, 0x53, 0x02, 0x51, 0x01, 0x7a, 0x02, 0x07, 0x79, 0x82, 0x54,
                0x07, 0x22, 0xac, 0x48, 0x09, 0x01, 0x06, 0x13, 0x0f, 0, 0, 0, 0, 0, 0x0f, 0x01,
                0x01, 0x0a, 0xe3, 0x16
            ]
        );
    }

    #[test]
    fn previews_primary_address_change_with_the_production_frame_encoder() {
        let mut request = request(1, 10);
        request.primary_address = 10;
        assert_eq!(
            encode_configuration_frame(&request).unwrap(),
            vec![
                0x68, 0x1c, 0x1c, 0x68, 0x53, 0x02, 0x51, 0x01, 0x7a, 0x0a, 0x07, 0x79, 0x82, 0x54,
                0x07, 0x22, 0xac, 0x48, 0x09, 0x01, 0x06, 0x13, 0x0f, 0, 0, 0, 0, 0, 0x0f, 0x01,
                0x01, 0x0a, 0xeb, 0x16
            ]
        );
    }

    fn request(numerator: u8, denominator: u8) -> PadPulsWriteRequest {
        PadPulsWriteRequest {
            current_address: 2,
            primary_address: 2,
            secondary_id: "22075482".to_string(),
            manufacturer_raw: 0x48ac,
            generation: 9,
            medium: 1,
            vif: 0x13,
            counter: 15,
            numerator,
            denominator,
            write_protected: false,
        }
    }
}
