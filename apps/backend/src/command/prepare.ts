import { hasPermission, type Permission, type WorkspaceRole } from '../services/permissions';
import { understandCommand } from './understand';
import type { CommandRoute, CommandUnderstanding } from './types';

/**
 * Slice 2 of the Universal Command Layer: "and am *I* allowed to do this,
 * here?"
 *
 * Understanding (slice 1) is deliberately identity-free — the same sentence
 * means the same thing to everyone. Whether a particular person may ACT on
 * it is a different question with a different answer per person, and mixing
 * the two would make the interpretation itself look like an entitlement.
 *
 * This step still executes nothing. It answers, per candidate capability:
 * may this person use it, and if not, why. The authoritative check runs
 * again server-side at the moment of execution — this is a courtesy answer
 * so a person is not offered a button that will reject them, NOT a
 * substitute for the real gate. A preparation that said "allowed" would
 * still be re-checked; nothing here can grant anything.
 */

export interface PreparedCapability {
  route: CommandRoute;
  /** Whether this person's workspace role permits acting on it. */
  permitted: boolean;
  /**
   * Present only when `permitted` is false, naming the missing permission
   * in the same vocabulary the permission system uses. A person told
   * "not allowed" with no reason cannot ask for the right thing.
   */
  missingPermission?: string;
  /**
   * True when the capability is permitted AND available in this deployment.
   * The two are independent: a workspace OWNER still cannot generate an
   * image with no provider configured, and having a credential does not
   * grant a VIEWER the right to invite people.
   */
  actionable: boolean;
}

export interface PreparedCommand {
  understanding: CommandUnderstanding;
  capabilities: PreparedCapability[];
  /**
   * The single best thing to offer, or null when nothing is actionable.
   * Null is a real answer here — offering the person a capability they
   * cannot use is worse than telling them there is nothing to offer.
   */
  recommended: PreparedCapability | null;
  /** Unchanged from slice 1, restated so a caller reading only this object cannot mistake it. */
  executed: false;
}

function prepareCapability(route: CommandRoute, role: WorkspaceRole): PreparedCapability {
  // `requiredPermission: null` means workspace membership is enough —
  // reading, previewing, and asking. Membership was already established by
  // the route's own `requireWorkspaceAccess` middleware before this ran.
  const permitted =
    route.requiredPermission === null
      ? true
      : hasPermission(role, route.requiredPermission as Permission);

  return {
    route,
    permitted,
    ...(permitted ? {} : { missingPermission: route.requiredPermission ?? undefined }),
    actionable: permitted && route.availability === 'available',
  };
}

export function prepareCommand(rawInput: string, role: WorkspaceRole): PreparedCommand {
  const understanding = understandCommand(rawInput);
  const capabilities = understanding.routes.map((route) => prepareCapability(route, role));

  // First actionable candidate, in catalogue order — the catalogue is
  // ordered best-first per intent. Deliberately NOT "first permitted":
  // recommending something the deployment cannot actually run would send a
  // person to a button that fails for a reason they cannot fix.
  const recommended = capabilities.find((candidate) => candidate.actionable) ?? null;

  return { understanding, capabilities, recommended, executed: false };
}
