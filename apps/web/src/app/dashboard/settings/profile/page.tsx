'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
  Textarea,
  toast,
} from '@synora/design-system';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { removeAvatar, updateProfile, uploadAvatar } from '../../../../lib/api/account';
import { resendVerificationEmail } from '../../../../lib/api/auth';
import { ApiError } from '../../../../lib/api/client';

export default function ProfileSettingsPage(): React.JSX.Element {
  const { data: user, isLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    if (user) {
      setName(user.name ?? '');
      setBio(user.profile?.bio ?? '');
      setWebsite(user.profile?.website ?? '');
      setLocation(user.profile?.location ?? '');
    }
  }, [user]);

  const invalidateUser = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['users', 'me'] }).then(() => undefined);

  const updateProfileMutation = useMutation({
    mutationFn: () => updateProfile({ name, bio, website, location }),
    onSuccess: () => {
      invalidateUser();
      toast.success('Profile updated.');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update profile.');
    },
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: (file: File) => uploadAvatar(file),
    onSuccess: () => {
      invalidateUser();
      toast.success('Avatar updated.');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to upload avatar.');
    },
  });

  const removeAvatarMutation = useMutation({
    mutationFn: removeAvatar,
    onSuccess: () => {
      invalidateUser();
      toast.success('Avatar removed.');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove avatar.');
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) uploadAvatarMutation.mutate(file);
    e.target.value = '';
  };

  const handleResend = async (): Promise<void> => {
    setResendStatus('sending');
    try {
      await resendVerificationEmail();
      setResendStatus('sent');
    } catch {
      setResendStatus('idle');
    }
  };

  if (isLoading || !user) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row">
          <Avatar className="h-20 w-20">
            <AvatarImage src={user.image ?? undefined} alt="" />
            <AvatarFallback className="text-xl">
              {(user.name || user.email).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={uploadAvatarMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                Change avatar
              </Button>
              {user.image && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={removeAvatarMutation.isPending}
                  onClick={() => removeAvatarMutation.mutate()}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPEG, WEBP, or GIF. Max 5MB.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            aria-label="Upload avatar"
            onChange={handleFileChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={user.email} disabled />
            {!user.emailVerified && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">Your email address is not verified.</p>
                {resendStatus === 'sent' ? (
                  <span className="text-xs font-medium text-success">Sent!</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendStatus === 'sending'}
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    Resend verification
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="Tell us about yourself"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, country" />
          </div>

          <Button
            type="button"
            variant="primary"
            loading={updateProfileMutation.isPending}
            onClick={() => updateProfileMutation.mutate()}
          >
            Save changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
