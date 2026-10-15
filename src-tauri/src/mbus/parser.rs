use super::{
    frame::MbusFrame,
    models::{
        hex, now_timestamp, CybleConfigurationDto, DeviceReadResult, MbusDataRecordDto,
        MbusDeviceDto, RawTelegram, SecondaryAddressDto,
    },
    padpuls,
};

pub fn decode_response(
    frame: MbusFrame,
    raw: &[u8],
    baud_rate: u32,
) -> Result<DeviceReadResult, String> {
    let (address, ci, data) = match frame {
        MbusFrame::Long {
            address, ci, data, ..
        } => (address, ci, data),
        MbusFrame::Ack => {
            return Err("Unsupported response: ACK does not contain device data".to_string())
        }
        MbusFrame::Short { .. } => {
            return Err(
                "Unsupported response: short response does not contain device data".to_string(),
            )
        }
    };
    if !matches!(ci, 0x72 | 0x76) {
        return Err(format!("Unsupported response CI field: 0x{ci:02X}"));
    }
    if data.len() < 12 {
        return Err("Invalid M-Bus variable data header".to_string());
    }

    let timestamp = now_timestamp();
    let identification_bytes: [u8; 4] = data[0..4]
        .try_into()
        .map_err(|_| "Invalid M-Bus identification field".to_string())?;
    let identification = padpuls::decode_mbus_bcd_id(&identification_bytes)
        .unwrap_or_else(|_| decode_bcd_identification(&data[0..4]));
    let manufacturer_raw = u16::from_le_bytes([data[4], data[5]]);
    let manufacturer = decode_manufacturer(manufacturer_raw);
    let version = data[6];
    let medium = decode_medium(data[7]);
    let access_number = data[8];
    let status_byte = data[9];
    let signature = hex(&data[10..12]);
    let pad_puls_configuration = padpuls::parse_configuration(
        address,
        &identification,
        manufacturer_raw,
        version,
        data[7],
        status_byte,
        &data[12..],
    );
    let mut records = parse_records(&data[12..], ci == 0x72);
    if let Some(configuration) = pad_puls_configuration.as_ref() {
        if let Some(record) = records.iter_mut().find(|record| record.dif == "0F") {
            record.label = "Multiplicator".to_string();
            record.value = format!(
                "{} / {}",
                configuration.numerator, configuration.denominator
            );
            record.raw_value = format!(
                "0F 01 {:02X} {:02X}",
                configuration.numerator, configuration.denominator
            );
            record.vif = "01".to_string();
            record.supported = true;
            record.parse_status = "Decoded".to_string();
        }
    }
    let identity = format!(
        "{}-{manufacturer_raw:04X}-{version:02X}-{:02X}",
        identification, data[7]
    );
    let fabrication_number = records
        .iter()
        .find(|record| record.label == "Fabrication number" && record.supported)
        .map(|record| record.value.clone());
    let cyble_configuration = parse_cyble_configuration(
        address,
        &identification,
        manufacturer_raw,
        version,
        data[7],
        &records,
    );
    let protocol_hint = if pad_puls_configuration.is_some() {
        Some("RELAY_PADPULS_M1".to_string())
    } else {
        cyble_configuration
            .as_ref()
            .map(|_| "ITRON_CYBLE_MBUS_V2".to_string())
    };

    Ok(DeviceReadResult {
        device: MbusDeviceDto {
            id: format!("secondary-{identity}"),
            primary_address: (address <= 250).then_some(address),
            secondary_address: Some(SecondaryAddressDto {
                identification_number: identification.clone(),
                manufacturer_raw,
                version,
                medium: data[7],
            }),
            manufacturer,
            manufacturer_raw: Some(manufacturer_raw),
            model: None,
            identification_number: Some(identification),
            fabrication_number,
            version: Some(version.to_string()),
            medium,
            medium_raw: Some(data[7]),
            baud_rate,
            status: if status_byte == 0 {
                "online"
            } else {
                "warning"
            }
            .to_string(),
            last_read_at: Some(timestamp.clone()),
            access_number: Some(access_number),
            status_byte: Some(status_byte),
            status_flags: decode_status_flags(status_byte),
            signature: Some(signature),
            protocol_hint,
            pad_puls_configuration,
            cyble_configuration,
        },
        records,
        raw_telegram: RawTelegram {
            direction: "RX".to_string(),
            timestamp,
            length: raw.len(),
            hex: hex(raw),
        },
    })
}

