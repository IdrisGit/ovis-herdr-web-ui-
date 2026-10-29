/*
 * The key bar's keyboard control (#1046): what its label says, and what its tap does, from both
 * the tap's word and the keyboard lib/viewport.ts measured, never from one alone.
 *
 * A tap is an event; data-keyboard is a value in flight while a phone's keyboard slides, and
 * Chromium's geometry overshoots the resting height with no signal for the settled value. Deciding
 * a tap from the measurement alone put the tap on whichever side of the animation the last event
 * landed: Hide ran as Show, the open control stayed armed over a keyboard visibly up, and Show
 * after Android's back gesture focused a field that was already focused, which raises nothing.
 *
 * So this store keeps the tap's `intent` until the measurement confirms it (and holds still) or the
 * settle window runs out, and keeps `measured` alongside. The one derivation, keyboardControlView,
 * is what the label, the glyph, aria-pressed and the next tap's action all read. A hide confirmed
 * locally (its blur left no typing field focused) is evidence the measurement cannot give, for a
 * browser it is blind in: a zoomed page, a floating keyboard.
 */

/** What a tap asks for, and what the control's next tap will do. */
export type KeyboardDirection = "show" | "hide";

/**
 * The longest a tap's intent outlives its gesture without a confirming measurement — or a locally
 * confirmed hide stands after it: above the keyboard's slide, so a mid-animation value can never
 * take a tap back. Its cost is only a stale label on a tap that did nothing, which then falls back
 * to the measurement.
 */
export const KEYBOARD_SETTLE_MS = 700;

/**
 * How still the measured value must be before a change of it is trusted. Chromium's geometry
 * overshoot means a value that agrees with the intent once can disagree on the next event; one
 * quiet spell of this length is the cheapest honest "it stopped moving" this platform offers.
 */
export const KEYBOARD_QUIET_MS = 120;

export interface KeyboardControlState {
  /** the last measurement, or a local hidden confirmation, of the keyboard */
  measured: boolean;
  /** the tap in flight: what the keyboard is on its way to, the word that holds the control */
  intent: KeyboardDirection | null;
  /** when `measured` last changed value (not when it was last read) */
  changedAt: number;
}

export interface KeyboardControlView {
  /** what the label, the glyph and the next tap's action all say */
  direction: KeyboardDirection;
  /** a tap is in flight: the intent, not the direction, is where the keyboard is heading */
  pending: boolean;
}

export type KeyboardControlEvent =
  | { type: "measure"; up: boolean; at: number }
  | { type: "press"; action: KeyboardDirection; at: number }
  /** the tap's settle window ended: the measurement takes over whatever it says */
  | { type: "settle"; at: number }
  /** the tap's blur left no typing field focused anywhere: the keyboard is going */
  | { type: "hidden"; at: number };

/** The measured value that would confirm an intent: a show waits for the keyboard up. */
const wants = (intent: KeyboardDirection): boolean => intent === "show";

/**
 * One step of the machine, free of DOM and clock. A measurement clears an intent it agrees with
 * only after the agreeable value has held still; a tap replaces the intent, last tap wins; a
 * settle window catches what the measurement never confirmed; a hidden state is a dismissal seen
 * at the focus, where a measurement can be blind.
 */
export function keyboardControlStep(state: KeyboardControlState, event: KeyboardControlEvent): KeyboardControlState {
  switch (event.type) {
    case "measure":
      {
        // a hide that reads down mid-flight while the keyboard animates back up (the overshoot) must
        // not flip the control twice; the change counts from the value's arrival, not from the read
        const changedAt = state.measured === event.up ? state.changedAt : event.at;
        const confirmed = state.intent !== null && event.up === wants(state.intent) && event.at - changedAt >= KEYBOARD_QUIET_MS;
        return { measured: event.up, changedAt, intent: confirmed ? null : state.intent };
      }
    case "press":
      // one intent at a time, the last tap's: a double tap cannot queue two moves
      return { ...state, intent: event.action };
    case "settle":
      return { ...state, intent: null };
    case "hidden": // the blur says the keyboard is going; the tap's word stands till it settles or confirms
      return { measured: false, changedAt: state.measured ? event.at : state.changedAt, intent: state.intent };
  }
}

