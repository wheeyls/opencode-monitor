import type { IdGenerator } from "../../ports/id-generator.js";

export class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  private prefix: string;

  constructor(prefix: string = "id") {
    this.prefix = prefix;
  }

  generate(): string {
    this.counter++;
    return `${this.prefix}-${this.counter}`;
  }
}