fn parse_cyble_configuration(
    address: u8,
    identification: &str,
    manufacturer_raw: u16,
    version: u8,
    medium: u8,
    records: &[MbusDataRecordDto],
) -> Option<CybleConfigurationDto> {
    if manufacturer_raw != 0x0477 || version != 20 {
        return None;
    }
    let has_fabrication_number = records
        .iter()
        .any(|record| record.label == "Fabrication number" && record.supported);
    let customer = records.iter().find(|record| {
        record.supported
            && record
                .vif_description
                .as_deref()
                .is_some_and(|description| description.eq_ignore_ascii_case("cust. ID"))
    })?;
    let customer_id = customer.value.trim_matches(' ').to_string();
    if !has_fabrication_number
        || customer_id.is_empty()
        || !customer_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return None;
    }
    let volume = records.iter().find(|record| {
        record.supported
            && record.label == "Volume"
            && matches!(
                record.vif.as_str(),
                "10" | "11" | "12" | "13" | "14" | "15" | "16" | "17"
            )
    })?;
    let raw_bytes = volume
        .raw_value
        .split_whitespace()
        .map(|byte| u8::from_str_radix(byte, 16).ok())
        .collect::<Option<Vec<_>>>()?;
    let raw: [u8; 4] = raw_bytes.try_into().ok()?;
    let volume_raw = u32::from_le_bytes(raw);
    let (volume_resolution, pulse_weight_litres) = cyble_pulse_weight(volume.vif.as_str())?;
    Some(CybleConfigurationDto {
        primary_address: address,
        secondary_id: identification.to_string(),
        customer_id,
        medium,
        volume: volume.value.clone(),
        volume_raw,
        volume_vif: u8::from_str_radix(&volume.vif, 16).ok()?,
        volume_resolution: volume_resolution.to_string(),
        pulse_weight_litres,
    })
}

fn cyble_pulse_weight(vif: &str) -> Option<(&'static str, f64)> {
    match vif {
        "10" => Some(("0.000001", 0.001)),
        "11" => Some(("0.00001", 0.01)),
        "12" => Some(("0.0001", 0.1)),
        "13" => Some(("0.001", 1.0)),
        "14" => Some(("0.01", 10.0)),
        "15" => Some(("0.1", 100.0)),
        "16" => Some(("1", 1000.0)),
        "17" => Some(("10", 10000.0)),
        _ => None,
    }
}

pub fn decode_manufacturer(value: u16) -> Option<String> {
    let letters = [
        ((value >> 10) & 0x1f) as u8,
        ((value >> 5) & 0x1f) as u8,
        (value & 0x1f) as u8,
    ];
    if letters.iter().any(|letter| !(1..=26).contains(letter)) {
        return None;
    }
    Some(
        letters
            .iter()
            .map(|letter| (b'A' + letter - 1) as char)
            .collect(),
    )
}

fn decode_bcd_identification(bytes: &[u8]) -> String {
    bytes
        .iter()
        .rev()
        .map(|byte| format!("{:X}{:X}", byte >> 4, byte & 0x0f))
        .collect()
}

fn decode_medium(value: u8) -> Option<String> {
    let name = match value {
        0x00 => "Other",
        0x01 => "Oil",
        0x02 => "Electricity",
        0x03 => "Gas",
        0x04 => "Heat outlet",
        0x05 => "Steam",
        0x06 => "Hot water",
        0x07 => "Water",
        0x08 => "Heat cost allocator",
        0x09 => "Compressed air",
        0x0a => "Cooling outlet",
        0x0b => "Cooling inlet",
        0x0c => "Heat inlet",
        0x0d => "Combined heat/cooling",
        0x0e => "Bus/system",
        0x0f => "Unknown medium",
        0x16 => "Cold water",
        0x17 => "Dual water",
        0x18 => "Pressure",
        0x19 => "A/D converter",
        _ => return None,
    };
    Some(name.to_string())
}

fn decode_status_flags(status: u8) -> Vec<String> {
    let mut flags = Vec::new();
    match status & 0x03 {
        0x01 => flags.push("Application busy".to_string()),
        0x02 => flags.push("Application error".to_string()),
        0x03 => flags.push("Reserved application status".to_string()),
        _ => {}
    }
    if status & 0x04 != 0 {
        flags.push("Power low".to_string());
    }
    if status & 0x08 != 0 {
        flags.push("Permanent error".to_string());
    }
    if status & 0x10 != 0 {
        flags.push("Temporary error".to_string());
    }
    if status & 0xe0 != 0 {
        flags.push("Manufacturer-specific status".to_string());
    }
    flags
}