/** The one derivation: the label, the glyph, aria-pressed and the action all come from here. */
export function keyboardControlView(state: KeyboardControlState): KeyboardControlView {
  const direction = state.intent === null
    ? state.measured ? "hide" : "show"
    // a show in flight is a keyboard on its way up: the next tap puts it away, and the label says so now
    : state.intent === "show" ? "hide" : "show";
  return { direction, pending: state.intent !== null };
}

/** What the tap must do, or that it does nothing ("none") or is refused outright. */
export type KeyboardPress = KeyboardDirection | "refuse" | "none";

/** What the store takes to know about the pane, read at the tap. */
export interface KeyboardTap {
  /** a composition or a commit on its way (the bar's paste refusal blocks a tap before it gets here) */
  refused: boolean;
  /** a field of this pane that Hide may blur has the focus (else Hide has nothing to do here) */
  hideTarget: boolean;
  /** this pane has a field Show may focus (else the control is disabled and never gets here) */
  showTarget: boolean;
}

/** The time this store lives by, injected so a test drives it without fake timers. */
export interface KeyboardClock {
  now(): number;
  set(handler: () => void, ms: number): number;
  clear(handle: number): void;
}

const defaultClock: KeyboardClock = {
  now: () => performance.now(),
  set: (handler, ms) => window.setTimeout(handler, ms),
  clear: (handle) => window.clearTimeout(handle),
};

export class KeyboardControlStore {
  readonly clock: KeyboardClock;
  private state: KeyboardControlState = { measured: false, intent: null, changedAt: 0 };
  private derived = keyboardControlView(this.state);
  private listeners = new Set<() => void>();
  private timer: number | null = null;

  constructor(clock: KeyboardClock = defaultClock) {
    this.clock = clock;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The same object until what it derives changes: useSyncExternalStore's getSnapshot. */
  view = (): KeyboardControlView => this.derived;

  /** lib/viewport.ts, on every sync: the value and the fact that the measurement moved at all. */
  measure = (up: boolean): void => this.apply({ type: "measure", up, at: this.clock.now() });

  /**
   * The tap: refuse it in place before any state changes (nothing runs later), and a tap with no
   * target of this pane says so, recording nothing.
   */
  press = (tap: KeyboardTap): KeyboardPress => {
    if (tap.refused) return "refuse";
    const action = this.derived.direction;
    if (action === "hide" ? !tap.hideTarget : !tap.showTarget) return "none";
    this.apply({ type: "press", action, at: this.clock.now() });
    this.arm();
    return action;
  };

  /**
   * The pane performed the tap. A blur that leaves no typing field focused anywhere is the keyboard
   * going — every phone dismisses it on the blur, evidence a blind measurement cannot give. The
   * tap's word then stands through the animation the measurement still reports: only a still-quiet
   * measure or the settle window clears it. A focus is never evidence the other way, which is why
   * only "hide" confirms here.
   */
  settled = (action: KeyboardDirection, noFieldFocused: boolean): void => {
    if (action !== "hide" || !noFieldFocused) return;
    this.apply({ type: "hidden", at: this.clock.now() });
  };

  private apply(event: KeyboardControlEvent): void {
    const state = keyboardControlStep(this.state, event);
    const derived = keyboardControlView(state);
    this.state = state;
    if (derived.direction === this.derived.direction && derived.pending === this.derived.pending) return;
    this.derived = derived;
    for (const listener of this.listeners) listener();
  }

  private arm(): void {
    this.cancel();
    this.timer = this.clock.set(() => { this.timer = null; this.apply({ type: "settle", at: this.clock.now() }); }, KEYBOARD_SETTLE_MS);
  }

  private cancel(): void {
    if (this.timer === null) return;
    this.clock.clear(this.timer);
    this.timer = null;
  }
}

export const keyboardControl = new KeyboardControlStore();
