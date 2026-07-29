import { describe, it, expect } from 'vitest';
import { hasPermission, requirePermission, requireOwnerForOwnershipChange } from '../permissions';
import { ForbiddenException } from '@synora/shared';

describe('permissions', () => {
  it('grants OWNER every permission', () => {
    const permissions: Parameters<typeof hasPermission>[1][] = [
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
      'conversation:create',
      'conversation:manage',
      'message:send',
      'message:manage',
      'branch:manage',
      'conversation-folder:manage',
      'prompt:manage',
      'template:manage',
      'sharing:manage',
    ];
    for (const permission of permissions) {
      expect(hasPermission('OWNER', permission)).toBe(true);
    }
  });

  it('denies VIEWER every write permission', () => {
    expect(hasPermission('VIEWER', 'project:create')).toBe(false);
    expect(hasPermission('VIEWER', 'asset:upload')).toBe(false);
    expect(hasPermission('VIEWER', 'folder:manage')).toBe(false);
    expect(hasPermission('VIEWER', 'member:invite')).toBe(false);
  });

  it('denies VIEWER every chat permission', () => {
    expect(hasPermission('VIEWER', 'conversation:create')).toBe(false);
    expect(hasPermission('VIEWER', 'message:send')).toBe(false);
    expect(hasPermission('VIEWER', 'branch:manage')).toBe(false);
    expect(hasPermission('VIEWER', 'conversation-folder:manage')).toBe(false);
    expect(hasPermission('VIEWER', 'prompt:manage')).toBe(false);
    expect(hasPermission('VIEWER', 'template:manage')).toBe(false);
    expect(hasPermission('VIEWER', 'sharing:manage')).toBe(false);
  });

  it('lets MEMBER upload assets but nothing else', () => {
    expect(hasPermission('MEMBER', 'asset:upload')).toBe(true);
    expect(hasPermission('MEMBER', 'asset:delete')).toBe(false);
    expect(hasPermission('MEMBER', 'project:create')).toBe(false);
  });

  it('lets MEMBER use every chat feature — the same "not VIEWER" bar the old inline checks enforced', () => {
    expect(hasPermission('MEMBER', 'conversation:create')).toBe(true);
    expect(hasPermission('MEMBER', 'message:send')).toBe(true);
    expect(hasPermission('MEMBER', 'branch:manage')).toBe(true);
    expect(hasPermission('MEMBER', 'conversation-folder:manage')).toBe(true);
    expect(hasPermission('MEMBER', 'prompt:manage')).toBe(true);
    expect(hasPermission('MEMBER', 'template:manage')).toBe(true);
    expect(hasPermission('MEMBER', 'sharing:manage')).toBe(true);
  });

  it('denies ADMIN workspace:delete (owner-only)', () => {
    expect(hasPermission('ADMIN', 'workspace:delete')).toBe(false);
    expect(hasPermission('ADMIN', 'workspace:update')).toBe(true);
  });

  it('lets EDITOR manage projects/folders/assets but not members', () => {
    expect(hasPermission('EDITOR', 'project:create')).toBe(true);
    expect(hasPermission('EDITOR', 'folder:manage')).toBe(true);
    expect(hasPermission('EDITOR', 'asset:delete')).toBe(true);
    expect(hasPermission('EDITOR', 'member:invite')).toBe(false);
    expect(hasPermission('EDITOR', 'audit:view')).toBe(false);
  });

  it('requirePermission throws ForbiddenException for a missing permission', () => {
    expect(() => requirePermission('VIEWER', 'project:create')).toThrow(ForbiddenException);
  });

  it('requirePermission does not throw for a granted permission', () => {
    expect(() => requirePermission('EDITOR', 'project:create')).not.toThrow();
  });

  it('requireOwnerForOwnershipChange throws for a non-owner touching ownership', () => {
    expect(() => requireOwnerForOwnershipChange('ADMIN', true)).toThrow(ForbiddenException);
  });

  it('requireOwnerForOwnershipChange allows an owner to touch ownership', () => {
    expect(() => requireOwnerForOwnershipChange('OWNER', true)).not.toThrow();
  });

  it('requireOwnerForOwnershipChange allows a non-owner when ownership is not involved', () => {
    expect(() => requireOwnerForOwnershipChange('ADMIN', false)).not.toThrow();
  });
});
