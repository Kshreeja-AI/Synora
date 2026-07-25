'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  UserRound,
  ShieldCheck,
  KeyRound,
  Building2,
  Moon,
  Sun,
  Monitor,
  LogOut,
  Keyboard,
  Plus,
} from 'lucide-react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@synora/design-system';
import { useCommandPaletteStore } from '../../stores/command-palette-store';
import { useKeyboardShortcutsStore } from '../../stores/keyboard-shortcuts-store';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';
import { useThemePreference } from '../../hooks/useThemePreference';
import { logout } from '../../lib/api/auth';

/**
 * Global ⌘K / Ctrl+K entry point. Doubles as the header's "search" affordance
 * (see Topbar) — rather than maintaining a separate content-search index that
 * doesn't exist yet, this searches the same set of real navigation and
 * account actions the palette offers, matching how Linear/Vercel treat
 * search and the command palette as one surface until content search has
 * something real to search over.
 */
export function CommandPalette(): React.JSX.Element {
  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  const open = useCommandPaletteStore((state) => state.open);
  const close = useCommandPaletteStore((state) => state.close);
  const openShortcuts = useKeyboardShortcutsStore((state) => state.open);
  const openCreateWorkspace = useCreateWorkspaceStore((state) => state.open);
  const { selectTheme } = useThemePreference();
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useCommandPaletteStore.getState().toggle();
      } else if (event.key === '/') {
        event.preventDefault();
        useKeyboardShortcutsStore.getState().open();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function runAndClose(action: () => void): void {
    close();
    action();
  }

  async function handleLogout(): Promise<void> {
    await logout();
    router.push('/');
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(next) => (next ? open() : close())}
      label="Command palette"
    >
      <CommandInput placeholder="Search actions and pages..." />
      <CommandList>
        <CommandEmpty>No matching actions.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem value="Dashboard" onSelect={() => runAndClose(() => router.push('/dashboard'))}>
            <LayoutDashboard className="h-4 w-4" aria-hidden /> Dashboard
          </CommandItem>
          <CommandItem
            value="Profile settings"
            onSelect={() => runAndClose(() => router.push('/dashboard/settings/profile'))}
          >
            <UserRound className="h-4 w-4" aria-hidden /> Profile settings
          </CommandItem>
          <CommandItem
            value="Account security settings"
            onSelect={() => runAndClose(() => router.push('/dashboard/settings/account'))}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden /> Account &amp; security
          </CommandItem>
          <CommandItem
            value="Sessions devices"
            onSelect={() => runAndClose(() => router.push('/dashboard/settings/sessions'))}
          >
            <KeyRound className="h-4 w-4" aria-hidden /> Sessions
          </CommandItem>
          <CommandItem
            value="Workspace settings"
            onSelect={() => runAndClose(() => router.push('/dashboard/settings/workspace'))}
          >
            <Building2 className="h-4 w-4" aria-hidden /> Workspace settings
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="Create workspace" onSelect={() => runAndClose(openCreateWorkspace)}>
            <Plus className="h-4 w-4" aria-hidden /> Create workspace
          </CommandItem>
          <CommandItem value="Light theme" onSelect={() => runAndClose(() => selectTheme('LIGHT'))}>
            <Sun className="h-4 w-4" aria-hidden /> Switch to light theme
          </CommandItem>
          <CommandItem value="Dark theme" onSelect={() => runAndClose(() => selectTheme('DARK'))}>
            <Moon className="h-4 w-4" aria-hidden /> Switch to dark theme
          </CommandItem>
          <CommandItem value="System theme" onSelect={() => runAndClose(() => selectTheme('AUTO'))}>
            <Monitor className="h-4 w-4" aria-hidden /> Match system theme
          </CommandItem>
          <CommandItem value="Keyboard shortcuts" onSelect={() => runAndClose(openShortcuts)}>
            <Keyboard className="h-4 w-4" aria-hidden /> Keyboard shortcuts
            <CommandShortcut>⌘/</CommandShortcut>
          </CommandItem>
          <CommandItem value="Log out" onSelect={() => runAndClose(handleLogout)}>
            <LogOut className="h-4 w-4" aria-hidden /> Log out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
