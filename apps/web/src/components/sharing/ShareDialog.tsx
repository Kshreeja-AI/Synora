'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@synora/design-system/components/Dialog';
import { Button } from '@synora/design-system/components/Button';
import { Input } from '@synora/design-system/components/Input';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useCreateShare, SharePermission, getPermissionLabel, getPermissionDescription, copyShareLink } from '@/lib/api/sharing';
import { Copy, Check, AlertCircle } from 'lucide-react';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  conversationId: string;
  conversationTitle: string;
}

export function ShareDialog({
  open,
  onOpenChange,
  workspaceId,
  conversationId,
  conversationTitle,
}: ShareDialogProps) {
  const [permission, setPermission] = useState<SharePermission>(SharePermission.VIEW);
  const [expiresIn, setExpiresIn] = useState<string>('never');
  const [copied, setCopied] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const { mutate: createShare, isPending } = useCreateShare(workspaceId, conversationId);

  const handleCreateShare = () => {
    createShare(
      {
        permission,
        expiresIn: expiresIn === 'never' ? undefined : expiresIn,
      },
      {
        onSuccess: (data) => {
          setGeneratedUrl(data.inviteUrl);
          setPermission(SharePermission.VIEW);
          setExpiresIn('never');
        },
      }
    );
  };

  const handleCopyLink = () => {
    if (generatedUrl && copyShareLink(generatedUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share Conversation</DialogTitle>
          <DialogDescription>
            Share "{conversationTitle}" with others via invite link
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {generatedUrl ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Invite Link</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={generatedUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyLink}
                    className="flex-shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-900 dark:text-blue-100">
                <p className="font-medium mb-1">Share this link</p>
                <p className="text-xs">Anyone with this link can {getPermissionLabel(permission).toLowerCase()}</p>
              </div>

              <Button
                type="button"
                onClick={() => {
                  setGeneratedUrl(null);
                  onOpenChange(false);
                }}
                className="w-full"
              >
                Done
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Permission Level</label>
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.currentTarget.value as SharePermission)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
                >
                  <option value={SharePermission.VIEW}>
                    {getPermissionLabel(SharePermission.VIEW)}
                  </option>
                  <option value={SharePermission.EDIT}>
                    {getPermissionLabel(SharePermission.EDIT)}
                  </option>
                  <option value={SharePermission.MANAGE}>
                    {getPermissionLabel(SharePermission.MANAGE)}
                  </option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  {getPermissionDescription(permission)}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Link Expiration</label>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.currentTarget.value)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
                >
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="90d">90 days</option>
                  <option value="never">Never expires</option>
                </select>
              </div>

              <div className="rounded-md bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-900 dark:text-amber-100">
                <div className="flex gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <p className="text-xs">Anyone with the link can access this conversation with the selected permission level</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleCreateShare}
                  disabled={isPending}
                  className="flex-1"
                >
                  {isPending ? <Spinner size="sm" /> : 'Generate Link'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
