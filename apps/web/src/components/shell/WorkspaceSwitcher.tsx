'use client';

import { ChevronsUpDown, Plus, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Avatar,
  AvatarFallback,
  Skeleton,
  cn,
} from '@synora/design-system';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';

export interface WorkspaceSwitcherProps {
  collapsed?: boolean;
}

export function WorkspaceSwitcher({ collapsed = false }: WorkspaceSwitcherProps): React.JSX.Element {
  const { workspaces, currentWorkspace, setCurrentWorkspaceId, isLoading } = useCurrentWorkspace();
  const openCreateDialog = useCreateWorkspaceStore((state) => state.open);

  if (isLoading) {
    return <Skeleton className="h-10 w-full rounded-md" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-7 w-7 shrink-0 rounded-md">
            <AvatarFallback className="rounded-md text-xs">
              {(currentWorkspace?.name ?? '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{currentWorkspace?.name ?? 'Select workspace'}</span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => setCurrentWorkspaceId(workspace.id)}
            className={cn('gap-2', workspace.id === currentWorkspace?.id && 'bg-accent')}
          >
            <Avatar className="h-6 w-6 rounded-md">
              <AvatarFallback className="rounded-md text-[10px]">
                {workspace.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate">{workspace.name}</span>
            {workspace.id === currentWorkspace?.id && <Check className="h-4 w-4 shrink-0" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" aria-hidden />
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
