import { StepData } from "./segmenter";
import { sendNoteOn, sendNoteOff, sendStart, sendStop, sendClock, sendSysEx } from "./webmidi";

// ─── Elektron SysEx constants ────────────────────────────────────────────────
// Manufacturer ID: 00 20 3C
// Digitakt (original) product ID: 0x0E
// Digitakt 2 product ID: community-reported as 0x12 — configurable in UI
// Protocol: Single pattern track dump

const ELEKTRON_MFR = [0x00, 0x20, 0x3c];

// Elektron 7-bit packing: every 7 input bytes → 8 output bytes.
// First byte of each group carries the MSBs (bit 7) of the following 7 bytes.
function pack7bit(input: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 7) {
    const chunk = input.slice(i, Math.min(i + 7, input.length));
    let msb = 0;
    for (let j = 0; j < chunk.length; j++) {
      if (chunk[j] & 0x80) msb |= 1 << j;
    }
    out.push(msb & 0x7f);
    for (let j = 0; j < chunk.length; j++) {
      out.push(chunk[j] & 0x7f);
    }
  }
  return out;
}

// Elektron checksum: sum of all body bytes, masked to 7 bits.
function elektronChecksum(bytes: number[]): number {
  return bytes.reduce((acc, b) => (acc + b) & 0x7f, 0);
}

// ─── SysEx pattern write ──────────────────────────────────────────────────────
// Sends a simplified Elektron pattern track dump to the device.
// Format (pre-packing):
//   [version=0x01] [trackIndex 0-15] [stepCount] [for each step: note, vel, len, flags]
//
// NOTE: The Digitakt 2 SysEx protocol is reverse-engineered from community documentation
// (Elektron Transfer app traffic analysis). Device ID 0x12 is community-reported for DT2.
// Verify against your firmware version before relying on this in a live set.

export function buildPatternSysEx(
  deviceId: number,
  trackIndex: number,
  steps: StepData[],
): Uint8Array {
  const stepCount = steps.length;

  // Raw data bytes (before 7-bit packing)
  const raw: number[] = [
    0x01,                    // format version
    trackIndex & 0x0f,       // track 0-15
    stepCount & 0x7f,        // number of steps
  ];

  for (const step of steps) {
    raw.push(step.note & 0x7f);
    raw.push(step.velocity & 0x7f);
    raw.push(step.length & 0x7f);
    raw.push(step.active ? 0x01 : 0x00); // trig on/off flag
  }

  const packed = pack7bit(new Uint8Array(raw));
  const checksum = elektronChecksum(packed);

  // Full SysEx body (without the F0/F7 framing — sendSysEx adds those)
  return new Uint8Array([
    ...ELEKTRON_MFR,
    deviceId & 0x7f,
    0x00,         // MIDI channel / OS sub-version byte (0 = any)
    0x68,         // command: pattern data
    ...packed,
    checksum,
  ]);
}

export async function sendPatternSysEx(
  output: MIDIOutput,
  deviceId: number,
  trackIndex: number,
  steps: StepData[],
): Promise<void> {
  const sysexBody = buildPatternSysEx(deviceId, trackIndex, steps);
  sendSysEx(output, Array.from(sysexBody));
}

// ─── Real-time playback ───────────────────────────────────────────────────────
// Plays steps as MIDI notes in real time using Web Audio / performance.now() timing.
// The DT2 must be in LIVE RECORDING mode to capture this to its sequencer.
// Send 24 MIDI clock ticks per quarter note at the given BPM so the DT2 syncs.

export interface PlaybackHandle {
  stop: () => void;
}

export function playStepsRealtime(
  output: MIDIOutput,
  channel: number,
  steps: StepData[],
  bpm: number,
  onStep?: (index: number) => void,
): PlaybackHandle {
  let stopped = false;
  const ch = channel;

  // Each step = one 16th note at the given BPM
  const sixteenthMs = (60_000 / bpm) / 4;
  // MIDI clock: 24 pulses per quarter note = 6 pulses per 16th note
  const clockIntervalMs = sixteenthMs / 6;

  sendStart(output);

  let stepIndex = 0;
  let clockCount = 0;
  let lastClock = performance.now();
  let lastStep = performance.now();
  let animFrame: number;

  const tick = (now: number) => {
    if (stopped) return;

    // MIDI clock pulses
    while (now - lastClock >= clockIntervalMs) {
      sendClock(output);
      lastClock += clockIntervalMs;
      clockCount++;
    }

    // Step triggers (every 6 clock pulses = one 16th note)
    while (now - lastStep >= sixteenthMs && stepIndex < steps.length) {
      const step = steps[stepIndex];
      if (step.active) {
        sendNoteOn(output, ch, step.note, step.velocity);
        const noteOffAt = lastStep + sixteenthMs * 0.9;
        const noteOffDelay = noteOffAt - performance.now();
        if (noteOffDelay > 0) {
          setTimeout(() => sendNoteOff(output, ch, step.note), noteOffDelay);
        } else {
          sendNoteOff(output, ch, step.note);
        }
      }
      onStep?.(stepIndex);
      lastStep += sixteenthMs;
      stepIndex++;
    }

    if (stepIndex >= steps.length) {
      sendStop(output);
      return;
    }

    animFrame = requestAnimationFrame(tick);
  };

  animFrame = requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(animFrame);
      sendStop(output);
    },
  };
}
