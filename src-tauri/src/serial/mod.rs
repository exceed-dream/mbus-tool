mod models;
mod port;

pub use models::{SerialConnectionSettings, SerialPortInfo};
pub use port::{list_ports, open_port, SerialConnection};
