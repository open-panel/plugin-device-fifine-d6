/**
 * FIFINE D6 output/write protocol — ported from the open-source `mirajazz`
 * Rust crate (https://github.com/4ndv/mirajazz, MPL-2.0), which the
 * "FIFINE Ampligame D6" plugin for OpenDeck is built on (confirmed via the
 * plugin binary's embedded crate paths — the D6 is a rebadged member of the
 * same Mirabox/Ajazz device family). This is a faithful port of
 * `mirajazz::device::Device`'s command framing, not a guess — see
 * ../README.md "Image output" for how it was found.
 *
 * Every command shares the same 6-byte prefix `\0CRT\0\0` ("CRT" — likely
 * short for a command/control channel), followed by a 3-4 letter command
 * name and command-specific bytes, all padded with zeros to REPORT_LENGTH.
 *
 * Confirmed independently: our own button-read reverse engineering
 * (protocol.ts) found the exact same "ACK\0\0OK\0\0" input preamble and
 * byte 9/10 (code/state) layout that mirajazz's state.rs implements,
 * validating protocol_version 3 (packet_size 1024) for this device family.
 */

/** protocol_version 3 devices (this one, per the confirmed press/release flag support) use 1024-byte packets. */
export const PACKET_SIZE = 1024;
/** Every HID output report is the packet size plus a leading report-id byte. */
export const REPORT_LENGTH = PACKET_SIZE + 1;

const COMMAND_PREFIX = [0x00, 0x43, 0x52, 0x54, 0x00, 0x00]; // "\0CRT\0\0"

function buildCommand(bytes: number[]): Buffer {
  const buf = Buffer.alloc(REPORT_LENGTH);
  Buffer.from([...COMMAND_PREFIX, ...bytes]).copy(buf);
  return buf;
}

/** Sent once before any other command on a freshly connected device. */
export function buildInitCommands(): Buffer[] {
  return [
    buildCommand([0x44, 0x49, 0x53]), // "DIS"
    buildCommand([0x4c, 0x49, 0x47, 0x00, 0x00, 0x00, 0x00]), // "LIG" (init form)
  ];
}

/** percent: 0-100. */
export function buildSetBrightnessCommand(percent: number): Buffer {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return buildCommand([0x4c, 0x49, 0x47, 0x00, 0x00, clamped]); // "LIG"
}

/** position: 0-based button position, or 0xff to clear every button. */
export function buildClearButtonCommand(position: number): Buffer {
  const keyByte = position === 0xff ? 0xff : position + 1;
  return buildCommand([0x43, 0x4c, 0x45, 0x00, 0x00, 0x00, keyByte]); // "CLE"
}

/** Header packet sent immediately before the chunked image data reports for one button. */
export function buildSendImageHeader(position: number, imageByteLength: number): Buffer {
  const keyByte = position + 1;
  return buildCommand([
    0x42,
    0x41,
    0x54, // "BAT"
    0x00,
    0x00,
    (imageByteLength >> 8) & 0xff,
    imageByteLength & 0xff,
    keyByte,
  ]);
}

/** Splits already-encoded image bytes (see images.ts) into fixed-size HID output reports. */
export function buildImageDataReports(imageData: Buffer): Buffer[] {
  const headerLength = 1; // leading 0x00 report-id byte
  const payloadLength = REPORT_LENGTH - headerLength;
  const reports: Buffer[] = [];
  for (let offset = 0; offset < imageData.length; offset += payloadLength) {
    const chunkLength = Math.min(payloadLength, imageData.length - offset);
    const report = Buffer.alloc(REPORT_LENGTH);
    imageData.copy(report, headerLength, offset, offset + chunkLength);
    reports.push(report);
  }
  return reports;
}

/** Commits pending image writes (send after the header + data reports for every changed button). */
export function buildFlushCommand(): Buffer {
  return buildCommand([0x53, 0x54, 0x50]); // "STP"
}

/** Periodic no-op to keep the device from timing out/sleeping. */
export function buildKeepAliveCommand(): Buffer {
  return buildCommand([0x43, 0x4f, 0x4e, 0x4e, 0x45, 0x43, 0x54]); // "CONNECT"
}