fn parse_records(bytes: &[u8], lsb_first: bool) -> Vec<MbusDataRecordDto> {
    let mut records = Vec::new();
    let mut offset = 0_usize;
    while offset < bytes.len() {
        if bytes[offset] == 0x2f {
            offset += 1;
            continue;
        }
        if bytes[offset] == 0x0f || bytes[offset] == 0x1f {
            records.push(unsupported_record(
                records.len(),
                bytes[offset],
                0,
                &bytes[offset..],
            ));
            break;
        }
        let start = offset;
        let dif = bytes[offset];
        offset += 1;
        let mut storage_number = ((dif >> 6) & 0x01) as u32;
        let mut extension = dif & 0x80 != 0;
        let mut dife_index = 0_u32;
        let mut difes = Vec::new();
        while extension {
            let Some(dife) = bytes.get(offset).copied() else {
                records.push(unsupported_record_with_details(
                    records.len(),
                    dif,
                    0,
                    difes,
                    Vec::new(),
                    None,
                    None,
                    &bytes[start..],
                    "Error",
                ));
                return records;
            };
            offset += 1;
            difes.push(format!("{dife:02X}"));
            storage_number |= ((dife & 0x0f) as u32) << (1 + 4 * dife_index);
            extension = dife & 0x80 != 0;
            dife_index += 1;
        }
        let Some(vif) = bytes.get(offset).copied() else {
            records.push(unsupported_record(records.len(), dif, 0, &bytes[start..]));
            break;
        };
        offset += 1;
        let mut vifes = Vec::new();
        let mut vif_description = None;
        if vif & 0x7f == 0x7c {
            let Some(length) = bytes.get(offset).copied() else {
                records.push(unsupported_record_with_details(
                    records.len(),
                    dif,
                    vif,
                    difes,
                    vifes,
                    None,
                    None,
                    &bytes[start..],
                    "Error",
                ));
                return records;
            };
            offset += 1;
            let end = offset + length as usize;
            if end > bytes.len() {
                records.push(unsupported_record_with_details(
                    records.len(),
                    dif,
                    vif,
                    difes,
                    vifes,
                    None,
                    None,
                    &bytes[start..],
                    "Error",
                ));
                return records;
            }
            vif_description = decode_text(&bytes[offset..end], lsb_first);
            offset = end;
        } else {
            extension = vif & 0x80 != 0;
            while extension {
                let Some(vife) = bytes.get(offset).copied() else {
                    records.push(unsupported_record_with_details(
                        records.len(),
                        dif,
                        vif,
                        difes,
                        vifes,
                        None,
                        None,
                        &bytes[start..],
                        "Error",
                    ));
                    return records;
                };
                offset += 1;
                vifes.push(format!("{vife:02X}"));
                extension = vife & 0x80 != 0;
            }
        }
        let lvar = (dif & 0x0f == 0x0d)
            .then(|| bytes.get(offset).copied())
            .flatten();
        let data_length = match data_length(dif, lvar) {
            Some((length, consumes_length_byte)) => {
                if consumes_length_byte {
                    offset += 1;
                }
                length
            }
            None => {
                records.push(unsupported_record_with_details(
                    records.len(),
                    dif,
                    vif,
                    difes,
                    vifes,
                    lvar,
                    vif_description,
                    &bytes[start..],
                    "Error",
                ));
                break;
            }
        };
        if offset + data_length > bytes.len() {
            records.push(unsupported_record_with_details(
                records.len(),
                dif,
                vif,
                difes,
                vifes,
                lvar,
                vif_description,
                &bytes[start..],
                "Error",
            ));
            break;
        }
        let value_bytes = &bytes[offset..offset + data_length];
        offset += data_length;
        let raw = &bytes[start..offset];
        records.push(decode_record(
            records.len(),
            dif,
            vif,
            storage_number,
            difes,
            vifes,
            lvar,
            vif_description,
            value_bytes,
            raw,
            lsb_first,
        ));
    }
    records
}

fn data_length(dif: u8, variable_length: Option<u8>) -> Option<(usize, bool)> {
    match dif & 0x0f {
        0x0 => Some((0, false)),
        0x1 => Some((1, false)),
        0x2 => Some((2, false)),
        0x3 => Some((3, false)),
        0x4 | 0x5 => Some((4, false)),
        0x6 => Some((6, false)),
        0x7 => Some((8, false)),
        0x9 => Some((1, false)),
        0xa => Some((2, false)),
        0xb => Some((3, false)),
        0xc => Some((4, false)),
        0xd => variable_length.and_then(|lvar| match lvar {
            0x00..=0xbf => Some((lvar as usize, true)),
            0xc0..=0xcf => Some(((lvar - 0xc0) as usize, true)),
            0xd0..=0xdf => Some(((lvar - 0xd0) as usize, true)),
            0xe0..=0xef => Some(((lvar - 0xe0) as usize, true)),
            0xf0..=0xfa => Some(((lvar - 0xf0) as usize, true)),
            _ => None,
        }),
        0xe => Some((6, false)),
        _ => None,
    }
}

