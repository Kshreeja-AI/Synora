'use client';

import { useState, useEffect } from 'react';
import { MFASetupDialog } from './MFASetupDialog';

interface MFAStatus {
  mfaEnabled: boolean;
  type?: string;
  status?: string;
  enabledAt?: string;
  lastUsedAt?: string;
  recoveryCodesRemaining?: number;
  recoveryCodesTotal?: number;
}

interface RecoveryCode {
  prefix: string;
  usedAt: string | null;
}

export function MFAManagementPanel() {
  const [mfaStatus, setMfaStatus] = useState<MFAStatus | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<RecoveryCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [disableConfirmation, setDisableConfirmation] = useState(false);
  const [password, setPassword] = useState('');
  const [isDisabling, setIsDisabling] = useState(false);

  const fetchMFAStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/auth/mfa/status', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch MFA status');
      }

      const data = await response.json();
      setMfaStatus(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch MFA status');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRecoveryCodes = async () => {
    try {
      const response = await fetch('/auth/mfa/recovery-codes', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch recovery codes');
      }

      const data = await response.json();
      setRecoveryCodes(data.data.codes || []);
    } catch (err) {
      console.error('Failed to fetch recovery codes:', err);
    }
  };

  useEffect(() => {
    fetchMFAStatus();
  }, []);

  useEffect(() => {
    if (mfaStatus?.mfaEnabled) {
      fetchRecoveryCodes();
    }
  }, [mfaStatus?.mfaEnabled]);

  const handleMFASetupComplete = () => {
    setShowSetupDialog(false);
    fetchMFAStatus();
    fetchRecoveryCodes();
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDisabling(true);

    try {
      const response = await fetch('/auth/mfa/disable', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to disable MFA');
      }

      setDisableConfirmation(false);
      setPassword('');
      fetchMFAStatus();
      setRecoveryCodes([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable MFA');
    } finally {
      setIsDisabling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MFASetupDialog
        isOpen={showSetupDialog}
        onClose={() => setShowSetupDialog(false)}
        onComplete={handleMFASetupComplete}
      />

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold">Two-Factor Authentication</h2>
            <p className="text-gray-600 mt-1">Add extra security to your account</p>
          </div>
          {mfaStatus?.mfaEnabled && (
            <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              Enabled
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded">
            <p className="text-red-800 font-medium">Error</p>
            <p className="text-red-700 text-sm mt-1">{error}</p>
          </div>
        )}

        {!mfaStatus?.mfaEnabled ? (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <p className="text-blue-900">
                Two-factor authentication adds an extra layer of security to your account. We recommend
                enabling it to protect your data.
              </p>
            </div>

            <button
              onClick={() => setShowSetupDialog(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
            >
              Enable Two-Factor Authentication
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded">
                <p className="text-gray-600 text-sm">Type</p>
                <p className="text-lg font-medium">{mfaStatus.type || 'TOTP'}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded">
                <p className="text-gray-600 text-sm">Status</p>
                <p className="text-lg font-medium">{mfaStatus.status || 'Active'}</p>
              </div>
              {mfaStatus.enabledAt && (
                <div className="p-4 bg-gray-50 rounded">
                  <p className="text-gray-600 text-sm">Enabled</p>
                  <p className="text-lg font-medium">
                    {new Date(mfaStatus.enabledAt).toLocaleDateString()}
                  </p>
                </div>
              )}
              {mfaStatus.lastUsedAt && (
                <div className="p-4 bg-gray-50 rounded">
                  <p className="text-gray-600 text-sm">Last Used</p>
                  <p className="text-lg font-medium">
                    {new Date(mfaStatus.lastUsedAt).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>

            {/* Recovery Codes */}
            {recoveryCodes.length > 0 && (
              <div>
                <h3 className="font-bold mb-3">Recovery Codes</h3>
                <p className="text-gray-600 text-sm mb-3">
                  {mfaStatus.recoveryCodesRemaining} of {mfaStatus.recoveryCodesTotal} codes remaining
                </p>
                <div className="grid gap-2 max-h-64 overflow-y-auto">
                  {recoveryCodes.map((code, index) => (
                    <div
                      key={index}
                      className={`p-2 rounded text-sm font-mono flex items-center justify-between ${
                        code.usedAt ? 'bg-gray-100 line-through text-gray-600' : 'bg-gray-50'
                      }`}
                    >
                      <span>{code.prefix}***</span>
                      {code.usedAt && <span className="text-xs text-gray-500">Used</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <button
                onClick={() => setShowSetupDialog(true)}
                className="px-4 py-2 border rounded hover:bg-gray-50 font-medium"
              >
                Replace Authenticator
              </button>
              <button
                onClick={() => setDisableConfirmation(true)}
                className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 font-medium"
              >
                Disable MFA
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Disable Confirmation Modal */}
      {disableConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Disable Two-Factor Authentication?</h3>

            <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-6">
              <p className="text-yellow-900 text-sm">
                Disabling two-factor authentication makes your account less secure. Are you sure?
              </p>
            </div>

            <form onSubmit={handleDisable} className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium mb-2">
                  Enter your password to confirm
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isDisabling}
                  className="w-full px-4 py-2 border rounded disabled:opacity-50"
                  required
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDisableConfirmation(false);
                    setPassword('');
                  }}
                  disabled={isDisabling}
                  className="flex-1 px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!password || isDisabling}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {isDisabling ? 'Disabling...' : 'Disable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
