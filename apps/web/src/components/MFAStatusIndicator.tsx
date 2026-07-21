'use client';

import { useEffect, useState } from 'react';

interface MFAStatus {
  mfaEnabled: boolean;
  type?: string;
  enabledAt?: string;
  lastUsedAt?: string;
  recoveryCodesRemaining?: number;
  recoveryCodesTotal?: number;
}

interface MFAStatusIndicatorProps {
  compact?: boolean;
  className?: string;
}

export function MFAStatusIndicator({ compact = false, className = '' }: MFAStatusIndicatorProps) {
  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/auth/mfa/status', {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          setStatus(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch MFA status:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStatus();
  }, []);

  if (isLoading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-4 bg-gray-200 rounded w-20"></div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        {status.mfaEnabled ? (
          <>
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-sm font-medium text-green-700">MFA Enabled</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 rounded-full bg-gray-400"></div>
            <span className="text-sm font-medium text-gray-700">MFA Disabled</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow p-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-lg">Two-Factor Authentication</h3>
          <p className="text-gray-600 text-sm mt-1">
            {status.mfaEnabled ? 'Enabled' : 'Not enabled'}
          </p>
        </div>
        {status.mfaEnabled && (
          <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
            Active
          </div>
        )}
      </div>

      {status.mfaEnabled && (
        <div className="mt-4 space-y-2 text-sm">
          {status.type && (
            <div>
              <span className="text-gray-600">Type: </span>
              <span className="font-medium">{status.type}</span>
            </div>
          )}
          {status.enabledAt && (
            <div>
              <span className="text-gray-600">Enabled: </span>
              <span className="font-medium">{new Date(status.enabledAt).toLocaleDateString()}</span>
            </div>
          )}
          {status.lastUsedAt && (
            <div>
              <span className="text-gray-600">Last used: </span>
              <span className="font-medium">{new Date(status.lastUsedAt).toLocaleDateString()}</span>
            </div>
          )}
          {status.recoveryCodesRemaining !== undefined && (
            <div>
              <span className="text-gray-600">Recovery codes: </span>
              <span className="font-medium">
                {status.recoveryCodesRemaining} of {status.recoveryCodesTotal}
              </span>
              {status.recoveryCodesRemaining === 0 && (
                <span className="ml-2 text-red-600 text-xs">(generate new codes)</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
