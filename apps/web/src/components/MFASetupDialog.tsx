'use client';

import { useState } from 'react';
import { useMFASetup } from '@/hooks/useMFASetup';
import QRCode from 'qrcode.react';

interface MFASetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export function MFASetupDialog({ isOpen, onClose, onComplete }: MFASetupDialogProps) {
  const mfa = useMFASetup();
  const [verificationCode, setVerificationCode] = useState('');
  const [copiedCode, setCopiedCode] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleInitiate = async () => {
    await mfa.initiate();
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    await mfa.verifyCode(verificationCode);
    setVerificationCode('');
  };

  const handleConfirm = async () => {
    await mfa.confirm();
    if (mfa.step === 'complete') {
      onComplete?.();
      setTimeout(onClose, 1500);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(index);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleClose = () => {
    mfa.reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b p-6 flex justify-between items-center">
          <h2 className="text-2xl font-bold">Enable Two-Factor Authentication</h2>
          <button
            onClick={handleClose}
            disabled={mfa.isLoading}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Error State */}
          {mfa.step === 'error' && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded">
              <p className="text-red-800 font-medium">Setup Failed</p>
              <p className="text-red-700 text-sm mt-1">{mfa.error || 'An error occurred'}</p>
              <button
                onClick={() => mfa.reset()}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Step 1: Initiate */}
          {mfa.step === 'idle' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded p-4">
                <p className="text-blue-900">
                  Two-factor authentication adds an extra layer of security to your account. You'll need
                  to enter a code from your authenticator app in addition to your password when signing in.
                </p>
              </div>
              <button
                onClick={handleInitiate}
                disabled={mfa.isLoading}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {mfa.isLoading ? 'Starting...' : 'Start Setup'}
              </button>
            </div>
          )}

          {(mfa.step === 'initiating' || mfa.step === 'qr-ready') && (
            <div className="space-y-6">
              {mfa.isLoading && <div className="text-center">Loading...</div>}

              {mfa.qrCode && (
                <div>
                  <h3 className="font-bold mb-4">Step 1: Scan QR Code</h3>
                  <p className="text-gray-600 text-sm mb-4">
                    Use an authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.)
                    to scan this QR code:
                  </p>
                  <div className="flex justify-center mb-4">
                    <div className="p-4 bg-white border">
                      <QRCode value={mfa.qrCode} size={256} />
                    </div>
                  </div>
                  {mfa.secret && (
                    <div>
                      <p className="text-gray-600 text-sm mb-2">Or enter this code manually:</p>
                      <code className="block p-3 bg-gray-100 rounded font-mono text-center break-all">
                        {mfa.secret}
                      </code>
                    </div>
                  )}
                </div>
              )}

              {mfa.step === 'qr-ready' && (
                <form onSubmit={handleVerifyCode} className="space-y-4">
                  <div>
                    <h3 className="font-bold mb-4">Step 2: Enter Verification Code</h3>
                    <p className="text-gray-600 text-sm mb-4">
                      Enter the 6-digit code from your authenticator app:
                    </p>
                    <input
                      type="text"
                      placeholder="000000"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      disabled={mfa.isLoading}
                      className="w-full px-4 py-2 border rounded text-center font-mono text-2xl tracking-widest disabled:opacity-50"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={verificationCode.length !== 6 || mfa.isLoading}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    {mfa.isLoading ? 'Verifying...' : 'Verify Code'}
                  </button>
                </form>
              )}
            </div>
          )}

          {mfa.step === 'verifying' && (
            <div className="text-center">
              <div className="inline-block animate-spin">⏳</div>
              <p className="mt-2">Verifying code...</p>
            </div>
          )}

          {/* Step 3: Recovery Codes */}
          {mfa.step === 'confirming' && mfa.recoveryCodes && (
            <div className="space-y-6">
              <div>
                <h3 className="font-bold mb-4">Step 3: Save Recovery Codes</h3>
                <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
                  <p className="text-yellow-900 text-sm">
                    <strong>Important:</strong> Save these recovery codes in a safe place. If you lose
                    access to your authenticator app, you can use these codes to regain access to your
                    account.
                  </p>
                </div>

                <div className="bg-gray-50 rounded p-4 space-y-2">
                  {mfa.recoveryCodes.map((code, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 hover:bg-gray-100 rounded"
                    >
                      <code className="font-mono">{code}</code>
                      <button
                        onClick={() => copyToClipboard(code, index)}
                        type="button"
                        className="text-sm px-2 py-1 bg-white border rounded hover:bg-gray-200"
                      >
                        {copiedCode === index ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    const allCodes = mfa.recoveryCodes?.join('\n');
                    const element = document.createElement('a');
                    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(allCodes || '')}`);
                    element.setAttribute('download', 'mfa-recovery-codes.txt');
                    element.style.display = 'none';
                    document.body.appendChild(element);
                    element.click();
                    document.body.removeChild(element);
                  }}
                  type="button"
                  className="w-full mt-4 px-4 py-2 border rounded hover:bg-gray-100"
                >
                  Download Recovery Codes
                </button>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => mfa.reset()}
                  className="flex-1 px-4 py-2 border rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={mfa.isLoading}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {mfa.isLoading ? 'Confirming...' : 'I Have Saved My Codes'}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {mfa.step === 'complete' && (
            <div className="text-center space-y-4">
              <div className="text-6xl">✓</div>
              <h3 className="text-2xl font-bold text-green-600">Setup Complete!</h3>
              <p className="text-gray-600">
                Two-factor authentication has been successfully enabled on your account.
              </p>
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