fn decode_record(
    index: usize,
    dif: u8,
    vif: u8,
    storage_number: u32,
    dife: Vec<String>,
    vife: Vec<String>,
    lvar: Option<u8>,
    vif_description: Option<String>,
    value_bytes: &[u8],
    raw: &[u8],
    lsb_first: bool,
) -> MbusDataRecordDto {
    let function = match (dif >> 4) & 0x03 {
        0 => "Instantaneous",
        1 => "Maximum",
        2 => "Minimum",
        _ => "Error state",
    };
    let fabrication_number = if dif & 0x0f == 0x0c && vif & 0x7f == 0x78 && value_bytes.len() == 4 {
        let bytes: [u8; 4] = value_bytes.try_into().ok().unwrap_or_default();
        padpuls::decode_mbus_bcd_id(&bytes).ok()
    } else {
        None
    };
    let is_customer_id = vif_description
        .as_deref()
        .is_some_and(|description| description.eq_ignore_ascii_case("cust. ID"));
    let variable_text = lvar.filter(|value| *value <= 0xbf).and_then(|_| {
        if is_customer_id {
            decode_ascii_in_transmission_order(value_bytes)
        } else {
            decode_text(value_bytes, lsb_first)
        }
    });
    let descriptor = vife
        .is_empty()
        .then(|| vif_descriptor(vif & 0x7f))
        .flatten();
    let decoded = decode_number(dif, value_bytes);
    let supported = descriptor.is_some() && decoded.is_some();
    let (label, unit, value, supported) = if let Some(value) = fabrication_number {
        ("Fabrication number".to_string(), String::new(), value, true)
    } else if let (Some(description), Some(value)) = (vif_description.as_ref(), variable_text) {
        let label = if is_customer_id {
            "Customer ID".to_string()
        } else {
            description.clone()
        };
        let value = if is_customer_id {
            value.trim_matches(' ').to_string()
        } else {
            value.trim().to_string()
        };
        (label, String::new(), value, true)
    } else {
        match (descriptor, decoded) {
            (Some((label, unit, exponent)), Some(number)) => {
                let scaled = number * 10_f64.powi(exponent);
                (
                    label.to_string(),
                    unit.to_string(),
                    format_number(scaled),
                    supported,
                )
            }
            _ => (
                "Unsupported".to_string(),
                String::new(),
                "Unsupported".to_string(),
                false,
            ),
        }
    };
    MbusDataRecordDto {
        id: format!("record-{index}"),
        record_index: index,
        label,
        function: function.to_string(),
        storage_number,
        unit,
        value,
        raw_value: hex(value_bytes),
        raw_bytes: hex(raw),
        dif: format!("{dif:02X}"),
        vif: format!("{vif:02X}"),
        dife,
        vife,
        lvar: lvar.map(|value| format!("{value:02X}")),
        vif_description,
        parse_status: if supported { "Decoded" } else { "Unsupported" }.to_string(),
        supported,
    }
}

fn unsupported_record(index: usize, dif: u8, vif: u8, raw: &[u8]) -> MbusDataRecordDto {
    unsupported_record_with_details(
        index,
        dif,
        vif,
        Vec::new(),
        Vec::new(),
        None,
        None,
        raw,
        "Unsupported",
    )
}

fn unsupported_record_with_details(
    index: usize,
    dif: u8,
    vif: u8,
    dife: Vec<String>,
    vife: Vec<String>,
    lvar: Option<u8>,
    vif_description: Option<String>,
    raw: &[u8],
    parse_status: &str,
) -> MbusDataRecordDto {
    MbusDataRecordDto {
        id: format!("record-{index}"),
        record_index: index,
        label: "Unsupported".to_string(),
        function: "Instantaneous".to_string(),
        storage_number: 0,
        unit: String::new(),
        value: "Unsupported".to_string(),
        raw_value: hex(raw),
        raw_bytes: hex(raw),
        dif: format!("{dif:02X}"),
        vif: format!("{vif:02X}"),
        dife,
        vife,
        lvar: lvar.map(|value| format!("{value:02X}")),
        vif_description,
        parse_status: parse_status.to_string(),
        supported: false,
    }
}

fn decode_text(bytes: &[u8], lsb_first: bool) -> Option<String> {
    let ordered = if lsb_first {
        bytes.iter().rev().copied().collect::<Vec<_>>()
    } else {
        bytes.to_vec()
    };
    if ordered
        .iter()
        .any(|byte| !byte.is_ascii_graphic() && *byte != b' ')
    {
        return None;
    }
    String::from_utf8(ordered).ok()
}

