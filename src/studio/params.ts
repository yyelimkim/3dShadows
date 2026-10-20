/** Every control in the Color + Scan studio, plus presets derived from references/Mood. */

export type StudioParams = {
  // Shadow
  lightSize: number;
  softness: number;
  /** Shared by both studios: how much light thin petals/leaves pass, and vein visibility. */
  translucency: number;
  veinDetail: number;
  // Color
  paper: string;
  rampLight: string;
  rampMid: string;
  rampDeep: string;
  midPosition: number;
  density: number;
  hue: number;
  saturation: number;
  brightness: number;
  contrast: number;
  gamma: number;
  blackPoint: number;
  whitePoint: number;
  temperature: number;
  tint: number;
  // Ephemeral
  extraBlur: number;
  /** >1 keeps more of the flower sharp and saves the blur for the farthest parts. */
  blurFalloff: number;
  bloom: number;
  ghost: number;
  ghostOffset: number;
  ghostAngle: number;
  misregister: number;
  // Scan
  grain: number;
  grainSize: number;
  fiber: number;
  dust: number;
  scratches: number;
  banding: number;
  unevenLight: number;
  vignette: number;
  scanRotation: number;
  border: number;
  castColor: string;
  cast: number;
  // Inverse
  inverse: number;
};

/** Stage look sampled from references/Ui Reference (paper #af8e9c, shadow #a16a90 → #5f1b65). */
export const DEFAULT_PARAMS: StudioParams = {
  lightSize: 0.045,
  softness: 1,
  translucency: 0.5,
  veinDetail: 0.4,
  paper: '#b8939f',
  rampLight: '#ad8399',
  rampMid: '#a16a90',
  rampDeep: '#5f1b65',
  midPosition: 0.45,
  density: 0.92,
  hue: 0,
  saturation: 1,
  brightness: 0,
  contrast: 1,
  gamma: 1,
  blackPoint: 0,
  whitePoint: 1,
  temperature: 0,
  tint: 0,
  extraBlur: 0.4,
  blurFalloff: 1,
  bloom: 0,
  ghost: 0,
  ghostOffset: 12,
  ghostAngle: 35,
  misregister: 0,
  grain: 0.08,
  grainSize: 1.2,
  fiber: 0.15,
  dust: 0,
  scratches: 0,
  banding: 0,
  unevenLight: 0.1,
  vignette: 0.1,
  scanRotation: 0,
  border: 0,
  castColor: '#f2d9c4',
  cast: 0,
  inverse: 0,
};

export const PRESETS: Record<string, Partial<StudioParams>> = {
  'Stage (UI reference)': {},
  // Mood: purple poppy shadows on pink paper, heavy grain (Screenshot 2.47.47).
  'Lilac photogram': {
    paper: '#e8bec5', rampLight: '#d9a6c0', rampMid: '#b77bac', rampDeep: '#9d5896', midPosition: 0.4,
    density: 1, extraBlur: 0.35, grain: 0.22, grainSize: 1.6, fiber: 0.2, unevenLight: 0.12, vignette: 0.05,
  },
  // Mood: blue grainy negative, pale lilac-white subject (Screenshot 2.48.29).
  'Blue negative': {
    paper: '#4086bc', rampLight: '#6e9fd0', rampMid: '#a9b3dc', rampDeep: '#e3d4e6', midPosition: 0.5,
    density: 1, inverse: 0, extraBlur: 0.45, bloom: 0.25, grain: 0.32, grainSize: 1.4, fiber: 0.05,
    unevenLight: 0.08, vignette: 0.05,
  },
  // Mood: mauve lumen print, glowing pale subject (Screenshot 2.08.03).
  'Mauve lumen': {
    paper: '#997589', rampLight: '#a77b91', rampMid: '#bd8297', rampDeep: '#f4d6dc', midPosition: 0.45,
    density: 1, extraBlur: 0.6, bloom: 0.45, grain: 0.12, grainSize: 1.1, fiber: 0.3, unevenLight: 0.2,
    vignette: 0.25, cast: 0.15, castColor: '#e9c9a8',
  },
  // Mood: rose/red lumen, blown-out pink highlights (Screenshot 2.07.55).
  'Rose lumen': {
    paper: '#ba2724', rampLight: '#d8546a', rampMid: '#ec9fb3', rampDeep: '#f2d0db', midPosition: 0.4,
    density: 1, extraBlur: 0.75, bloom: 0.6, ghost: 0.25, ghostOffset: 18, misregister: 0.25,
    grain: 0.06, unevenLight: 0.15, vignette: 0.1, temperature: 0.1,
  },
  'Scanned print': {
    paper: '#e9dccb', rampLight: '#cdb7b0', rampMid: '#8f6f86', rampDeep: '#3d2541',
    grain: 0.15, fiber: 0.45, dust: 0.5, scratches: 0.4, banding: 0.3, unevenLight: 0.3, vignette: 0.3,
    scanRotation: 0.8, border: 0.035, cast: 0.2,
  },
};

export function hexToVec(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hsl(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/**
 * One-hue palette: paper, light, mid and deep share a hue (with a small drift, like the pink →
 * purple of the references) and differ in value and saturation. About a third come out as
 * negatives — a light subject on darker paper.
 */
export function randomPalette(rand: () => number = Math.random): Partial<StudioParams> {
  const hue = rand() * 360;
  const drift = (rand() - 0.5) * 24;
  const r = (lo: number, hi: number) => lo + rand() * (hi - lo);
  if (rand() < 0.33) {
    return {
      paper: hsl(hue, r(0.38, 0.6), r(0.36, 0.5)),
      rampLight: hsl(hue + drift * 0.3, r(0.35, 0.55), r(0.5, 0.58)),
      rampMid: hsl(hue + drift * 0.6, r(0.3, 0.5), r(0.66, 0.74)),
      rampDeep: hsl(hue + drift, r(0.25, 0.45), r(0.85, 0.92)),
      midPosition: r(0.4, 0.55),
    };
  }
  return {
    paper: hsl(hue, r(0.3, 0.6), r(0.76, 0.88)),
    rampLight: hsl(hue + drift * 0.3, r(0.3, 0.5), r(0.66, 0.74)),
    rampMid: hsl(hue + drift * 0.6, r(0.35, 0.55), r(0.46, 0.56)),
    rampDeep: hsl(hue + drift, r(0.5, 0.75), r(0.2, 0.32)),
    midPosition: r(0.38, 0.52),
  };
}

/** Halftone studio: strict two-tone screening of an exact hard-edged shadow, no blur of any kind. */
export const HALFTONE_STYLES = ['Dots', 'Squares', 'Diamonds', 'Lines', 'Threshold', 'Dither'] as const;
export type HalftoneStyle = (typeof HALFTONE_STYLES)[number];

export type HalftoneParams = {
  style: HalftoneStyle;
  cellSize: number;
  angle: number;
  threshold: number;
  contrast: number;
  gamma: number;
  ink: string;
  paper: string;
  invert: boolean;
};

export const DEFAULT_HALFTONE: HalftoneParams = {
  style: 'Dots',
  cellSize: 9,
  angle: 45,
  threshold: 0.5,
  contrast: 1.2,
  gamma: 1,
  ink: '#111111',
  paper: '#ffffff',
  invert: false,
};
