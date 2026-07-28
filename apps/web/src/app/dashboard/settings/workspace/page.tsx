'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  toast,
} from '@synora/design-system';
import { MoreHorizontal, Clock3, History } from 'lucide-react';
import { useCurrentWorkspace } from '../../../../hooks/useCurrentWorkspace';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import {
  updateWorkspace,
  listWorkspaceMembers,
  updateMemberRole,
  removeMember,
  listInvitations,
  createInvitation,
  revokeInvitation,
  listAuditLog,
} from '../../../../lib/api/workspaces';
import { ApiError } from '../../../../lib/api/client';
import type { WorkspaceRole, WorkspaceMemberSummary } from '../../../../lib/api/types';

const MANAGE_ROLES: Exclude<WorkspaceRole, 'OWNER'>[] = ['ADMIN', 'EDITOR', 'MEMBER', 'VIEWER'];

function WorkspaceDetailsSection(): React.JSX.Element {
  const { currentWorkspace, isLoading } = useCurrentWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  useEffect(() => {
    if (currentWorkspace) setName(currentWorkspace.name);
  }, [currentWorkspace]);

  const mutation = useMutation({
    mutationFn: () => updateWorkspace(currentWorkspace!.id, { name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('Workspace updated.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update workspace.');
    },
  });

  if (isLoading || !currentWorkspace) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const isOwner = currentWorkspace.role === 'OWNER';

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-foreground">Workspace details</h2>
        <div className="space-y-1.5">
          <Label htmlFor="workspace-slug">URL</Label>
          <p id="workspace-slug" className="text-sm text-muted-foreground">
            synora.ai/{currentWorkspace.slug}
          </p>
        </div>
        {isOwner ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim().length > 0) mutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={name.trim().length === 0 || name.trim() === currentWorkspace.name}
            >
              Save changes
            </Button>
          </form>
        ) : (
          <div className="space-y-1.5">
            <Label>Workspace name</Label>
            <p className="text-sm text-muted-foreground">
              {currentWorkspace.name} — only the workspace owner can rename this workspace.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MemberRoleMenu({
  workspaceId,
  member,
  canManage,
  isSelf,
}: {
  workspaceId: string;
  member: WorkspaceMemberSummary;
  canManage: boolean;
  isSelf: boolean;
}): React.JSX.Element | null {
  const queryClient = useQueryClient();

  const roleMutation = useMutation({
    mutationFn: (role: WorkspaceRole) => updateMemberRole(workspaceId, member.id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] });
      toast.success('Member role updated.');
    },
    onError: (error: unknown) => {
      // The backend is the source of truth here — a UI-side role check is
      // only ever a hint; a denied request still surfaces this way.
      toast.error(error instanceof ApiError ? error.message : 'Failed to update role.');
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => removeMember(workspaceId, member.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] });
      toast.success(isSelf ? 'You left the workspace.' : 'Member removed.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to remove member.');
    },
  });

  if (!canManage && !isSelf) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Member actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManage && !isSelf && (
          <>
            {MANAGE_ROLES.map((role) => (
              <DropdownMenuItem
                key={role}
                disabled={role === member.role}
                onSelect={() => roleMutation.mutate(role)}
              >
                Make {role.charAt(0) + role.slice(1).toLowerCase()}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => removeMutation.mutate()}>
          {isSelf ? 'Leave workspace' : 'Remove member'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MembersSection(): React.JSX.Element | null {
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: currentUser } = useCurrentUser();

  const { data: members, isLoading } = useQuery({
    queryKey: ['workspaces', currentWorkspace?.id, 'members'],
    queryFn: () => listWorkspaceMembers(currentWorkspace!.id),
    enabled: Boolean(currentWorkspace?.id),
  });

  if (!currentWorkspace) return null;

  const canManage = currentWorkspace.role === 'OWNER' || currentWorkspace.role === 'ADMIN';

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-foreground">Members</h2>
        {isLoading || !members ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-3">
                <Avatar>
                  <AvatarImage src={member.user.image ?? undefined} alt="" />
                  <AvatarFallback>{(member.user.name || member.user.email).charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{member.user.name || 'Unnamed'}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                </div>
                <Badge variant="outline">{member.role}</Badge>
                <MemberRoleMenu
                  workspaceId={currentWorkspace.id}
                  member={member}
                  canManage={canManage}
                  isSelf={member.user.id === currentUser?.id}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InviteMemberDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<WorkspaceRole, 'OWNER'>>('MEMBER');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createInvitation(workspaceId, { email: email.trim(), role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'invitations'] });
      toast.success(`Invitation sent to ${email.trim()}.`);
      setEmail('');
      setRole('MEMBER');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to send invitation.');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim().length > 0) mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@company.com"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as Exclude<WorkspaceRole, 'OWNER'>)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {MANAGE_ROLES.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending} disabled={email.trim().length === 0}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvitationsSection(): React.JSX.Element | null {
  const { currentWorkspace } = useCurrentWorkspace();
  const [inviteOpen, setInviteOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: invitations, isLoading } = useQuery({
    queryKey: ['workspaces', currentWorkspace?.id, 'invitations'],
    queryFn: () => listInvitations(currentWorkspace!.id),
    enabled: Boolean(currentWorkspace?.id),
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(currentWorkspace!.id, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', currentWorkspace?.id, 'invitations'] });
      toast.success('Invitation revoked.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to revoke invitation.');
    },
  });

  if (!currentWorkspace) return null;

  const canInvite = currentWorkspace.role === 'OWNER' || currentWorkspace.role === 'ADMIN';

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Pending invitations</h2>
          {canInvite && <Button onClick={() => setInviteOpen(true)}>Invite member</Button>}
        </div>
        {isLoading || !invitations ? (
          <Skeleton className="h-16 w-full" />
        ) : invitations.length === 0 ? (
          <EmptyState
            icon={<Clock3 className="h-8 w-8" />}
            title="No pending invitations"
            description={canInvite ? 'Invite teammates to collaborate in this workspace.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{invitation.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Invited by {invitation.invitedBy.name || invitation.invitedBy.email}
                  </p>
                </div>
                <Badge variant="outline">{invitation.role}</Badge>
                {canInvite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => revokeMutation.mutate(invitation.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canInvite && (
          <InviteMemberDialog workspaceId={currentWorkspace.id} open={inviteOpen} onOpenChange={setInviteOpen} />
        )}
      </CardContent>
    </Card>
  );
}

function formatAuditAction(action: string): string {
  return action.replace(/\./g, ' ').replace(/_/g, ' ');
}

function AuditLogSection(): React.JSX.Element | null {
  const { currentWorkspace } = useCurrentWorkspace();

  const { data: entries, isLoading, isError } = useQuery({
    queryKey: ['workspaces', currentWorkspace?.id, 'audit-log'],
    queryFn: () => listAuditLog(currentWorkspace!.id),
    enabled: Boolean(currentWorkspace?.id),
  });

  if (!currentWorkspace) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-foreground">Audit log</h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Only owners and admins can view the audit log for this workspace.
          </p>
        ) : !entries || entries.length === 0 ? (
          <EmptyState icon={<History className="h-8 w-8" />} title="No activity yet" />
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="py-3">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{entry.actor?.name || entry.actor?.email || 'Unknown user'}</span>{' '}
                  {formatAuditAction(entry.action)}
                </p>
                <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkspaceSettingsPage(): React.JSX.Element {
  return (
    <Tabs defaultValue="details" className="space-y-6">
      <TabsList>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="invitations">Invitations</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="details">
        <WorkspaceDetailsSection />
      </TabsContent>
      <TabsContent value="members">
        <MembersSection />
      </TabsContent>
      <TabsContent value="invitations">
        <InvitationsSection />
      </TabsContent>
      <TabsContent value="activity">
        <AuditLogSection />
      </TabsContent>
    </Tabs>
  );
}
