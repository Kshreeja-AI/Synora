'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Skeleton,
  Switch,
  toast,
} from '@synora/design-system';
import { PasswordInput } from '../../../../components/auth/PasswordInput';
import {
  changePassword,
  deleteAccount,
  getPreferences,
  updatePreferences,
} from '../../../../lib/api/account';
import { clearTokens } from '../../../../lib/auth/token-storage';
import { MfaSection } from '../../../../components/settings/MfaSection';
import { ApiError } from '../../../../lib/api/client';

function PasswordSection(): React.JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success('Password changed. Other devices have been signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Failed to change password.');
    },
  });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    mutation.mutate();
  };

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Change password</h2>
        {error && (
          <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <PasswordInput
              id="currentPassword"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmNewPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmNewPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NotificationsSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['users', 'me', 'preferences'],
    queryFn: getPreferences,
  });

  const mutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(['users', 'me', 'preferences'], data);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update preferences.');
    },
  });

  if (isLoading || !preferences) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const toggles: Array<{ key: 'emailNotifications' | 'pushNotifications' | 'marketingEmails'; label: string; description: string }> = [
    { key: 'emailNotifications', label: 'Email notifications', description: 'Account and activity updates by email.' },
    { key: 'pushNotifications', label: 'Push notifications', description: 'Real-time alerts in your browser.' },
    { key: 'marketingEmails', label: 'Marketing emails', description: 'Product news and announcements.' },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
        {toggles.map((toggle) => (
          <div key={toggle.key} className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={toggle.key} className="font-medium">
                {toggle.label}
              </Label>
              <p className="text-xs text-muted-foreground">{toggle.description}</p>
            </div>
            <Switch
              id={toggle.key}
              checked={preferences[toggle.key]}
              onCheckedChange={(checked) => mutation.mutate({ [toggle.key]: checked })}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DeleteAccountSection(): React.JSX.Element {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => deleteAccount(password),
    onSuccess: () => {
      clearTokens();
      router.push('/');
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Failed to delete account.');
    },
  });

  useEffect(() => {
    if (!open) {
      setPassword('');
      setConfirmText('');
      setError('');
    }
  }, [open]);

  return (
    <Card className="border-destructive/40">
      <CardContent className="p-6">
        <h2 className="mb-2 text-lg font-semibold text-foreground">Danger zone</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Deleting your account is permanent. You will be signed out of every device.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="danger">Delete account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This cannot be undone. Type <strong>DELETE</strong> and enter your password to confirm.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
                <Input id="delete-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delete-password">Password</Label>
                <PasswordInput
                  id="delete-password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={confirmText !== 'DELETE' || password.length === 0}
                loading={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                Delete my account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default function AccountSettingsPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <PasswordSection />
      <MfaSection />
      <NotificationsSection />
      <DeleteAccountSection />
    </div>
  );
}
