import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

const CREEPSTER = "'Creepster', cursive";

interface Step {
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Export a ride",
    body: (
      <>
        Grab a GPS file from Strava (<span className="text-primary">Export Original</span> on
        any activity) or any bike computer. VELODROME reads{" "}
        <span className="text-primary">.FIT</span>, <span className="text-primary">.GPX</span>,
        and <span className="text-primary">.TCX</span>.
      </>
    ),
  },
  {
    title: "Upload it",
    body: (
      <>
        Drop the file on the upload zone — or hit{" "}
        <span className="text-primary">load a sample ride</span> to try it with no file at all.
        Everything is parsed in your browser; nothing is uploaded anywhere.
      </>
    ),
  },
  {
    title: "Tune the synth config",
    body: (
      <>
        Pick a <span className="text-primary">key &amp; mode</span>, set the{" "}
        <span className="text-primary">tempo range</span>, and dial{" "}
        <span className="text-primary">rhythmic sensitivity</span>. These shape how the ride's
        telemetry maps onto notes.
      </>
    ),
  },
  {
    title: "Generate MIDI",
    body: (
      <>
        VELODROME maps <span className="text-primary">elevation → pitch</span>,{" "}
        <span className="text-primary">speed → tempo</span>, and{" "}
        <span className="text-primary">cadence → rhythm</span>, then renders a sequence from the
        whole ride.
      </>
    ),
  },
  {
    title: "Export or play it",
    body: (
      <>
        Download a standard <span className="text-primary">.mid</span> file for any DAW — or send
        it straight to an <span className="text-primary">Elektron Digitakt 2</span> over Web MIDI
        (see the hardware setup steps in the Digitakt panel).
      </>
    ),
  },
];

export function GuideDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          data-testid="button-guide"
          className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors border border-border/60 hover:border-primary/50 px-3 py-1.5"
        >
          [ GUIDE ]
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg md:max-w-2xl max-h-[85vh] overflow-y-auto rounded-none border-primary/30 bg-card">
        <DialogHeader>
          <DialogTitle asChild>
            <h2
              className="text-4xl text-primary drop-shadow-[0_0_8px_rgba(170,255,0,0.3)]"
              style={{ fontFamily: CREEPSTER, letterSpacing: "0.04em" }}
            >
              How It Works
            </h2>
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            Turn a bike ride into a MIDI sequence — 100% in your browser, no accounts, no uploads.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-5 pt-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                className="shrink-0 font-mono text-lg text-primary tabular-nums leading-none pt-0.5"
                aria-hidden="true"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="space-y-1">
                <div className="font-mono text-sm uppercase tracking-widest text-foreground">
                  {step.title}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-2 border-t border-border/50 pt-4 font-mono text-xs text-muted-foreground leading-relaxed">
          <span className="text-primary">NOTE:</span> the Digitakt / Web MIDI features need a
          Chromium browser (<span className="text-primary">Chrome</span> or{" "}
          <span className="text-primary">Edge</span>). Firefox and Safari don't support Web MIDI.
        </div>
      </DialogContent>
    </Dialog>
  );
}
