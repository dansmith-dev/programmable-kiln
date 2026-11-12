// Formatting, colours and program maths shared by the components.

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return m + "m";
  return h + "h " + String(m).padStart(2, "0") + "m";
}

export const fmtMins = (mins) => fmtDuration(mins * 60);

// Approximate colour of glowing ceramic at a temperature
const COLOUR_STOPS = [
  [0, [96, 112, 140]], [300, [120, 100, 110]], [500, [110, 30, 24]], [650, [178, 32, 22]],
  [800, [232, 70, 20]], [950, [255, 128, 32]], [1100, [255, 190, 70]], [1250, [255, 232, 160]], [1400, [255, 248, 230]],
];

export function tempColor(t) {
  let rgb = COLOUR_STOPS[COLOUR_STOPS.length - 1][1];
  if (t <= COLOUR_STOPS[0][0]) rgb = COLOUR_STOPS[0][1];
  else {
    for (let i = 1; i < COLOUR_STOPS.length; i++) {
      const [t1, c1] = COLOUR_STOPS[i];
      if (t <= t1) {
        const [t0, c0] = COLOUR_STOPS[i - 1];
        const f = (t - t0) / (t1 - t0);
        rgb = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
        break;
      }
    }
  }
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// ---------- Program ----------

export const parseProgram = (p) => ({ version: p.version, steps: p.steps.map(([type, temp, mins]) => ({ type, temp, mins })) });

export const totalMins = (steps) => steps.reduce((a, s) => a + (Number(s.mins) || 0), 0);

export const peakTemp = (steps) => steps.reduce((a, s) => Math.max(a, Number(s.temp) || 0), 0);
