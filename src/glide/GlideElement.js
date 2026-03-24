export class GlideElement {
  #value;
  #fieldName;

  constructor(fieldName, value) {
    this.#fieldName = fieldName;
    this.#value = value ?? '';
  }

  getValue() {
    return this.#value == null ? '' : String(this.#value);
  }

  getDisplayValue() {
    return this.getValue();
  }

  setValue(value) {
    this.#value = value;
  }

  nil() {
    return this.#value === null || this.#value === undefined || this.#value === '';
  }

  toString() {
    return this.getValue();
  }

  getName() {
    return this.#fieldName;
  }
}
