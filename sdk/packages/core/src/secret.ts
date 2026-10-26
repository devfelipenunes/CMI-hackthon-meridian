const REDACTED = "[redacted]";
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class Secret<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  expose(): T {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [INSPECT](): string {
    return REDACTED;
  }
}