fn decode_ascii_in_transmission_order(bytes: &[u8]) -> Option<String> {
    if bytes
        .iter()
        .any(|byte| !byte.is_ascii_graphic() && *byte != b' ')
    {
        return None;
    }
    String::from_utf8(bytes.to_vec()).ok()
}

fn decode_number(dif: u8, bytes: &[u8]) -> Option<f64> {
    match dif & 0x0f {
        0x1..=0x4 | 0x6 | 0x7 => {
            let mut value = 0_i128;
            for (index, byte) in bytes.iter().enumerate() {
                value |= (*byte as i128) << (8 * index);
            }
            let bits = bytes.len() * 8;
            if bits > 0 && bytes.last()? & 0x80 != 0 {
                value -= 1_i128 << bits;
            }
            Some(value as f64)
        }
        0x5 if bytes.len() == 4 => Some(f32::from_le_bytes(bytes.try_into().ok()?) as f64),
        0x9..=0xc | 0xe => {
            let mut multiplier = 1_f64;
            let mut value = 0_f64;
            for byte in bytes {
                value += (byte & 0x0f) as f64 * multiplier;
                multiplier *= 10.0;
                value += (byte >> 4) as f64 * multiplier;
                multiplier *= 10.0;
            }
            Some(value)
        }
        _ => None,
    }
}

fn vif_descriptor(vif: u8) -> Option<(&'static str, &'static str, i32)> {
    match vif {
        0x00..=0x07 => Some(("Energy", "Wh", vif as i32 - 3)),
        0x08..=0x0f => Some(("Energy", "J", vif as i32 - 8)),
        0x10..=0x17 => Some(("Volume", "m³", vif as i32 - 0x16)),
        0x20..=0x23 => Some(("On time", ["s", "min", "h", "d"][(vif - 0x20) as usize], 0)),
        0x24..=0x27 => Some((
            "Operating time",
            ["s", "min", "h", "d"][(vif - 0x24) as usize],
            0,
        )),
        0x28..=0x2f => Some(("Power", "W", vif as i32 - 0x2b)),
        0x38..=0x3f => Some(("Volume flow", "m³/h", vif as i32 - 0x3e)),
        0x40..=0x47 => Some(("Volume flow", "m³/min", vif as i32 - 0x47)),
        0x48..=0x4f => Some(("Volume flow", "m³/s", vif as i32 - 0x51)),
        0x58..=0x5b => Some(("Flow temperature", "°C", vif as i32 - 0x5b)),
        0x5c..=0x5f => Some(("Return temperature", "°C", vif as i32 - 0x5f)),
        0x60..=0x63 => Some(("Temperature difference", "K", vif as i32 - 0x63)),
        _ => None,
    }
}

