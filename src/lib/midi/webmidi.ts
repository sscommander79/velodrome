export interface MidiDevice {
  id: string;
  name: string;
  output: MIDIOutput;
}

export async function requestMidiAccess(): Promise<MIDIAccess | null> {
  if (!navigator.requestMIDIAccess) return null;
  try {
    return await navigator.requestMIDIAccess({ sysex: true });
  } catch {
    return null;
  }
}

export function getOutputDevices(access: MIDIAccess): MidiDevice[] {
  const devices: MidiDevice[] = [];
  access.outputs.forEach((output) => {
    devices.push({ id: output.id, name: output.name ?? output.id, output });
  });
  return devices;
}

export function sendNoteOn(output: MIDIOutput, channel: number, note: number, velocity: number) {
  const ch = (channel - 1) & 0x0f;
  output.send([0x90 | ch, note & 0x7f, velocity & 0x7f]);
}

export function sendNoteOff(output: MIDIOutput, channel: number, note: number) {
  const ch = (channel - 1) & 0x0f;
  output.send([0x80 | ch, note & 0x7f, 0x00]);
}

export function sendClock(output: MIDIOutput) {
  output.send([0xf8]);
}

export function sendStart(output: MIDIOutput) {
  output.send([0xfa]);
}

export function sendStop(output: MIDIOutput) {
  output.send([0xfc]);
}

export function sendSysEx(output: MIDIOutput, data: number[]) {
  output.send([0xf0, ...data, 0xf7]);
}

export function isSysExSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

export function isBrowserSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}
