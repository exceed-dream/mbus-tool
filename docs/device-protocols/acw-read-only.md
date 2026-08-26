# ACW gas meter — read-only evidence

## Identification

- Manufacturer: `ACW` (`0x0477`)
- Observed version: `20` (`0x14`)
- Medium: Gas (`0x03`)
- Configuration support: unsupported; no ACW-specific write command is implemented

## Validated read values

The following values were produced by both mbus-tool and MBSheet and are protected by a parser regression test:

- On time: `2020 s`
- Energy: `621129150 Wh`
- Energy: `0.512 Wh`
- Power: `0 W`

The two Energy records remain separate records with their own DIF, VIF, function and storage metadata.

## Status `0x30`

For a variable-data response, `0x30` sets standard status bit 4 (`Temporary error`) and manufacturer-reserved bit 5. The latter is displayed only as `Manufacturer-specific status`; no ACW meaning is inferred.

## Standard records

- `0C 78 47 61 00 21` is the standard fabrication-number record. Its four packed-BCD bytes decode to `21006147`. It remains distinct from the fixed-header identification number even though both observed values are equal.
- `0D 7C 08 44 49 20 2E 74 73 75 63` starts a variable-length record with a plain-text VIF. The byte `08` is the length of the VIF description, not the value LVAR. In mode 1 the description is `cust. ID`. The supplied fragment ends before the value LVAR and value, so it is preserved as unsupported/incomplete rather than guessed.

References:

- <https://m-bus.com/documentation-wired/06-application-layer>
- <https://m-bus.com/documentation-wired/08-appendix>
