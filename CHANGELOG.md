# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0]

### Added

- USB HID discovery for the FIFINE D6 (`0x3142:0x60`, usage page `0xFFA0`).
- Press/release events for all 15 buttons.
- Per-button icons (128 px JPEG, rotated 180°), batched and committed with one flush.
- Position → image key remapping confirmed by a USB capture of FIFINE's software.
- Full clear (`CLE` plus a black frame) so no edge pixels are left behind.
- Brightness applied on connect.
- Per-device image calibration support (`supportsImageCalibration`).
- Environment variable overrides for every hardware setting, plus raw HID debug logging.
