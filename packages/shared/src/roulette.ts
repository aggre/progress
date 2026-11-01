import { validateActivityPlan, type ActivityPlan } from './activity';

export interface RouletteInput extends ActivityPlan {
  readonly title: string;
  readonly options: Readonly<ArrayLike<string>>;
}

export const MAX_ROULETTE_OPTIONS = 20;

export function validateRoulette(data: Readonly<Record<string, unknown>>): RouletteInput | Readonly<{ error: string }> {
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const options: Readonly<ArrayLike<unknown>> = Array.isArray(data.options) ? data.options : [];
  const plan = validateActivityPlan(data);
  return Object.keys(data).some(key => !['title', 'options', 'playMinutes', 'afterTask'].includes(key))
    ? { error: 'Only a name, choices, play time, and one optional task are accepted.' }
    : !title || title.length > 80 ? { error: 'Give your roulette a name of 1–80 characters.' }
    : options.length < 2 || options.length > MAX_ROULETTE_OPTIONS ? { error: 'Add 2–20 choices.' }
    : Array.from(options).some(option => typeof option !== 'string' || !option.trim() || option.trim().length > 60)
      ? { error: 'Each choice needs 1–60 characters.' }
      : 'error' in plan ? plan
      : { title, options: Array.from(options).map(option => (option as string).trim()), ...plan };
}

export function normalizeAngle(degrees: number): number { return ((degrees % 360) + 360) % 360; }
export function angleDelta(previous: number, next: number): number { return normalizeAngle(next - previous + 180) - 180; }
// Segments begin at twelve o'clock, clockwise. The pointer stays at twelve o'clock.
export function winningIndex(rotation: number, count: number): number {
  return Math.min(count - 1, Math.floor(normalizeAngle(-rotation) / (360 / count)));
}

export const MAX_SPIN_SPEED = 1440; // Degrees per second.
export const STOP_SPIN_SPEED = 8;
const friction = 0.9;
export function coast(rotation: number, velocity: number, seconds: number): Readonly<{ rotation: number; velocity: number }> {
  const decay = Math.exp(-friction * Math.max(0, seconds));
  return { rotation: normalizeAngle(rotation + velocity * (1 - decay) / friction), velocity: velocity * decay };
}

export interface SpinSample { readonly angle: number; readonly time: number; }
export function releaseVelocity(samples: Readonly<ArrayLike<SpinSample>>, releasedAt: number): number {
  const last = samples[samples.length - 1];
  // Keep the last movement's measurement window when the finger lifts between
  // frames; measuring from pointerup can drop the preceding sample entirely.
  const recent: Readonly<ArrayLike<SpinSample>> = Array.from(samples).filter(sample => last && last.time - sample.time <= 100);
  const first = recent[0];
  const speed = first && last && last.time > first.time && releasedAt - last.time < 80
    ? (last.angle - first.angle) / ((last.time - first.time) / 1000) : 0;
  return Math.max(-MAX_SPIN_SPEED, Math.min(MAX_SPIN_SPEED, speed));
}
