// Keyboard and pointer input. Held keys give movement and driving; one-shot presses
// (confirm, pause, enter/exit, repair, radio, garage) are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and never
// counted twice. The mouse gives the weapon aim and wheel clicks; a tap confirms.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_REPAIR = 8;
export const ACTION_RADIO = 16;
export const ACTION_GARAGE = 32;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const REPAIR = new Set(['KeyR']);
const RADIO = new Set(['KeyV']);
const WHEEL = new Set(['KeyQ']);
const WEAPON_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 };
const CREW_KEYS = { Digit4: 0, Digit5: 1, Digit6: 2 };

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  let weaponSelect = null;
  let crewSelect = null;
  let wheelHeld = false;
  let firing = false;
  const mouse = { x: 0, y: 0, down: false, clicked: false };

  function onKeyDown(event) {
    held.add(event.code);
    if (event.code in WEAPON_KEYS && !event.repeat) weaponSelect = WEAPON_KEYS[event.code];
    if (event.code in CREW_KEYS && !event.repeat) crewSelect = CREW_KEYS[event.code];
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (REPAIR.has(event.code)) {
      if (!event.repeat) actions |= ACTION_REPAIR;
    } else if (RADIO.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RADIO;
    } else if (WHEEL.has(event.code)) {
      wheelHeld = true;
    } else return;
    event.preventDefault();
  }

  function onKeyUp(event) {
    held.delete(event.code);
    if (WHEEL.has(event.code)) wheelHeld = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    wheelHeld = false;
    firing = false;
  });
  target.addEventListener('pointerdown', (event) => {
    const rect = target.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
    mouse.down = true;
    mouse.clicked = true;
    firing = true;
    actions |= ACTION_CONFIRM;
  });
  target.addEventListener('pointerup', () => {
    mouse.down = false;
    firing = false;
  });
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  });
  target.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    mouse,
    /** On-foot movement vector, -1..1 on each axis (0 when driving: use driving()). */
    move() {
      const up = [...held].some((c) => UP.has(c));
      const down = [...held].some((c) => DOWN.has(c));
      const left = [...held].some((c) => LEFT.has(c));
      const right = [...held].some((c) => RIGHT.has(c));
      return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
    },
    /** Driving: {accel, brake, steer, handbrake} from the held keys. */
    driving() {
      const up = [...held].some((c) => UP.has(c));
      const down = [...held].some((c) => DOWN.has(c));
      const left = [...held].some((c) => LEFT.has(c));
      const right = [...held].some((c) => RIGHT.has(c));
      return {
        accel: up,
        brake: down,
        steer: (right ? 1 : 0) - (left ? 1 : 0),
        handbrake: held.has('Space') && !held.has('Enter'),
      };
    },
    isWheelHeld() {
      return wheelHeld;
    },
    isFiring() {
      return firing || held.has('KeyF');
    },
    /** The weapon number pressed since the last call (0..4), or null. */
    takeWeaponSelect() {
      const w = weaponSelect;
      weaponSelect = null;
      return w;
    },
    /** The crew member pressed since the last call (0..2 for keys 4/5/6), or null. */
    takeCrewSelect() {
      const c = crewSelect;
      crewSelect = null;
      return c;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    takeClick() {
      const c = mouse.clicked;
      mouse.clicked = false;
      return c;
    },
  };
}
