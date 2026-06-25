# VELODROME

Turn your Strava rides into music. VELODROME converts Strava export files
(**FIT**, **GPX**, **TCX**) into downloadable **MIDI** files — mapping elevation
to pitch, speed to tempo, and cadence to rhythm — and can send the result
straight to an **Elektron Digitakt 2** over Web MIDI.

This is a 100% browser-based React + Vite app. No server, no accounts, no data
ever leaves your machine.

## Requirements

- **Node.js 20.11 or newer** (check with `node -v`)
- A modern browser. For the Digitakt 2 / Web MIDI features specifically, use
  **Chrome or Edge** — Firefox and Safari don't support the Web MIDI API.

## Getting started

```bash
npm install
npm run dev
```

Vite will print a local URL (default http://localhost:5173) and open it
automatically. Drop in a `.fit`, `.gpx`, or `.tcx` file — or click
**"load a sample ride"** to try it instantly.

## Available scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run the TypeScript compiler (no emit) |

## Using the app

1. **Upload** a Strava export (or load the sample ride).
2. Review the detected sensors and tweak the **Synthesizer Config** (key, scale,
   tempo range, rhythmic sensitivity).
3. Click **Generate MIDI**.
4. **Export MIDI** to download the `.mid` file, or use the **Send to Digitakt 2**
   panel below it.

### Sending to a Digitakt 2

The **Send to Digitakt 2** panel has two modes:

- **Write via SysEx** — writes a pattern directly to the DT2 sequencer.
- **Live Playback** — plays the steps in real time (put the DT2 in Live
  Recording mode to capture them), sending MIDI clock so it stays in sync.

Connect your Digitakt 2 over USB, click **Connect MIDI Device**, pick it from the
dropdown, choose your step count / track / channel, and send.

> **Note on SysEx:** the Digitakt 2 SysEx format used here is based on
> community-documented reverse engineering of Elektron's protocol. The device ID
> defaults to `0x12` but is configurable in the UI — if writes don't land,
> try adjacent IDs and verify against your firmware version.

## Tech stack

React 19 · Vite 7 · TypeScript · Tailwind CSS v4 · shadcn/ui · @tonejs/midi ·
fit-file-parser · Web MIDI API

## Project structure

```
src/
  components/        UI components (incl. DigitaktPanel, UploadZone, charts)
  components/ui/     shadcn/ui primitives
  lib/
    midi/            MIDI conversion, Digitakt SysEx, Web MIDI, segmenter
    parsers/         FIT / GPX / TCX parsers
    normalize.ts     Normalizes parsed rides into a common shape
    sampleRide.ts    Synthetic sample ride generator
  pages/             Home page
```
