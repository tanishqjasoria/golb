export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function readingTime(body: string | undefined): string {
  const words = (body ?? '').split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 220))} min`;
}
