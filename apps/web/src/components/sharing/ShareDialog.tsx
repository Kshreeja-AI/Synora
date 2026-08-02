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
import {
  useCreateShare,
  useConversationShares,
  useRevokeShare,
  getShareUrl,
  getPermissionLabel,
  getPermissionDescription,
  copyShareLink,
  type SharePermission,
} from '@/lib/api/sharing';
import { Copy, Check, AlertCircle, Trash2 } from 'lucide-react';

const EXPIRY_OPTIONS = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: 'never', label: 'Never expires', days: null },
] as const;

function expiryToIso(value: string): string | undefined {
  const option = EXPIRY_OPTIONS.find((o) => o.value === value);
  if (!option || option.days === null) return undefined;
  return new Date(Date.now() + option.days * 24 * 60 * 60 * 1000).toISOString();
}

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
  const [permission, setPermission] = useState<SharePermission>('VIEW');
  const [expiresIn, setExpiresIn] = useState<string>('never');
  const [copied, setCopied] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const { mutate: createShare, isPending } = useCreateShare(workspaceId, conversationId);
  const { data: existingShares = [] } = useConversationShares(workspaceId, conversationId, {
    enabled: open,
  });
  const { mutate: revokeShare, isPending: isRevoking } = useRevokeShare(
    workspaceId,
    conversationId
  );

  const handleCreateShare = () => {
    createShare(
      {
        permissions: permission,
        // A share link in this dialog is always anonymous-viewable —
        // that's the product meaning of "share". Non-public shares
        // are an API-level concept for a future authenticated flow.
        isPublic: true,
        expiresAt: expiryToIso(expiresIn),
      },
      {
        onSuccess: (share) => {
          setGeneratedUrl(getShareUrl(share.shareToken));
        },
      }
    );
  };

  const handleCopyLink = async () => {
    if (generatedUrl && (await copyShareLink(generatedUrl))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setGeneratedUrl(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share Conversation</DialogTitle>
          <DialogDescription>
            Share &ldquo;{conversationTitle}&rdquo; with a read link
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {generatedUrl ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Share Link</label>
                <div className="flex gap-2">
                  <Input type="text" value={generatedUrl} readOnly className="font-mono text-xs" />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyLink}
                    className="flex-shrink-0"
                    aria-label="Copy share link"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
                <p className="mb-1 font-medium">Link created</p>
                <p className="text-xs">{getPermissionDescription(permission)}</p>
              </div>

              <Button type="button" onClick={handleClose} className="w-full">
                Done
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label htmlFor="share-permission" className="text-sm font-medium">
                  Permission Level
                </label>
                <select
                  id="share-permission"
                  value={permission}
                  onChange={(e) => setPermission(e.currentTarget.value as SharePermission)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="VIEW">{getPermissionLabel('VIEW')}</option>
                  <option value="COMMENT">{getPermissionLabel('COMMENT')}</option>
                  <option value="EDIT">{getPermissionLabel('EDIT')}</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {getPermissionDescription(permission)}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="share-expiry" className="text-sm font-medium">
                  Link Expiration
                </label>
                <select
                  id="share-expiry"
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.currentTarget.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <div className="flex gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p className="text-xs">
                    Anyone with the link can access this conversation with the selected
                    permission level
                  </p>
                </div>
              </div>

              {existingShares.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Active links ({existingShares.length})</p>
                  <ul className="space-y-1">
                    {existingShares.map((share) => (
                      <li
                        key={share.id}
                        className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs"
                      >
                        <span className="text-muted-foreground">
                          {getPermissionLabel(share.permissions)}
                          {share.expiresAt
                            ? ` · expires ${new Date(share.expiresAt).toLocaleDateString()}`
                            : ' · never expires'}
                        </span>
                        <button
                          type="button"
                          onClick={() => revokeShare(share.id)}
                          disabled={isRevoking}
                          className="rounded p-1 hover:bg-destructive/10 disabled:opacity-50"
                          aria-label="Revoke share link"
                          title="Revoke this link"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
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
