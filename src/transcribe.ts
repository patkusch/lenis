// Wavelength — free, on-device speech-to-text via the Web Speech API.
//
// This is the key-free stand-in for a cloud transcription service: Chrome (and
// Edge) expose SpeechRecognition, which turns the check-in into text locally.
// Where it isn't supported (Firefox, some Safari), we simply get no words and
// the coach falls back to the vocal signal alone — the app never breaks.

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

export class Transcriber {
  readonly supported: boolean;
  private rec: SpeechRecognitionLike | null = null;
  private finalText = "";
  private interimText = "";
  /** interim + final text, streamed as the user speaks */
  onText?: (live: string) => void;

  constructor() {
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;
    this.supported = !!Ctor;
    if (Ctor) {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) this.finalText += r[0].transcript + " ";
          else interim += r[0].transcript;
        }
        this.interimText = interim; // keep the latest un-finalized words
        this.onText?.((this.finalText + interim).trim());
      };
      rec.onerror = () => {};
      this.rec = rec;
    }
  }

  start(): void {
    this.finalText = "";
    this.interimText = "";
    try {
      this.rec?.start();
    } catch {
      /* already started / not allowed — fine */
    }
  }

  /** Stops recognition and returns the transcript. Falls back to the latest
   *  interim words when nothing was finalized (common on short check-ins). */
  stop(): string {
    try {
      this.rec?.stop();
    } catch {
      /* not running — fine */
    }
    return (this.finalText + " " + this.interimText).trim();
  }
}
