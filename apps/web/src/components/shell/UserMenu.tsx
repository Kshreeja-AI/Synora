'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  UserRound,
  ShieldCheck,
  KeyRound,
  Building2,
  Keyboard,
  Check,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '@synora/design-system';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useThemePreference } from '../../hooks/useThemePreference';
import { useKeyboardShortcutsStore } from '../../stores/keyboard-shortcuts-store';
import { logout } from '../../lib/api/auth';

const THEME_ICONS = { LIGHT: Sun, DARK: Moon, AUTO: Monitor } as const;

export function UserMenu(): React.JSX.Element | null {
  const { data: user } = useCurrentUser();
  const { current, selectTheme } = useThemePreference();
  const openShortcuts = useKeyboardShortcutsStore((state) => state.open);
  const router = useRouter();

  if (!user) return null;

  async function handleLogout(): Promise<void> {
    await logout();
    router.push('/');
  }

  const initials = (user.name || user.email).charAt(0).toUpperCase();
  const ThemeIcon = THEME_ICONS[current];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar>
            <AvatarImage src={user.image ?? undefined} alt="" />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="truncate text-sm font-medium text-foreground">{user.name || 'Unnamed'}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/profile" className="gap-2">
            <UserRound className="h-4 w-4" aria-hidden /> Profile settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/account" className="gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Account &amp; security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/sessions" className="gap-2">
            <KeyRound className="h-4 w-4" aria-hidden /> Sessions
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/workspace" className="gap-2">
            <Building2 className="h-4 w-4" aria-hidden /> Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <ThemeIcon className="h-4 w-4" aria-hidden />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => selectTheme('LIGHT')} className="gap-2">
                <Sun className="h-4 w-4" aria-hidden /> Light
                {current === 'LIGHT' && <Check className="ml-auto h-4 w-4" aria-hidden />}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectTheme('DARK')} className="gap-2">
                <Moon className="h-4 w-4" aria-hidden /> Dark
                {current === 'DARK' && <Check className="ml-auto h-4 w-4" aria-hidden />}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectTheme('AUTO')} className="gap-2">
                <Monitor className="h-4 w-4" aria-hidden /> System
                {current === 'AUTO' && <Check className="ml-auto h-4 w-4" aria-hidden />}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => openShortcuts()} className="gap-2">
          <Keyboard className="h-4 w-4" aria-hidden /> Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout} className="gap-2 text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
