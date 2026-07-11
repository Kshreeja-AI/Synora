/**
 * Base class for domain objects defined entirely by their attributes (no identity).
 * Two value objects are equal if all of their props are structurally equal.
 * Value objects must be treated as immutable by convention — do not mutate `props` after construction.
 */
export abstract class ValueObject<Props extends Record<string, unknown>> {
  protected readonly props: Readonly<Props>;

  protected constructor(props: Props) {
    this.props = Object.freeze({ ...props });
  }

  equals(other: ValueObject<Props> | undefined | null): boolean {
    if (other === undefined || other === null) return false;
    if (!(other instanceof ValueObject)) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
