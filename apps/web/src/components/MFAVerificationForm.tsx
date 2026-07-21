'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface MFAVerificationFormProps {
  mfaChallengeToken: string;
  email?: string;
}

export function MFAVerificationForm({ mfaChallengeToken, email }: MFAVerificationFormProps) {
  const router = useRouter();
  const [verificationCode, setVerificationCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/auth/mfa/verify', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mfaChallengeToken,
          ...(useRecoveryCode ? { recoveryCode } : { code: verificationCode }),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'MFA verification failed');
      }

      const data = await response.json();

      // Show warning if recovery code was used
      if (data.data?.warning) {
        // Could show a warning toast here
        console.warn(data.data.warning);
      }

      // Redirect to dashboard or wherever appropriate
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Verify Your Identity</h2>
        {email && <p className="text-gray-600">{email}</p>}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-red-800 font-medium">Verification Failed</p>
          <p className="text-red-700 text-sm mt-1">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {!useRecoveryCode ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium mb-2">
                Enter the 6-digit code from your authenticator app
              </label>
              <input
                id="code"
                type="text"
                placeholder="000000"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                disabled={isLoading}
                className="w-full px-4 py-3 border rounded text-center font-mono text-2xl tracking-widest disabled:opacity-50"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={verificationCode.length !== 6 || isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {isLoading ? 'Verifying...' : 'Verify Code'}
            </button>

            <button
              type="button"
              onClick={() => setUseRecoveryCode(true)}
              className="w-full text-blue-600 hover:text-blue-700 text-sm"
            >
              I don't have access to my authenticator app
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="recovery-code" className="block text-sm font-medium mb-2">
                Enter one of your recovery codes
              </label>
              <p className="text-gray-600 text-sm mb-3">
                This will use one of your backup codes to verify your identity.
              </p>
              <input
                id="recovery-code"
                type="text"
                placeholder="XXXX-XXXX"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))}
                maxLength={9}
                disabled={isLoading}
                className="w-full px-4 py-3 border rounded font-mono text-lg disabled:opacity-50"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={recoveryCode.length !== 9 || isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {isLoading ? 'Verifying...' : 'Use Recovery Code'}
            </button>

            <button
              type="button"
              onClick={() => {
                setUseRecoveryCode(false);
                setRecoveryCode('');
              }}
              className="w-full text-blue-600 hover:text-blue-700 text-sm"
            >
              Use authenticator code instead
            </button>
          </div>
        )}
      </form>

      <div className="text-center">
        <p className="text-gray-600 text-sm">
          Lost access to your account?{' '}
          <a href="/account-recovery" className="text-blue-600 hover:text-blue-700">
            Account Recovery
          </a>
        </p>
      </div>
    </div>
  );
}
