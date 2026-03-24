export class GlideDateTime {
  #date;

  constructor(value) {
    if (value instanceof GlideDateTime) {
      this.#date = new Date(value.#date);
    } else if (value instanceof Date) {
      this.#date = new Date(value);
    } else if (typeof value === 'string' && value) {
      this.#date = new Date(value);
    } else {
      this.#date = new Date();
    }
  }

  getValue() {
    return this.#date.toISOString();
  }

  getDisplayValue() {
    return this.#date.toLocaleString();
  }

  getNumericValue() {
    return this.#date.getTime();
  }

  addSeconds(seconds) {
    this.#date = new Date(this.#date.getTime() + seconds * 1000);
    return this;
  }

  addDays(days) {
    this.#date = new Date(this.#date.getTime() + days * 86400000);
    return this;
  }

  addMonths(months) {
    const d = new Date(this.#date);
    d.setMonth(d.getMonth() + months);
    this.#date = d;
    return this;
  }

  before(other) {
    const otherTime = other instanceof GlideDateTime ? other.getNumericValue() : new Date(other).getTime();
    return this.#date.getTime() < otherTime;
  }

  after(other) {
    const otherTime = other instanceof GlideDateTime ? other.getNumericValue() : new Date(other).getTime();
    return this.#date.getTime() > otherTime;
  }

  toString() {
    return this.getValue();
  }
}
