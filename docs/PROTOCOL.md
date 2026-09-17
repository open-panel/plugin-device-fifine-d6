# FIFINE D6 — Hardware & Protocol Notes

Everything this adapter knows about the D6, and how each fact was established.
None of the values below were guessed: each was confirmed against a physical
unit, a USB capture of FIFINE's official software, or both.

- [Source layout](#source-layout)
- [USB identity](#usb-identity)
- [Input reports (buttons)](#input-reports-buttons)
- [Output commands (images)](#output-commands-images)
- [Position → image key remapping](#position--image-key-remapping)
- [Who resizes the artwork](#who-resizes-the-artwork)
- [Calibration](#calibration)
- [Write pacing](#write-pacing)
- [Clearing a button](#clearing-a-button)
- [If your D6 reports differently](#if-your-d6-reports-differently)

## Source layout

| File            | Responsibility                                                           |
| --------------- | ------------------------------------------------------------------------ |
| `plugin.ts`     | Manifest entry point — constructs and exports the driver                 |
| `driver.ts`     | `DeviceDriver` — discovers matching HID devices, caches `DeckDevice`s    |
| `config.ts`     | Env-var overrides and defaults                                           |
| `protocol.ts`   | Pure, unit-tested parsing: input reports, device ids, key-index mapping  |
| `commands.ts`   | Pure, unit-tested output command framing (init/brightness/image/clear)   |
| `hid-device.ts` | `DeckDevice` — wires `node-hid` to `protocol.ts`/`commands.ts`           |

`protocol.ts` and `commands.ts` have no HID dependency and are unit tested
without hardware (`*.test.ts` beside each). `hid-device.ts` is the only file
that touches `node-hid` directly, so the reverse-engineered protocol stays
testable and the I/O stays thin.

The host never knows this is a FIFINE device — only that something satisfies
the `DeckDevice`/`DeviceDriver` interfaces — and nothing outside this plugin
names it.

## USB identity

The D6 enumerates as a generic OEM controller board, **not** under a
FIFINE-branded string:

```text
product:   "HOTSPOTEKUSB HID DEMO"
vendorId:  0x3142
productId: 0x60
```

It exposes two HID interfaces; only one is useful:

| Interface | usagePage                        | Purpose                                                                    |
| --------- | -------------------------------- | -------------------------------------------------------------------------- |
| `if0`     | `0xFFA0` (65440, vendor-defined) | Button events and image output                                             |
| `if1`     | `0x0001` (Generic Desktop)       | Unused — Windows rejects writes to it, and it never reports button presses |

Discovery filters on the usage page, so only `if0` becomes a device.

Device ids are `fifine-d6-<serial>-if<interface>` (falling back to
`<vendorId>-<productId>` without a serial). The interface number comes from
the device's own USB descriptor, so the id stays stable across reconnects —
unlike the OS-assigned `path`, which can change on replug.

Shipping an invented vendor/product id would have silently matched the wrong
device (or none) on someone else's machine, which is why these defaults were
only adopted after being confirmed on real hardware.

## Input reports (buttons)

Every input report on `if0` has a fixed shape:

```text
bytes 0-8:  "ACK\0\0OK\0\0"      9-byte constant preamble
byte 9:     key code (1..15)    keeps its last value after release — never read alone
byte 10:    state flag          1 while held, 0 once released
bytes 11+:  always zero so far
```

Confirmed by pressing one button 3× in a row: byte 9 stayed constant (the
button's real code, not a per-event counter) while byte 10 toggled with each
press/release.

`parseInputReport` reads exactly these two bytes. An earlier version scanned
the whole buffer for any byte in 1..15, which fired a "phantom" press
alongside every real one — byte 9 doesn't reset to 0 on release, so the scan
kept finding it.

Only one key is encoded per report (no rollover bitmask), so at most one
position is ever reported as held.

The code → position mapping (`defaultKeycodeMap`, code N → position N-1) comes
from a sweep pressing all 15 buttons left-to-right/top-to-bottom, which
produced codes 1-15 in that order. Only button 1 has been individually
double-checked. If a specific button acts on the wrong position, capture its
code with `OPENPANEL_FIFINE_DEBUG_RAW=1` (byte 9 of its report) and adjust
the map.

## Output commands (images)

Implemented against the real protocol, ported from the open-source
[`mirajazz`](https://github.com/4ndv/mirajazz) Rust crate (MPL-2.0). FIFINE's
"Ampligame D6" plugin for OpenDeck is built on `mirajazz` (visible from the
crate paths embedded in its binary), which targets the Mirabox/Ajazz
white-label device family the D6 belongs to. `src/commands.ts` is a port of
`mirajazz::device::Device`'s command framing:

```text
Every command:  \0 C R T \0 \0 <cmd-name> <cmd-specific bytes...> <zero padding to 1025 bytes>

DIS + LIG(0,0,0,0)       one-time init, sent lazily before the first image/brightness write
LIG(percent)             set brightness (0-100)
BAT(len_hi,len_lo,key+1) header immediately before an image's data reports
CLE(0,0,0,key+1|0xff)    clear one button's image, or all with 0xff
STP                      commit pending image writes (flush)
CONNECT                  keep-alive
```

Packets are 1024 bytes (+1 report-id byte), i.e. `protocol_version` 3. This
was confirmed independently: `mirajazz`'s `state.rs` read path checks the
exact same `"ACK\0\0OK\0\0"` preamble and byte 9/10 layout this project found
on its own, and `protocol_version > 2` is precisely what unlocks the byte-10
press/release flag.

Two device-specific values `mirajazz` leaves to each plugin were pinned down
empirically:

- **Image size = 128 px.** A 72 px guess rendered small with a black border.
- **Rotation = 180°.** Without it the icon renders upside down.

Writes are queued by `setButtonImage`/`clearButtonImage` and sent in one batch
by `flush()`, followed by a single `STP` — the same queue-then-commit shape
`mirajazz` uses, and what the USB capture of FIFINE's own software shows.

## Position → image key remapping

The image (write) side numbers keys differently from the button (read) side.

**Confirmed via a real USB capture, not guessing.** Black-box testing alone
produced three different, each internally-consistent-looking answers (a
constant offset; then "the key byte is ignored, only arrival order matters",
reproduced across a power cycle and a protocol rewrite; then a third
permutation after changing send order). What resolved it was capturing
FIFINE's official software with Wireshark + USBPcap: for button 1 (position
0) it sends BAT key byte `0x0b` = 11, i.e. 0-based key **10**. That ground
truth matches this table exactly:

```text
position (0-based):   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14
device key (0-based): 10 11 12 13 14  5  6  7  8  9  0  1  2  3  4
```

The first and last rows of the 3×5 grid are swapped relative to the visual
layout — plausible for a hardware matrix scanned in a different order than
it's laid out. `DEFAULT_IMAGE_KEY_MAP` in `protocol.ts` encodes this, and
`mapPositionToImageKey` applies it to the key byte of every BAT/CLE header.

Override with `OPENPANEL_FIFINE_IMAGE_KEY_MAP` if a different revision uses a
different table. Capturing the official software the same way is the reliable
way to get it — not trial and error.

## Who resizes the artwork

**This adapter imports no image library.** It declares what it needs:

```ts
capabilities.buttonImage = { size, encoding: "jpeg", quality: 90, rotationDegrees };
capabilities.supportsImageCalibration = true;
```

and `setButtonImage` writes whatever bytes it's handed. Resizing, rotating,
insetting by the calibrated margin and encoding is identical work for every
deck with a screen, so the OpenPanel host does it once, centrally. (`sharp`
used to be a dependency of this plugin; it isn't anymore.)

The host also caches encoded icons by content hash and prepares every
position concurrently, and re-renders every connected device whenever a
button, its icon or the active profile changes — walking every physical
position so a removed button's stale image is cleared too.

## Calibration

`supportsImageCalibration: true` tells the host that this device's per-button
screens aren't mounted with uniform alignment. With a 6 px margin on a real
D6, button 1 rendered perfectly centered but the rest were off-center — in
different directions per position, so no single global fix works.

Margin and per-position nudges are **not** env vars. They're live settings,
persisted per physical device id and edited in the desktop app under
**Settings → Calibration** while looking at the hardware. The host applies
them at encode time, so the device itself is stateless about calibration and
there's nothing to replay after a reconnect.

## Write pacing

**No inter-packet delay is needed.** A full 15-button page is 70+ HID reports.
An earlier 8 ms `setTimeout` between writes (on the theory that fast writes
drop reports) took a render from tens of milliseconds to 1–1.8 s — mostly from
`setTimeout`'s scheduling overhead on Windows compounding across dozens of
calls. The USB capture shows FIFINE's own software sending consecutive
reports under 1 ms apart, so the delay now defaults to 0 and a full page
renders in ~30 ms. `OPENPANEL_FIFINE_WRITE_DELAY_MS` adds it back for a unit
that turns out to need it.

## Clearing a button

`CLE` alone only clears the centre of a button on real hardware — the
previous icon's edge pixels stay on screen as a border. So clearing sends
`CLE` **and** a full black frame (supplied by the host) through the normal
image path, which overwrites every pixel.

## If your D6 reports differently

Other batches/revisions may differ. From an OpenPanel checkout, list HID
devices with:

```bash
pnpm --filter @open-panel/cli dev -- devices scan-hid
```

If the product string, vendor/product id or usage page differs from the
defaults above, override them:

```bash
OPENPANEL_FIFINE_VENDOR_ID=0x1234 \
OPENPANEL_FIFINE_PRODUCT_ID=0x5678 \
OPENPANEL_FIFINE_USAGE_PAGE=0xffa0 \
OPENPANEL_FIFINE_BUTTON_COUNT=15 \
OPENPANEL_FIFINE_IMAGE_KEY_MAP=10,11,12,13,14,5,6,7,8,9,0,1,2,3,4 \
pnpm dev:daemon
```

`OPENPANEL_FIFINE_DEBUG_RAW=1` prints every raw input report as hex
(`[fifine-d6 raw] <deviceId>: <hex>`), plus every outgoing write and flush
timing, to the daemon console. Once you have a sample buffer,
`parseInputReport`/`defaultKeycodeMap` can be exercised in
`protocol.test.ts` without the hardware.