fn format_number(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{value:.0}")
    } else {
        format!("{value:.6}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_manufacturer, decode_response, parse_records};
    use crate::mbus::frame::{encode_long_frame, parse};
    use crate::mbus::models::hex;

    fn telegram(hex: &str) -> Vec<u8> {
        hex.split_whitespace()
            .map(|byte| u8::from_str_radix(byte, 16).expect("valid fixture byte"))
            .collect()
    }

    #[test]
    fn decodes_standard_manufacturer_code() {
        let raw = (9_u16 << 10) | (20_u16 << 5) | 18_u16;
        assert_eq!(decode_manufacturer(raw).as_deref(), Some("ITR"));
    }

    #[test]
    fn rejects_invalid_manufacturer_code() {
        assert_eq!(decode_manufacturer(0), None);
    }

    #[test]
    fn parses_synthetic_volume_record() {
        let records = parse_records(&[0x04, 0x13, 0x40, 0xe2, 0x01, 0x00], true);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].record_index, 0);
        assert_eq!(records[0].label, "Volume");
        assert_eq!(records[0].value, "123.456");
    }

    #[test]
    fn preserves_unsupported_synthetic_record() {
        let records = parse_records(&[0x01, 0x6d, 0x2a], true);
        assert_eq!(records.len(), 1);
        assert!(!records[0].supported);
        assert_eq!(records[0].raw_bytes, "01 6D 2A");
        assert_eq!(records[0].parse_status, "Unsupported");
    }

    #[test]
    fn decodes_standard_fabrication_number_without_confusing_identification() {
        let records = parse_records(&[0x0c, 0x78, 0x47, 0x61, 0x00, 0x21], true);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].label, "Fabrication number");
        assert_eq!(records[0].value, "21006147");
        assert_eq!(records[0].raw_bytes, "0C 78 47 61 00 21");
        assert_eq!(records[0].parse_status, "Decoded");
    }

    #[test]
    fn preserves_incomplete_plain_text_vif_record_with_its_description() {
        let raw = [
            0x0d, 0x7c, 0x08, 0x44, 0x49, 0x20, 0x2e, 0x74, 0x73, 0x75, 0x63,
        ];
        let records = parse_records(&raw, true);
        assert_eq!(records.len(), 1);
        assert!(!records[0].supported);
        assert_eq!(records[0].vif_description.as_deref(), Some("cust. ID"));
        assert_eq!(records[0].lvar, None);
        assert_eq!(records[0].parse_status, "Error");
        assert_eq!(records[0].raw_bytes, "0D 7C 08 44 49 20 2E 74 73 75 63");
    }

    #[test]
    fn consumes_dife_plain_text_vif_lvar_and_continues_at_the_next_record() {
        let raw = [
            0x8d, 0x01, 0x7c, 0x04, b't', b's', b'e', b't', 0x03, b'c', b'b', b'a', 0x01, 0x20,
            0x05,
        ];
        let records = parse_records(&raw, true);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].record_index, 0);
        assert_eq!(records[1].record_index, 1);
        assert_eq!(records[0].dife, ["01"]);
        assert_eq!(records[0].vif_description.as_deref(), Some("test"));
        assert_eq!(records[0].lvar.as_deref(), Some("03"));
        assert_eq!(records[0].value, "abc");
        assert_eq!(records[0].storage_number, 2);
        assert_eq!(records[0].parse_status, "Decoded");
        assert_eq!(
            (records[1].label.as_str(), records[1].value.as_str()),
            ("On time", "5")
        );
    }

    #[test]
    fn decodes_customer_id_ascii_in_transmission_order_and_preserves_raw() {
        for (value_bytes, expected) in [
            (
                [0x20, 0x20, 0x20, 0x20, 0x36, 0x35, 0x34, 0x33, 0x32, 0x33],
                "654323",
            ),
            (
                [0x20, 0x20, 0x20, 0x20, 0x33, 0x33, 0x34, 0x37, 0x39, 0x39],
                "334799",
            ),
            (
                [0x20, 0x20, 0x20, 0x20, 0x39, 0x39, 0x37, 0x34, 0x33, 0x33],
                "997433",
            ),
        ] {
            let mut raw = vec![
                0x0d, 0x7c, 0x08, 0x44, 0x49, 0x20, 0x2e, 0x74, 0x73, 0x75, 0x63, 0x0a,
            ];
            raw.extend(value_bytes);
            let records = parse_records(&raw, true);
            assert_eq!(records.len(), 1);
            assert_eq!(records[0].label, "Customer ID");
            assert_eq!(records[0].value, expected);
            assert_eq!(records[0].vif_description.as_deref(), Some("cust. ID"));
            assert_eq!(records[0].raw_bytes, hex(&raw));
        }
    }

    #[test]
    fn preserves_unknown_vife_without_losing_the_following_record() {
        let records = parse_records(&[0x01, 0x80, 0x00, 0x2a, 0x01, 0x20, 0x05], true);
        assert_eq!(records.len(), 2);
        assert!(!records[0].supported);
        assert_eq!(records[0].vife, ["00"]);
        assert_eq!(records[0].raw_bytes, "01 80 00 2A");
        assert_eq!(records[0].parse_status, "Unsupported");
        assert_eq!(
            (records[1].label.as_str(), records[1].value.as_str()),
            ("On time", "5")
        );
    }

    #[test]
    fn preserves_the_validated_acw_values_and_status() {
        let data = [
            0x47, 0x61, 0x00, 0x21, 0x77, 0x04, 0x14, 0x03, 0x9c, 0x30, 0x00, 0x00, 0x0c, 0x78,
            0x47, 0x61, 0x00, 0x21, 0x02, 0x20, 0xe4, 0x07, 0x04, 0x03, 0xbe, 0xad, 0x05, 0x25,
            0x02, 0x00, 0x00, 0x02, 0x04, 0x2b, 0x00, 0x00, 0x00, 0x00, 0x0d, 0x7c, 0x08, 0x44,
            0x49, 0x20, 0x2e, 0x74, 0x73, 0x75, 0x63,
        ];
        let raw = encode_long_frame(0x08, 2, 0x72, &data).expect("bounded ACW frame");
        let result = decode_response(parse(&raw).expect("valid ACW frame"), &raw, 2400)
            .expect("decodable ACW response");

        assert_eq!(result.device.manufacturer.as_deref(), Some("ACW"));
        assert_eq!(result.device.manufacturer_raw, Some(0x0477));
        assert_eq!(
            result.device.identification_number.as_deref(),
            Some("21006147")
        );
        assert_eq!(
            result.device.fabrication_number.as_deref(),
            Some("21006147")
        );
        assert_eq!(result.device.version.as_deref(), Some("20"));
        assert_eq!(result.device.medium.as_deref(), Some("Gas"));
        assert_eq!(result.device.status_byte, Some(0x30));
        assert_eq!(
            result.device.status_flags,
            ["Temporary error", "Manufacturer-specific status"]
        );

        let values = result
            .records
            .iter()
            .filter(|record| matches!(record.label.as_str(), "On time" | "Energy" | "Power"))
            .map(|record| {
                (
                    record.label.as_str(),
                    record.value.as_str(),
                    record.unit.as_str(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            values,
            [
                ("On time", "2020", "s"),
                ("Energy", "621129150", "Wh"),
                ("Energy", "0.512", "Wh"),
                ("Power", "0", "W"),
            ]
        );
        let unsupported = result.records.last().expect("preserved unknown record");
        assert!(!unsupported.supported);
        assert_eq!(unsupported.vif_description.as_deref(), Some("cust. ID"));
        assert_eq!(unsupported.raw_bytes, "0D 7C 08 44 49 20 2E 74 73 75 63");
    }

    #[test]
    fn preserves_the_validated_real_meter_response() {
        let raw = [
            0x68, 0x1b, 0x1b, 0x68, 0x08, 0x02, 0x72, 0x82, 0x54, 0x07, 0x22, 0xac, 0x48, 0x09,
            0x01, 0x39, 0x00, 0x00, 0x00, 0x06, 0x13, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f,
            0x01, 0x01, 0x0a, 0xf5, 0x16,
        ];

        let result = decode_response(parse(&raw).expect("valid frame"), &raw, 2400)
            .expect("decodable response");

        assert_eq!(result.device.manufacturer.as_deref(), Some("REL"));
        assert_eq!(result.device.manufacturer_raw, Some(0x48ac));
        assert_eq!(
            result.device.identification_number.as_deref(),
            Some("22075482")
        );
        assert_eq!(result.device.primary_address, Some(2));
        assert_eq!(result.device.version.as_deref(), Some("9"));
        assert_eq!(result.device.medium.as_deref(), Some("Oil"));
        assert_eq!(result.device.medium_raw, Some(0x01));
        assert_eq!(result.device.access_number, Some(57));
        assert_eq!(result.device.status_byte, Some(0));
        assert_eq!(result.device.signature.as_deref(), Some("00 00"));
        assert_eq!(result.records.len(), 2);
        assert_eq!(result.records[0].label, "Volume");
        assert_eq!(result.records[0].value, "0.015");
        assert_eq!(result.records[0].unit, "m³");
        assert!(result.records[1].supported);
        assert_eq!(result.records[1].label, "Multiplicator");
        assert_eq!(result.records[1].raw_value, "0F 01 01 0A");
        assert_eq!(result.records[1].value, "1 / 10");
        assert_eq!(result.records[1].raw_bytes, "0F 01 01 0A");
        assert_eq!(
            result.device.protocol_hint.as_deref(),
            Some("RELAY_PADPULS_M1")
        );
        let configuration = result.device.pad_puls_configuration.unwrap();
        assert_eq!(configuration.primary_address, 2);
        assert_eq!(configuration.secondary_id, "22075482");
        assert_eq!(configuration.medium, 0x01);
        assert_eq!(configuration.counter, 15);
        assert_eq!(configuration.vif, 0x13);
        assert_eq!(configuration.numerator, 1);
        assert_eq!(configuration.denominator, 10);
        assert!(!configuration.write_protected);
    }

    #[test]
    fn identifies_and_decodes_real_cyble_cold_water_response() {
        let raw = telegram("68 56 56 68 08 02 72 48 76 01 17 77 04 14 16 17 30 00 00 0C 78 48 76 01 17 0D 7C 08 44 49 20 2E 74 73 75 63 0A 20 20 20 20 30 30 30 37 39 39 04 6D 19 13 59 38 02 7C 09 65 6D 69 74 20 2E 74 61 62 9F 08 04 14 00 00 00 00 04 94 7F 00 00 00 00 44 14 A3 1B 2C 00 0F 10 03 1F C8 16");
        let result = decode_response(parse(&raw).expect("valid Cyble frame"), &raw, 2400)
            .expect("decodable Cyble response");
        let configuration = result
            .device
            .cyble_configuration
            .expect("confirmed Cyble structure");
        assert_eq!(
            result.device.protocol_hint.as_deref(),
            Some("ITRON_CYBLE_MBUS_V2")
        );
        assert_eq!(
            result.device.identification_number.as_deref(),
            Some("17017648")
        );
        assert_eq!(result.device.medium.as_deref(), Some("Cold water"));
        assert_eq!(configuration.customer_id, "000799");
        assert_eq!(configuration.volume, "0");
        assert_eq!(
            (configuration.volume_raw, configuration.volume_vif),
            (0, 0x14)
        );
        assert_eq!(
            (
                configuration.volume_resolution.as_str(),
                configuration.pulse_weight_litres
            ),
            ("0.01", 10.0)
        );
    }

    #[test]
    fn decodes_real_cyble_water_response() {
        let raw = telegram("68 56 56 68 08 04 72 49 76 01 17 77 04 14 07 29 30 00 00 0C 78 48 76 01 17 0D 7C 08 44 49 20 2E 74 73 75 63 0A 20 20 20 20 31 32 33 37 39 39 04 6D 23 13 59 38 02 7C 09 65 6D 69 74 20 2E 74 61 62 9F 08 04 14 58 02 00 00 04 94 7F 00 00 00 00 44 14 A3 1B 2C 00 0F 10 04 1F 39 16");
        let result = decode_response(parse(&raw).expect("valid Cyble frame"), &raw, 2400)
            .expect("decodable Cyble response");
        let configuration = result
            .device
            .cyble_configuration
            .expect("confirmed Cyble structure");
        assert_eq!(result.device.primary_address, Some(4));
        assert_eq!(
            result.device.identification_number.as_deref(),
            Some("17017649")
        );
        assert_eq!(
            result.device.fabrication_number.as_deref(),
            Some("17017648")
        );
        assert_eq!(result.device.medium.as_deref(), Some("Water"));
        assert_eq!(configuration.customer_id, "123799");
        assert_eq!(
            (configuration.volume.as_str(), configuration.volume_raw),
            ("6", 600)
        );
        assert_eq!(
            (configuration.volume_vif, configuration.pulse_weight_litres),
            (0x14, 10.0)
        );
    }

    #[test]
    fn preserves_real_cyble_high_precision_volume_encoding() {
        let raw = telegram("68 56 56 68 08 04 72 49 76 01 17 77 04 14 07 43 30 00 00 0C 78 48 76 01 17 0D 7C 08 44 49 20 2E 74 73 75 63 0A 20 20 20 20 31 32 33 37 39 39 04 6D 2D 13 59 38 02 7C 09 65 6D 69 74 20 2E 74 61 62 9F 08 04 13 4E 61 BC 00 04 93 7F 00 00 00 00 44 13 A3 1B 2C 00 0F 10 05 1F 6C 16");
        let result = decode_response(parse(&raw).expect("valid Cyble frame"), &raw, 2400)
            .expect("decodable Cyble response");
        let configuration = result
            .device
            .cyble_configuration
            .expect("confirmed Cyble structure");
        assert_eq!(configuration.volume, "12345.678");
        assert_eq!(configuration.volume_raw, 12_345_678);
        assert_eq!(configuration.volume_vif, 0x13);
        assert_eq!(configuration.volume_resolution, "0.001");
        assert_eq!(configuration.pulse_weight_litres, 1.0);
    }

    #[test]
    fn decodes_confirmed_extreme_cyble_pulse_weight_from_vif_17() {
        let mut raw = telegram("68 56 56 68 08 04 72 49 76 01 17 77 04 14 07 29 30 00 00 0C 78 48 76 01 17 0D 7C 08 44 49 20 2E 74 73 75 63 0A 20 20 20 20 31 32 33 37 39 39 04 6D 23 13 59 38 02 7C 09 65 6D 69 74 20 2E 74 61 62 9F 08 04 14 58 02 00 00 04 94 7F 00 00 00 00 44 14 A3 1B 2C 00 0F 10 04 1F 39 16");
        let vif_index = raw
            .windows(6)
            .position(|window| window == [0x04, 0x14, 0x58, 0x02, 0x00, 0x00])
            .expect("volume record")
            + 1;
        raw[vif_index] = 0x17;
        let checksum_index = raw.len() - 2;
        raw[checksum_index] = raw[4..checksum_index]
            .iter()
            .fold(0_u8, |checksum, byte| checksum.wrapping_add(*byte));
        let result = decode_response(parse(&raw).expect("valid Cyble frame"), &raw, 2400)
            .expect("decodable Cyble response");
        let configuration = result
            .device
            .cyble_configuration
            .expect("Cyble configuration");
        assert_eq!(configuration.volume_vif, 0x17);
        assert_eq!(configuration.volume_resolution, "10");
        assert_eq!(configuration.pulse_weight_litres, 10000.0);
    }
}
