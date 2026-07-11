import type { Identifier } from './identifier.js';

/**
 * Base class for domain objects defined by identity rather than by their attributes.
 * Two entities are equal if their ids are equal, regardless of prop differences.
 */
export abstract class Entity<Props> {
  protected readonly _id: Identifier;
  protected props: Props;

  protected constructor(props: Props, id: Identifier) {
    this._id = id;
    this.props = props;
  }

  get id(): Identifier {
    return this._id;
  }

  equals(other: Entity<Props> | undefined | null): boolean {
    if (other === undefined || other === null) return false;
    if (this === other) return true;
    if (!(other instanceof Entity)) return false;
    return this._id.equals(other._id);
  }
}
