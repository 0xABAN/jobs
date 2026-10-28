export class Stopwatch {
  laps: Record<string, number> = {};
  private last = performance.now();

  lap(name: string): void {
    const now = performance.now();
    this.laps[name] = Math.round((now - this.last) / 100) / 10;
    this.last = now;
  }
}
