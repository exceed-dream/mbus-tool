pub fn calculate(bytes: &[u8]) -> u8 {
    bytes.iter().fold(0_u8, |sum, byte| sum.wrapping_add(*byte))
}

#[cfg(test)]
mod tests {
    use super::calculate;

    #[test]
    fn calculates_wrapping_checksum() {
        assert_eq!(calculate(&[0x5b, 0x01]), 0x5c);
        assert_eq!(calculate(&[0xff, 0x02]), 0x01);
    }
}
