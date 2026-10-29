import { describe, expect, test } from "bun:test";
import { KEYBOARD_QUIET_MS, KEYBOARD_SETTLE_MS, type KeyboardClock, type KeyboardControlState, KeyboardControlStore, keyboardControlStep, keyboardControlView } from "./keyboardControl.ts";

/** A clock the tests drive by hand: `goto` moves time, `fire` runs the armed settle timer, `live` names them. */
const clockRig = (): { clock: KeyboardClock; goto: (at: number) => void; fire: () => void; live: () => number[] } => {
  let at = 0;
  const timers = new Map<number, { run: () => void; ms: number }>();
  const fake: KeyboardClock = {
    now: () => at,
    set: (run, ms) => { const id = timers.size + 1; timers.set(id, { run, ms }); return id; },
    clear: (id) => { timers.delete(id); },
  };
  return {
    clock: fake,
    goto: (value) => { at = value; },
    fire: () => { for (const timer of [...timers.values()]) timer.run(); timers.clear(); },
    live: () => [...timers.values()].map((timer) => timer.ms),
  };
};

const atRest = (measured: boolean): KeyboardControlState => ({ measured, intent: null, changedAt: 0 });
const pressing = (state: KeyboardControlState, action: "show" | "hide", at = 0): KeyboardControlState =>
  keyboardControlStep(state, { type: "press", action, at });
/** The store's derived pair, deep-comparable. */
const says = (store: KeyboardControlStore): [string, boolean] => [store.view().direction, store.view().pending];

describe("keyboardControlStep", () => {
  test("the measurement decides at rest: up is a hide, down is a show", () => {
    expect(keyboardControlView(atRest(false))).toEqual({ direction: "show", pending: false });
    expect(keyboardControlView(atRest(true))).toEqual({ direction: "hide", pending: false });
  });

  test("a tap is the wanted truth at once, whichever way the measurement points", () => {
    expect(keyboardControlView(pressing(atRest(false), "show"))).toEqual({ direction: "hide", pending: true });
    expect(keyboardControlView(pressing(atRest(true), "hide"))).toEqual({ direction: "show", pending: true });
  });

  test("the last tap wins, and the settle window hands the decision back to the measurement", () => {
    // an intent replaces another one; an unconfirmed intent expires into the measurement
    const swapped = pressing(pressing(atRest(true), "show", 10), "hide", 5_000);
    expect(keyboardControlView(swapped)).toEqual({ direction: "show", pending: true });
    expect(keyboardControlView(keyboardControlStep(swapped, { type: "settle", at: 5_600 })))
      .toEqual({ direction: "hide", pending: false });
  });

  test("a measurement the intent disagrees with leaves it alone, however much it stumbles", () => {
    // a hide whose blur leaves the window occluded mid-animation: the control keeps the tap's word
    let state = keyboardControlStep({ ...atRest(true), intent: "hide" }, { type: "measure", up: true, at: 1_000 });
    expect(state.intent).toBe("hide");
    state = keyboardControlStep({ ...atRest(true), intent: "hide" }, { type: "measure", up: false, at: 1_100 });
    expect(state.intent).toBe("hide");
    // the blur's hidden state keeps the word too: only the quiet hold or the settle clears it
    state = keyboardControlStep({ ...atRest(true), intent: "hide" }, { type: "hidden", at: 1_200 });
    expect(state).toEqual({ measured: false, intent: "hide", changedAt: 1_200 });
    expect(keyboardControlView(state)).toEqual({ direction: "show", pending: true });
  });
});

