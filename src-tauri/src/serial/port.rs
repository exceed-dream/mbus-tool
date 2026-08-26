use std::time::Duration;

use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits};

use super::{SerialConnectionSettings, SerialPortInfo};

pub struct SerialConnection {
    pub port: Box<dyn SerialPort>,
    pub settings: SerialConnectionSettings,
}

pub fn list_ports() -> Result<Vec<SerialPortInfo>, String> {
    let mut ports = serialport::available_ports()
        .map_err(|error| format!("Serial port enumeration failed: {error}"))?
        .into_iter()
        .map(|port| {
            let (port_type, manufacturer, product, serial_number) = match port.port_type {
                SerialPortType::UsbPort(info) => (
                    "USB".to_string(),
                    info.manufacturer,
                    info.product,
                    info.serial_number,
                ),
                SerialPortType::PciPort => ("PCI".to_string(), None, None, None),
                SerialPortType::BluetoothPort => ("Bluetooth".to_string(), None, None, None),
                SerialPortType::Unknown => ("Unknown".to_string(), None, None, None),
            };
            SerialPortInfo {
                port_name: port.port_name,
                port_type,
                manufacturer,
                product,
                serial_number,
            }
        })
        .collect::<Vec<_>>();
    ports.sort_by(|left, right| left.port_name.cmp(&right.port_name));
    Ok(ports)
}

pub fn open_port(settings: SerialConnectionSettings) -> Result<SerialConnection, String> {
    if settings.port_name.trim().is_empty() {
        return Err("Serial port unavailable: no port selected".to_string());
    }
    let data_bits = match settings.data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        8 => DataBits::Eight,
        value => return Err(format!("Unsupported data bits value: {value}")),
    };
    let stop_bits = match settings.stop_bits {
        1 => StopBits::One,
        2 => StopBits::Two,
        value => return Err(format!("Unsupported stop bits value: {value}")),
    };
    let parity = match settings.parity.to_ascii_lowercase().as_str() {
        "none" => Parity::None,
        "odd" => Parity::Odd,
        "even" => Parity::Even,
        value => return Err(format!("Unsupported parity value: {value}")),
    };

    let port = serialport::new(&settings.port_name, settings.baud_rate)
        .data_bits(data_bits)
        .flow_control(FlowControl::None)
        .parity(parity)
        .stop_bits(stop_bits)
        .timeout(Duration::from_millis(settings.timeout.max(1)))
        .open()
        .map_err(|error| friendly_open_error(&settings.port_name, error))?;

    Ok(SerialConnection { port, settings })
}

fn friendly_open_error(port_name: &str, error: serialport::Error) -> String {
    use serialport::ErrorKind;
    match error.kind {
        ErrorKind::NoDevice => format!("Port not found: {port_name}"),
        ErrorKind::InvalidInput => format!("Invalid serial settings for {port_name}: {error}"),
        ErrorKind::Io(ref kind) if *kind == std::io::ErrorKind::PermissionDenied => {
            format!("Access denied: {port_name} may already be in use")
        }
        _ => format!("Connection failed for {port_name}: {error}"),
    }
}
