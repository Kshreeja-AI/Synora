'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
  toast,
} from '@synora/design-system';
import { PasswordInput } from '../auth/PasswordInput';
import { QrCodeImage } from './QrCodeImage';
import {
  confirmMfaSetup,
  disableMfa,
  getMfaStatus,
  initiateMfaSetup,
  verifyMfaSetup,
  type MfaSetupInitiation,
  type MfaSetupVerification,
} from '../../lib/api/mfa';
import { ApiError } from '../../lib/api/client';

type EnrollStep =
  | { step: 'idle' }
  | { step: 'scan'; setup: MfaSetupInitiation; code: string }
  | { step: 'recovery'; verification: MfaSetupVerification; acknowledged: boolean };

function errMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Two-factor authentication management for the account settings page:
 * status, the three-step TOTP enrollment wizard (scan secret → prove a code →
 * store recovery codes), and password-confirmed disable.
 */
export function MfaSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [enroll, setEnroll] = useState<EnrollStep>({ step: 'idle' });
  const [error, setError] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);

  const statusQuery = useQuery({ queryKey: ['mfa', 'status'], queryFn: getMfaStatus });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['mfa', 'status'] });
  };

  const initiate = useMutation({
    mutationFn: initiateMfaSetup,
    onSuccess: (setup) => {
      setError('');
      setEnroll({ step: 'scan', setup, code: '' });
    },
    onError: (err: unknown) => setError(errMessage(err, 'Could not start MFA setup.')),
  });

  const verify = useMutation({
    mutationFn: ({ setupToken, code }: { setupToken: string; code: string }) =>
      verifyMfaSetup(setupToken, code),
    onSuccess: (verification) => {
      setError('');
      setEnroll({ step: 'recovery', verification, acknowledged: false });
    },
    onError: (err: unknown) => setError(errMessage(err, 'That code was not accepted.')),
  });

  const confirm = useMutation({
    mutationFn: ({ setupToken, codeHashes }: { setupToken: string; codeHashes: string[] }) =>
      confirmMfaSetup(setupToken, codeHashes),
    onSuccess: () => {
      setError('');
      setEnroll({ step: 'idle' });
      toast.success('Two-factor authentication is now enabled.');
      refresh();
    },
    onError: (err: unknown) => setError(errMessage(err, 'Could not complete MFA setup.')),
  });

  const disable = useMutation({
    mutationFn: () => disableMfa(disablePassword),
    onSuccess: () => {
      setError('');
      setShowDisable(false);
      setDisablePassword('');
      toast.success('Two-factor authentication disabled.');
      refresh();
    },
    onError: (err: unknown) => setError(errMessage(err, 'Could not disable MFA.')),
  });

  if (statusQuery.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    );
  }

  const status = statusQuery.data;
  const enabled = status?.enabled === true;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Two-factor authentication</h2>
          <p className="text-sm text-muted-foreground">
            Adds a second step to sign-in using a time-based code from an authenticator app.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {enabled && enroll.step === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              <span className="font-medium text-success">Enabled</span>
              {status?.status === 'RECOVERY_MODE' && (
                <span className="ml-2 text-warning">
                  (recovery mode — re-enroll with a new device soon)
                </span>
              )}
              {typeof status?.recoveryCodesRemaining === 'number' && (
                <span className="ml-2 text-muted-foreground">
                  {status.recoveryCodesRemaining} of {status.recoveryCodesTotal} recovery codes
                  remaining
                </span>
              )}
            </p>

            {showDisable ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  disable.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-disable-password">Confirm your password to disable</Label>
                  <PasswordInput
                    id="mfa-disable-password"
                    autoComplete="current-password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" size="sm" loading={disable.isPending}>
                    Disable two-factor authentication
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowDisable(false);
                      setDisablePassword('');
                      setError('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setShowDisable(true)}>
                Disable
              </Button>
            )}
          </div>
        )}

        {!enabled && enroll.step === 'idle' && (
          <Button
            variant="primary"
            size="sm"
            loading={initiate.isPending}
            onClick={() => initiate.mutate()}
          >
            Enable two-factor authentication
          </Button>
        )}

        {enroll.step === 'scan' && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              verify.mutate({ setupToken: enroll.setup.setupToken, code: enroll.code.trim() });
            }}
          >
            <p className="text-sm text-foreground">
              Scan this with your authenticator app, then enter the 6-digit code it shows.
            </p>
            <QrCodeImage value={enroll.setup.qrCode} />
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Can&apos;t scan? Enter this key manually:</p>
              <p className="break-all font-mono text-sm text-foreground">{enroll.setup.secret}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mfa-enroll-code">Verification code</Label>
              <Input
                id="mfa-enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={enroll.code}
                onChange={(e) => setEnroll({ ...enroll, code: e.target.value })}
                required
                placeholder="123456"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" loading={verify.isPending}>
                Verify code
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEnroll({ step: 'idle' });
                  setError('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {enroll.step === 'recovery' && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">
              Save these recovery codes now — they are shown only once.
            </p>
            <p className="text-sm text-muted-foreground">
              Each code can sign you in once if you lose access to your authenticator.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm">
              {enroll.verification.recoveryCodes.map((codeValue) => (
                <span key={codeValue}>{codeValue}</span>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={enroll.acknowledged}
                onChange={(e) => setEnroll({ ...enroll, acknowledged: e.target.checked })}
              />
              I have saved my recovery codes somewhere safe.
            </label>
            <Button
              variant="primary"
              size="sm"
              disabled={!enroll.acknowledged}
              loading={confirm.isPending}
              onClick={() =>
                confirm.mutate({
                  setupToken: enroll.verification.setupToken,
                  codeHashes: enroll.verification.codeHashes,
                })
              }
            >
              Finish setup
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
