/** Parse env durations like `15m`, `7d`, `1h` into seconds. */
export function parseDurationToSeconds(duration: string): number {
  const match = duration.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return value * multipliers[unit]!;
}
