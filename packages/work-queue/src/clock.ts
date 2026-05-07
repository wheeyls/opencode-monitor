export interface Clock {
  now(): Date;
}

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date("2025-01-01T00:00:00Z")) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}