describe("keyboardControlStore", () => {
  test("a show sits pending until the measurement answers, and expires if it never does", () => {
    const { clock, goto, fire, live } = clockRig();
    const store = new KeyboardControlStore(clock);
    expect(store.press({ refused: false, hideTarget: true, showTarget: true })).toBe("show");
    expect(says(store)).toEqual(["hide", true]);
    expect(live()).toEqual([KEYBOARD_SETTLE_MS]); // armed with the settle window, its one timer
    goto(KEYBOARD_SETTLE_MS + 1);
    fire();
    expect(says(store)).toEqual(["show", false]);
    expect(live()).toEqual([]);
  });

  test("a locally confirmed hide stands through a mid-animation measurement, and the window ends it when the measurement never agrees", () => {
    // regression: the blur says the keyboard is going, but the viewport's own focusout sync still
    // measures the hiding animation: the control must not arm back over a keyboard going down
    const { clock, goto, fire, live } = clockRig();
    const store = new KeyboardControlStore(clock);
    store.measure(true);
    store.press({ refused: false, hideTarget: true, showTarget: true });
    store.settled("hide", true);
    goto(KEYBOARD_SETTLE_MS);
    store.measure(true); // the occlusion the animation still reports
    expect(says(store)).toEqual(["show", true]);
    goto(KEYBOARD_SETTLE_MS + 1);
    fire(); // the window runs out: the measurement rules again, mid-animation value and all
    expect(says(store)).toEqual(["hide", false]); // the documented cost: a blind edition reads Hide over a keyboard gone
    expect(live()).toEqual([]);
  });

  test("a settled hide with a field still focused records nothing: the word stands for the measurement", () => {
    const { clock, goto } = clockRig();
    const store = new KeyboardControlStore(clock);
    store.measure(true);
    store.press({ refused: false, hideTarget: true, showTarget: true });
    store.settled("hide", false);
    expect(says(store)).toEqual(["show", true]);
    goto(KEYBOARD_QUIET_MS * 2);
    store.measure(false); // the keyboard goes at the animation's end
    expect(says(store)).toEqual(["show", true]);
    goto(KEYBOARD_QUIET_MS * 4);
    store.measure(false); // still down: confirmed
    expect(says(store)).toEqual(["show", false]);
  });

  test("a show's onFocus is never evidence (a hardware keyboard leaves a field focused too)", () => {
    const { clock, goto, fire, live } = clockRig();
    const store = new KeyboardControlStore(clock);
    store.press({ refused: false, hideTarget: true, showTarget: true });
    store.settled("show", false);
    expect(says(store)).toEqual(["hide", true]);
    goto(KEYBOARD_SETTLE_MS + 1); // a focus the field gained never confirms it: the window runs out
    fire();
    expect(says(store)).toEqual(["show", false]);
    expect(live()).toEqual([]);
  });

  test("a composition, a pending commit or a paste refuses the tap, recording nothing and arming nothing", () => {
    const { clock, live } = clockRig();
    const store = new KeyboardControlStore(clock);
    store.measure(true);
    expect(store.press({ refused: true, hideTarget: true, showTarget: true })).toBe("refuse");
    expect(says(store)).toEqual(["hide", false]);
    expect(live()).toEqual([]);
  });

  test("no target for the tap says so and records nothing (a Hide while another pane owns the keyboard)", () => {
    const { clock, live } = clockRig();
    const store = new KeyboardControlStore(clock);
    store.measure(true);
    expect(store.press({ refused: false, hideTarget: false, showTarget: true })).toBe("none");
    expect(says(store)).toEqual(["hide", false]);
    const { clock: downClock } = clockRig();
    const downStore = new KeyboardControlStore(downClock);
    expect(downStore.press({ refused: false, hideTarget: true, showTarget: false })).toBe("none");
    expect(says(downStore)).toEqual(["show", false]);
    expect(live()).toEqual([]);
  });

  test("a show confirms only once the measured up has held still for the quiet window", () => {
    const { clock, goto } = clockRig();
    const store = new KeyboardControlStore(clock);
    store.press({ refused: false, hideTarget: true, showTarget: true });
    goto(10);
    store.measure(true);
    expect(says(store)).toEqual(["hide", true]); // 10 - 10 < KEYBOARD_QUIET_MS: still in flight
    goto(10 + KEYBOARD_QUIET_MS);
    store.measure(true);
    expect(says(store)).toEqual(["hide", false]); // the same value, held: confirmed
  });

  test("the overshoot inside a hide does not flap the control: the quiet window rides it out", () => {
    const { clock, goto } = clockRig();
    const store = new KeyboardControlStore(clock);
    goto(1);
    store.measure(true);
    store.press({ refused: false, hideTarget: true, showTarget: true });
    expect(says(store)).toEqual(["show", true]);
    goto(50);
    store.measure(true); // still occluded mid-slide: agrees with nothing, changes nothing
    expect(says(store)).toEqual(["show", true]);
    goto(60);
    store.measure(false); // first down: too fresh to confirm the tap
    expect(says(store)).toEqual(["show", true]);
    goto(120);
    store.measure(true); // Chromium's overshoot, and back
    expect(says(store)).toEqual(["show", true]);
    goto(130);
    store.measure(false);
    expect(says(store)).toEqual(["show", true]); // the new down is fresh too
    goto(130 + KEYBOARD_QUIET_MS);
    store.measure(false); // held still through the overshoot: the tap is done
    expect(says(store)).toEqual(["show", false]);
  });

  test("view() returns the same object until what it derives changes, and the stop leaves nothing notified", () => {
    const { clock } = clockRig();
    const store = new KeyboardControlStore(clock);
    const first = store.view();
    expect(first).toEqual({ direction: "show", pending: false });
    let notifications = 0;
    const stop = store.subscribe(() => { notifications++; });
    store.measure(true);
    const second = store.view();
    expect(second).not.toBe(first);
    expect(store.view()).toBe(second);
    store.measure(true);
    expect(store.view()).toBe(second);
    expect(notifications).toBe(1); // no change, no notice: useSyncExternalStore would loop
    stop();
    store.measure(false);
    expect(store.view()).toEqual({ direction: "show", pending: false });
    expect(notifications).toBe(1); // the stop: a remounting subscriber never leaks
  });

  test("one armed timer a tap: the last tap replaces the armed one, and a blur leaves the window armed", () => {
    const { clock, goto, fire, live } = clockRig();
    const store = new KeyboardControlStore(clock);
    store.measure(true);
    store.press({ refused: false, hideTarget: true, showTarget: true });
    store.press({ refused: false, hideTarget: true, showTarget: true }); // last tap wins, one timer
    expect(live()).toEqual([KEYBOARD_SETTLE_MS]);
    store.settled("hide", true); // the blur's confirmation does not clear the window: it still bounds the word
    expect(live()).toEqual([KEYBOARD_SETTLE_MS]);
    goto(KEYBOARD_SETTLE_MS);
    fire();
    expect(live()).toEqual([]);
    expect(says(store)).toEqual(["show", false]);
  });
});
