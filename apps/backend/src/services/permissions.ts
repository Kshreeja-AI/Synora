import type { WorkspaceRole } from '@synora/database';
import { ForbiddenException } from '@synora/shared';

/**
 * The single source of truth for what each workspace role can do. Every
 * route that mutates a workspace-scoped resource calls `requirePermission`
 * before touching the database — there is no client-trusted permission
 * check anywhere in this codebase. The frontend reads a member's `role`
 * purely to decide what UI to *show*; it is never the thing that decides
 * whether an action is *allowed*.
 */
export type Permission =
  | 'workspace:update'
  | 'workspace:delete'
  | 'member:invite'
  | 'member:remove'
  | 'member:role:update'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'folder:manage'
  | 'asset:upload'
  | 'asset:delete'
  | 'audit:view';

const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([
    'workspace:update',
    'workspace:delete',
    'member:invite',
    'member:remove',
    'member:role:update',
    'project:create',
    'project:update',
    'project:delete',
    'folder:manage',
    'asset:upload',
    'asset:delete',
    'audit:view',
  ]),
  ADMIN: new Set<Permission>([
    'workspace:update',
    'member:invite',
    'member:remove',
    'member:role:update',
    'project:create',
    'project:update',
    'project:delete',
    'folder:manage',
    'asset:upload',
    'asset:delete',
    'audit:view',
  ]),
  EDITOR: new Set<Permission>([
    'project:create',
    'project:update',
    'folder:manage',
    'asset:upload',
    'asset:delete',
  ]),
  MEMBER: new Set<Permission>(['asset:upload']),
  VIEWER: new Set<Permission>([]),
};

export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function requirePermission(role: WorkspaceRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenException(
      `Your role (${role}) does not have permission to perform this action.`
    );
  }
}

/**
 * ADMIN can invite/remove/reassign any non-owner freely, but granting or
 * revoking OWNER status is reserved for existing owners — an ADMIN could
 * otherwise promote themselves (or an ally) to OWNER and lock the real
 * owner out. Called in addition to (not instead of) `requirePermission`.
 */
export function requireOwnerForOwnershipChange(
  actorRole: WorkspaceRole,
  involvesOwnerRole: boolean
): void {
  if (involvesOwnerRole && actorRole !== 'OWNER') {
    throw new ForbiddenException('Only an owner can grant or change ownership.');
  }
}
