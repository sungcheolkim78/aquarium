/**
 * Minimal healing UI (SPEC F5, §6.4).
 *
 * Three elements only: a loading indicator, the title, and an ambient-sound
 * toggle. The audio graph is synthesised (filtered pink noise, no assets) and
 * the `AudioContext` is constructed only inside the user's click handler, so
 * the page never fights browser autoplay policy — sound starts muted.
 */

const SPEAKER_ON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z" />
  <path d="M15.2 8.6a4.6 4.6 0 0 1 0 6.8" />
  <path d="M17.8 6a8 8 0 0 1 0 12" />
</svg>`;

const SPEAKER_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z" />
  <path d="M15.5 9.5l5 5" />
  <path d="M20.5 9.5l-5 5" />
</svg>`;

const GEAR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="3.2" />
  <path d="M12 3.5v2.1M12 18.4v2.1M4.9 6.3l1.5 1.5M17.6 16.2l1.5 1.5M3.5 12h2.1M18.4 12h2.1M4.9 17.7l1.5-1.5M17.6 7.8l1.5-1.5" />
</svg>`;

/** Procedural ocean-ish ambience: looped pink noise under a swaying lowpass. */
class AmbientAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private playing = false;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Must be called from a user gesture. Returns the new playing state. */
  async toggle(): Promise<boolean> {
    if (this.playing) {
      await this.stop();
      return false;
    }
    await this.start();
    return this.playing;
  }

  private async start(): Promise<void> {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const context = this.context ?? new AudioContext();
    this.context = context;
    if (context.state === "suspended") await context.resume();

    if (this.gain === null) this.buildGraph(context);
    const gain = this.gain;
    if (gain === null) return;

    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 2.5);
    this.playing = true;
  }

  private async stop(): Promise<void> {
    const context = this.context;
    const gain = this.gain;
    this.playing = false;
    if (context === null || gain === null) return;

    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    const fadeSeconds = 1.2;
    gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);

    await new Promise<void>((resolve) => {
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        resolve();
      }, fadeSeconds * 1000);
    });
    if (this.playing) return; // `start()` ran again during the fade — stay playing, don't suspend
    await context.suspend();
  }

  private buildGraph(context: AudioContext): void {
    const seconds = 6;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    // Paul Kellet's pink-noise approximation: softer than white, reads as surf.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.7;

    const swell = context.createGain();
    swell.gain.value = 130;

    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.05;
    lfo.connect(swell).connect(filter.frequency);

    const gain = context.createGain();
    gain.gain.value = 0;

    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    lfo.start();

    this.source = source;
    this.lfo = lfo;
    this.gain = gain;
  }

  dispose(): void {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.source?.stop();
    this.lfo?.stop();
    void this.context?.close();
    this.source = null;
    this.lfo = null;
    this.gain = null;
    this.context = null;
    this.playing = false;
  }
}

/** Handle returned to the bootstrap code. */
export interface AquariumUi {
  /** Fade the loading indicator out once the first frame has rendered. */
  finishLoading(): void;
  dispose(): void;
}

export interface CreateUiOptions {
  /** The settings panel's root element (SPEC F6, §6.5.1); the gear button toggles its visibility. */
  readonly settingsPanel?: HTMLElement;
}

/** Build the overlay UI inside `root`. */
export function createUi(root: HTMLElement, options: CreateUiOptions = {}): AquariumUi {
  root.textContent = "";
  root.classList.add("overlay");

  const loader = document.createElement("div");
  loader.className = "loader";
  const spinner = document.createElement("div");
  spinner.className = "loader__ring";
  const loaderText = document.createElement("p");
  loaderText.className = "loader__text";
  loaderText.textContent = "아쿠아리움을 채우는 중";
  loader.append(spinner, loaderText);

  const title = document.createElement("h1");
  title.className = "title";
  title.textContent = "고요한 아쿠아리움";

  const audio = new AmbientAudio();
  const soundButton = document.createElement("button");
  soundButton.type = "button";
  soundButton.className = "sound-toggle";
  soundButton.innerHTML = SPEAKER_OFF;
  soundButton.setAttribute("aria-label", "앰비언트 사운드 켜기");
  soundButton.setAttribute("aria-pressed", "false");
  soundButton.title = "앰비언트 사운드";

  let predictedPlaying = audio.isPlaying;
  let toggleQueue: Promise<void> = Promise.resolve();

  const applySoundButtonState = (playing: boolean): void => {
    soundButton.innerHTML = playing ? SPEAKER_ON : SPEAKER_OFF;
    soundButton.classList.toggle("is-on", playing);
    soundButton.setAttribute("aria-pressed", playing ? "true" : "false");
    soundButton.setAttribute(
      "aria-label",
      playing ? "앰비언트 사운드 끄기" : "앰비언트 사운드 켜기",
    );
  };

  const onToggle = (): void => {
    predictedPlaying = !predictedPlaying;
    applySoundButtonState(predictedPlaying);

    toggleQueue = toggleQueue
      .then(() => audio.toggle())
      .then((playing) => {
        predictedPlaying = playing;
        applySoundButtonState(playing);
      })
      .catch(() => {
        predictedPlaying = false;
        soundButton.innerHTML = SPEAKER_OFF;
        soundButton.classList.remove("is-on");
        soundButton.setAttribute("aria-pressed", "false");
        soundButton.setAttribute("aria-label", "앰비언트 사운드를 사용할 수 없습니다");
      });
  };
  soundButton.addEventListener("click", onToggle);

  const controls = document.createElement("div");
  controls.className = "controls";
  controls.append(soundButton);

  const settingsPanel = options.settingsPanel ?? null;
  let settingsButton: HTMLButtonElement | null = null;
  let onSettingsToggle: (() => void) | null = null;

  if (settingsPanel !== null) {
    settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "settings-toggle";
    settingsButton.innerHTML = GEAR_ICON;
    settingsButton.setAttribute("aria-label", "설정 열기");
    settingsButton.setAttribute("aria-expanded", "false");
    settingsButton.title = "설정";

    onSettingsToggle = (): void => {
      const open = settingsPanel.classList.toggle("is-open");
      settingsButton?.setAttribute("aria-expanded", open ? "true" : "false");
      settingsButton?.setAttribute("aria-label", open ? "설정 닫기" : "설정 열기");
    };
    settingsButton.addEventListener("click", onSettingsToggle);
    controls.append(settingsButton);
    root.append(settingsPanel);
  }

  root.append(loader, title, controls);

  return {
    finishLoading(): void {
      if (loader.classList.contains("is-hidden")) return;
      loader.classList.add("is-hidden");
      root.classList.add("is-ready");
      window.setTimeout(() => loader.remove(), 900);
    },
    dispose(): void {
      soundButton.removeEventListener("click", onToggle);
      if (settingsButton !== null && onSettingsToggle !== null) {
        settingsButton.removeEventListener("click", onSettingsToggle);
      }
      audio.dispose();
      root.textContent = "";
    },
  };
}
