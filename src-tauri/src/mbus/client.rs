use std::io::Read;
use std::time::Duration;

use serialport::{ClearBuffer, SerialPort};

use super::{
    frame,
    models::DeviceReadResult,
    parser,
    secondary::{SecondaryAddressMask, SecondaryProbeKind},
};

#[derive(Debug)]
pub enum ScanReadError {
    Timeout,
    Protocol(String),
    Io(String),
}

#[derive(Debug)]
pub struct SecondaryProbe {
    pub kind: SecondaryProbeKind,
    pub result: Option<DeviceReadResult>,
    pub acknowledgement: Option<Vec<u8>>,
    pub response: Option<Vec<u8>>,
    pub diagnostic: Option<String>,
}

pub fn read_primary_address(
    port: &mut dyn SerialPort,
    address: u8,
    baud_rate: u32,
) -> Result<(DeviceReadResult, Vec<u8>, Vec<u8>), ScanReadError> {
    let request = frame::encode_req_ud2(address).map_err(ScanReadError::Protocol)?;
    let response = exchange(port, &request)?;
    let parsed = frame::parse(&response).map_err(ScanReadError::Protocol)?;
    let result =
        parser::decode_response(parsed, &response, baud_rate).map_err(ScanReadError::Protocol)?;
    Ok((result, request, response))
}

pub fn probe_secondary_address(
    port: &mut dyn SerialPort,
    mask: &SecondaryAddressMask,
    baud_rate: u32,
) -> Result<SecondaryProbe, ScanReadError> {
    let selection_data = mask.encode().map_err(ScanReadError::Protocol)?;
    let selection = frame::encode_secondary_selection(&selection_data);
    let acknowledgement = match exchange(port, &selection) {
        Ok(bytes) => bytes,
        Err(ScanReadError::Timeout) => {
            return Ok(SecondaryProbe {
                kind: SecondaryProbeKind::NoDevice,
                result: None,
                acknowledgement: None,
                response: None,
                diagnostic: None,
            })
        }
        Err(error) => return Ok(collision_probe(None, None, read_error_text(&error))),
    };
    match frame::parse(&acknowledgement) {
        Ok(frame::MbusFrame::Ack) => {}
        Ok(_) => {
            return Ok(collision_probe(
                Some(acknowledgement),
                None,
                "Selection returned a non-ACK frame".to_string(),
            ))
        }
        Err(message) => return Ok(collision_probe(Some(acknowledgement), None, message)),
    }

    let request = frame::encode_selected_req_ud2();
    let response = match exchange(port, &request) {
        Ok(bytes) => bytes,
        Err(error) => {
            return Ok(collision_probe(
                Some(acknowledgement),
                None,
                read_error_text(&error),
            ))
        }
    };
    let parsed = match frame::parse(&response) {
        Ok(parsed) => parsed,
        Err(message) => {
            return Ok(collision_probe(
                Some(acknowledgement),
                Some(response),
                message,
            ))
        }
    };
    match parser::decode_response(parsed, &response, baud_rate) {
        Ok(result) => Ok(SecondaryProbe {
            kind: SecondaryProbeKind::SingleDevice,
            result: Some(result),
            acknowledgement: Some(acknowledgement),
            response: Some(response),
            diagnostic: None,
        }),
        Err(message) => Ok(collision_probe(
            Some(acknowledgement),
            Some(response),
            message,
        )),
    }
}

pub fn deselect_secondary(port: &mut dyn SerialPort) -> Result<Vec<u8>, ScanReadError> {
    let request = frame::encode_snd_nke(0xfd);
    let _ = port.clear(ClearBuffer::Input);
    port.write_all(&request).map_err(map_io_error)?;
    port.flush().map_err(map_io_error)?;
    let previous_timeout = port.timeout();
    let _ = port.set_timeout(Duration::from_millis(50));
    let _ = read_frame(port);
    let _ = port.set_timeout(previous_timeout);
    Ok(request)
}

pub(crate) fn exchange(
    port: &mut dyn SerialPort,
    request: &[u8],
) -> Result<Vec<u8>, ScanReadError> {
    let _ = port.clear(ClearBuffer::Input);
    port.write_all(request).map_err(map_io_error)?;
    port.flush().map_err(map_io_error)?;
    read_frame(port)
}

fn collision_probe(
    acknowledgement: Option<Vec<u8>>,
    response: Option<Vec<u8>>,
    diagnostic: String,
) -> SecondaryProbe {
    SecondaryProbe {
        kind: SecondaryProbeKind::Collision,
        result: None,
        acknowledgement,
        response,
        diagnostic: Some(diagnostic),
    }
}

fn read_error_text(error: &ScanReadError) -> String {
    match error {
        ScanReadError::Timeout => "Timeout after secondary selection ACK".to_string(),
        ScanReadError::Protocol(message) | ScanReadError::Io(message) => message.clone(),
    }
}

fn read_frame(port: &mut dyn SerialPort) -> Result<Vec<u8>, ScanReadError> {
    let mut start = [0_u8; 1];
    read_exact(port, &mut start)?;
    match start[0] {
        0xe5 => Ok(start.to_vec()),
        0x10 => {
            let mut rest = [0_u8; 4];
            read_exact(port, &mut rest)?;
            Ok([start.as_slice(), rest.as_slice()].concat())
        }
        0x68 => {
            let mut header = [0_u8; 3];
            read_exact(port, &mut header)?;
            if header[0] != header[1] || header[2] != 0x68 {
                return Err(ScanReadError::Protocol(
                    "Invalid M-Bus long frame header".to_string(),
                ));
            }
            let mut rest = vec![0_u8; header[0] as usize + 2];
            read_exact(port, &mut rest)?;
            Ok([start.as_slice(), header.as_slice(), rest.as_slice()].concat())
        }
        value => Err(ScanReadError::Protocol(format!(
            "Invalid M-Bus frame start: 0x{value:02X}"
        ))),
    }
}

fn read_exact(port: &mut dyn SerialPort, buffer: &mut [u8]) -> Result<(), ScanReadError> {
    Read::read_exact(port, buffer).map_err(map_io_error)
}

fn map_io_error(error: std::io::Error) -> ScanReadError {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        ScanReadError::Timeout
    } else {
        ScanReadError::Io(format!("Serial I/O failed: {error}"))
    }
}
