# FIFINE D6 for OpenPanel

USB HID device plugin that lets [OpenPanel](https://github.com/open-panel/openPanel) drive the FIFINE D6 macro pad — buttons and per-key screens.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933?logo=node.js&logoColor=white)
![OpenPanel plugin API](https://img.shields.io/badge/OpenPanel%20API-%5E1-7c3aed)

## What it is

The FIFINE D6 is a 15-key macro pad with a small screen under each key. Out of
the box it only works with FIFINE's own software. This plugin is a driver
for [OpenPanel](https://github.com/open-panel/openPanel), an open-source,
hardware-agnostic control app for Stream Deck-style devices. Install it, and
the D6 works like any other deck in OpenPanel: bind actions to keys and show
an icon on each one.

### What problem it solves

- **No vendor lock-in.** You can use the D6 without FIFINE's software.
- **The protocol, figured out.** The D6 shows up over USB as a generic
  `HOTSPOTEKUSB HID DEMO` board and uses an undocumented protocol. This plugin
  works it out from USB captures and tests on real hardware, so you don't
  have to.
- **Zero configuration.** A standard D6 is found as soon as it's plugged in.

## Features

- Finds the D6 over USB HID automatically and reconnects after an unplug
- Sends press and release events for all 15 buttons, mapped to grid positions
- Shows a separate icon (128 × 128 JPEG) on each button's screen
- Sends a whole page of icons in one batch (~30 ms)
- Clears a button fully, so no pixels from the old icon are left behind
- Adjusts brightness when the device connects
- Supports per-button alignment tweaks (set in OpenPanel under **Settings → Calibration**)
- Every hardware setting can be changed with an environment variable, for D6
  revisions that behave differently
- Can log raw HID traffic for debugging and reverse-engineering
- Needs no image library, because OpenPanel resizes and encodes the icons

## Requirements

- **OpenPanel** with plugin API `^1`
- **Node.js** ≥ 22.5 (only for development — the OpenPanel app ships its own runtime)
- **pnpm** 9 (only for development)
- A **FIFINE D6** connected over USB
- **Linux only:** permission to open the device's hidraw node (see [Linux permissions](#linux-permissions))

Runtime dependencies (`@open-panel/plugin-sdk`, `@open-panel/device-sdk`,
`@open-panel/shared`, `node-hid`) come **with OpenPanel**. You don't install
them yourself.

## Installation

### From the desktop app (recommended)

1. Download this repository as a `.zip` (**Code → Download ZIP** on GitHub, or
   grab a release).
2. In OpenPanel, open **Settings → Plugins** and drop the `.zip` on the import area.
3. Plug in the D6.

The plugin starts working right away, with no restart.

### Manually

Clone or copy the repository into your OpenPanel plugins directory:

```bash
git clone https://github.com/open-panel/plugin-device-fifine-d6.git \
  ~/.openpanel/plugins/fifine-d6
```

Then restart the OpenPanel daemon.

### Linux permissions

On Linux, regular users usually can't open HID devices. Add a udev rule:

```bash
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="3142", ATTRS{idProduct}=="0060", MODE="0660", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules/70-fifine-d6.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then unplug the D6 and plug it back in.

## Usage

1. Start OpenPanel and plug in the D6. It shows up in the device list as
   **HOTSPOTEKUSB HID DEMO** (or your unit's manufacturer string).
2. Pick a button in a profile, add an action (e.g. `open-url`, `type-text`) and
   choose an icon.
3. Press the physical key and the action runs. The icon shows up on the
   key's screen right away.

Button positions start at 0 and go left to right, top to bottom:

```text
┌────┬────┬────┬────┬────┐
│  0 │  1 │  2 │  3 │  4 │
├────┼────┼────┼────┼────┤
│  5 │  6 │  7 │  8 │  9 │
├────┼────┼────┼────┼────┤
│ 10 │ 11 │ 12 │ 13 │ 14 │
└────┴────┴────┴────┴────┘
```

### Troubleshooting

If the D6 isn't found:

1. Make sure it shows up as `HOTSPOTEKUSB HID DEMO`, vendor `0x3142`, product
   `0x60`, usage page `0xFFA0`. From an OpenPanel checkout:
   ```bash
   pnpm --filter @open-panel/cli dev -- devices scan-hid
   ```
2. If your unit reports different values, override them (see
   [Configuration](#configuration)).
3. Start the daemon with `OPENPANEL_FIFINE_DEBUG_RAW=1` to log every HID report.

## Configuration

A standard D6 needs **no configuration**. The plugin has no config file. Every
setting has a default that can be changed with an environment variable set
for the OpenPanel daemon (read in [`src/config.ts`](src/config.ts)):

| Variable                          | Default                             | Description                                              |
| --------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `OPENPANEL_FIFINE_VENDOR_ID`      | `0x3142`                            | USB vendor id                                            |
| `OPENPANEL_FIFINE_PRODUCT_ID`     | `0x60`                              | USB product id                                           |
| `OPENPANEL_FIFINE_USAGE_PAGE`     | `0xffa0`                            | Only use the HID interface with this usage page          |
| `OPENPANEL_FIFINE_BUTTON_COUNT`   | `15`                                | Number of physical buttons                               |
| `OPENPANEL_FIFINE_IMAGE_SIZE`     | `128`                               | Icon size in pixels (square)                             |
| `OPENPANEL_FIFINE_IMAGE_ROTATION` | `180`                               | How far to rotate icons before sending (`0/90/180/270`)  |
| `OPENPANEL_FIFINE_IMAGE_KEY_MAP`  | `10,11,12,13,14,5,6,7,8,9,0,1,2,3,4` | 15 comma-separated numbers: button position → device image key |
| `OPENPANEL_FIFINE_BRIGHTNESS`     | `100`                               | Brightness (0–100) set on connect                        |
| `OPENPANEL_FIFINE_WRITE_DELAY_MS` | `0`                                 | Extra delay between HID writes                           |
| `OPENPANEL_FIFINE_DEBUG_RAW`      | unset                               | `1` logs every raw HID report and write                  |

Example:

```bash
OPENPANEL_FIFINE_BRIGHTNESS=60 OPENPANEL_FIFINE_DEBUG_RAW=1 pnpm dev:daemon
```

**Icon alignment is not set with environment variables.** Margins and
per-button offsets are saved separately for each device, and you edit them
in the OpenPanel desktop app under **Settings → Calibration**.

## Documentation

- [`docs/PROTOCOL.md`](docs/PROTOCOL.md): how the D6 protocol was worked out,
  including report layout, command framing, key remapping, calibration and
  the evidence for each value
- [OpenPanel plugin guide](https://github.com/open-panel/openPanel/blob/main/docs/PLUGINS.md):
  the plugin manifest, device contributions and packaging

## Contributing

Contributions are welcome, especially captures and fixes for other D6
revisions.

### Development setup

The plugin builds against OpenPanel's workspace packages, so work on it inside
an OpenPanel checkout:

```bash
git clone https://github.com/open-panel/openPanel.git
cd openPanel
rm -rf plugins/fifine-d6
git clone https://github.com/open-panel/plugin-device-fifine-d6.git plugins/fifine-d6
pnpm install
pnpm dev          # daemon + desktop app, loading this plugin from source
```

The plugin is plain TypeScript and is loaded without a build step.

### Running tests

From `plugins/fifine-d6`:

```bash
pnpm test         # unit tests (vitest)
pnpm typecheck    # tsc --noEmit
```

Or from the OpenPanel root: `pnpm --filter @open-panel/plugin-fifine-d6 test`.
Run `pnpm lint` from the root before opening a PR.

The tests don't need hardware. `protocol.ts` and `commands.ts` are pure
functions tested with synthetic buffers.

### Packaging

```bash
pnpm package:plugin plugins/fifine-d6   # -> dist/fifine-d6-<version>.zip
```

### Guidelines

- **Keep I/O out of the protocol code.** Parsing and command framing go in
  `protocol.ts`/`commands.ts` with a `*.test.ts` next to them. Only
  `hid-device.ts` may import `node-hid`.
- **Back up protocol changes with evidence.** Say how a value was confirmed
  (USB capture, test on real hardware) in the code comment and in
  `docs/PROTOCOL.md`.
- **Never crash the daemon.** HID errors mark the device as disconnected.
  They don't throw.
- **Don't add image libraries.** Declare what the device needs in
  `capabilities.buttonImage` and let the host encode the icons.
- Use strict TypeScript. Don't use `any` without a comment explaining why.
- Keep commits small and focused. Explain *why* in the commit body.

## Roadmap

- [ ] Keep-alive (`CONNECT`) on a timer
- [ ] Brightness control while the device is running (currently only set on connect)
- [ ] Confirm the button code → position mapping for each of the 15 keys individually
- [ ] Support other members of the Mirabox/Ajazz family that use the same protocol

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)

## Credits

- The command framing is ported from [`mirajazz`](https://github.com/4ndv/mirajazz)
  by 4ndv (MPL-2.0).
- Built for [OpenPanel](https://github.com/open-panel/openPanel).
- FIFINE is a trademark of its owner. This project is not affiliated with or
  endorsed by FIFINE.

## Support

Report bugs and request D6 revision support in the GitHub
[issues](https://github.com/open-panel/plugin-device-fifine-d6/issues). When reporting a detection or protocol problem, include
the output of `devices scan-hid` and a log captured with
`OPENPANEL_FIFINE_DEBUG_RAW=1`.
