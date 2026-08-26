use super::checksum;

#[derive(Debug, Clone, PartialEq)]
pub enum MbusFrame {
    Ack,
    Short {
        control: u8,
        address: u8,
    },
    Long {
        control: u8,
        address: u8,
        ci: u8,
        data: Vec<u8>,
    },
}

pub fn encode_req_ud2(address: u8) -> Result<Vec<u8>, String> {
    if address > 250 {
        return Err(format!("Primary address out of range: {address}"));
    }
    Ok(encode_short_frame(0x5b, address))
}

pub fn encode_selected_req_ud2() -> Vec<u8> {
    encode_short_frame(0x5b, 0xfd)
}

pub fn encode_secondary_selection(data: &[u8; 8]) -> Vec<u8> {
    encode_long_frame(0x53, 0xfd, 0x52, data).expect("secondary selection payload is bounded")
}

pub fn encode_snd_ud(control: u8, address: u8, ci: u8, data: &[u8]) -> Result<Vec<u8>, String> {
    if !matches!(control, 0x53 | 0x73) {
        return Err("SND_UD control field must be 0x53 or 0x73".to_string());
    }
    if address == 0xff {
        return Err(
            "Broadcast SND_UD is not allowed for confirmed configuration writes".to_string(),
        );
    }
    encode_long_frame(control, address, ci, data)
}

pub fn encode_snd_nke(address: u8) -> Vec<u8> {
    encode_short_frame(0x40, address)
}

fn encode_short_frame(control: u8, address: u8) -> Vec<u8> {
    vec![
        0x10,
        control,
        address,
        checksum::calculate(&[control, address]),
        0x16,
    ]
}

pub fn encode_long_frame(control: u8, address: u8, ci: u8, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() > 252 {
        return Err("M-Bus long-frame payload exceeds 252 bytes".to_string());
    }
    let length = (3 + data.len()) as u8;
    let mut frame = vec![0x68, length, length, 0x68, control, address, ci];
    frame.extend_from_slice(data);
    frame.push(checksum::calculate(&frame[4..]));
    frame.push(0x16);
    Ok(frame)
}

pub fn parse(bytes: &[u8]) -> Result<MbusFrame, String> {
    match bytes.first().copied() {
        Some(0xe5) if bytes.len() == 1 => Ok(MbusFrame::Ack),
        Some(0x10) => parse_short(bytes),
        Some(0x68) => parse_long(bytes),
        Some(start) => Err(format!("Invalid M-Bus frame start: 0x{start:02X}")),
        None => Err("Invalid M-Bus frame: empty response".to_string()),
    }
}

fn parse_short(bytes: &[u8]) -> Result<MbusFrame, String> {
    if bytes.len() != 5 || bytes[4] != 0x16 {
        return Err("Invalid M-Bus short frame length or stop byte".to_string());
    }
    if checksum::calculate(&bytes[1..3]) != bytes[3] {
        return Err("Checksum error".to_string());
    }
    Ok(MbusFrame::Short {
        control: bytes[1],
        address: bytes[2],
    })
}

fn parse_long(bytes: &[u8]) -> Result<MbusFrame, String> {
    if bytes.len() < 9 || bytes[1] != bytes[2] || bytes[3] != 0x68 {
        return Err("Invalid M-Bus long frame header".to_string());
    }
    let length = bytes[1] as usize;
    if length < 3 || bytes.len() != length + 6 || bytes[bytes.len() - 1] != 0x16 {
        return Err("Invalid M-Bus long frame length or stop byte".to_string());
    }
    let content = &bytes[4..4 + length];
    if checksum::calculate(content) != bytes[4 + length] {
        return Err("Checksum error".to_string());
    }
    Ok(MbusFrame::Long {
        control: content[0],
        address: content[1],
        ci: content[2],
        data: content[3..].to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        encode_long_frame, encode_req_ud2, encode_secondary_selection, encode_snd_nke,
        encode_snd_ud, parse, MbusFrame,
    };

    #[test]
    fn encodes_req_ud2_short_frame() {
        assert_eq!(
            encode_req_ud2(1).expect("valid address"),
            vec![0x10, 0x5b, 0x01, 0x5c, 0x16]
        );
    }

    #[test]
    fn encodes_primary_address_zero() {
        assert_eq!(
            encode_req_ud2(0).expect("address zero is valid"),
            vec![0x10, 0x5b, 0x00, 0x5b, 0x16]
        );
    }

    #[test]
    fn encodes_synthetic_secondary_selection() {
        let data = [0x82, 0x54, 0x07, 0x22, 0xff, 0xff, 0xff, 0xff];
        assert_eq!(
            encode_secondary_selection(&data),
            vec![
                0x68, 0x0b, 0x0b, 0x68, 0x53, 0xfd, 0x52, 0x82, 0x54, 0x07, 0x22, 0xff, 0xff, 0xff,
                0xff, 0x9d, 0x16
            ]
        );
    }

    #[test]
    fn encodes_secondary_deselect() {
        assert_eq!(encode_snd_nke(0xfd), vec![0x10, 0x40, 0xfd, 0x3d, 0x16]);
    }

    #[test]
    fn encodes_documented_primary_address_write() {
        assert_eq!(
            encode_snd_ud(0x53, 0xfe, 0x51, &[0x01, 0x7a, 0x08]).expect("valid SND_UD"),
            vec![0x68, 0x06, 0x06, 0x68, 0x53, 0xfe, 0x51, 0x01, 0x7a, 0x08, 0x25, 0x16]
        );
    }

    #[test]
    fn encodes_selected_primary_address_write_with_initial_fcb() {
        assert_eq!(
            encode_snd_ud(0x73, 0xfd, 0x51, &[0x01, 0x7a, 0x0c]).expect("valid SND_UD"),
            vec![0x68, 0x06, 0x06, 0x68, 0x73, 0xfd, 0x51, 0x01, 0x7a, 0x0c, 0x48, 0x16]
        );
    }

    #[test]
    fn rejects_an_oversized_long_frame() {
        assert!(encode_long_frame(0x53, 1, 0x51, &[0; 253]).is_err());
    }

    #[test]
    fn validates_a_synthetic_long_frame() {
        let frame = [0x68, 0x04, 0x04, 0x68, 0x08, 0x01, 0x72, 0x00, 0x7b, 0x16];
        assert_eq!(
            parse(&frame).expect("valid frame"),
            MbusFrame::Long {
                control: 0x08,
                address: 1,
                ci: 0x72,
                data: vec![0]
            }
        );
    }

    #[test]
    fn rejects_a_bad_checksum() {
        let frame = [0x10, 0x5b, 0x01, 0x00, 0x16];
        assert_eq!(parse(&frame).expect_err("bad checksum"), "Checksum error");
    }
}
