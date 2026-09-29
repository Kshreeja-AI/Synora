'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Renders an `otpauth://` URI as an actual scannable QR code image.
 *
 * Generation is entirely local — the `qrcode` package is a pure encoder,
 * no network call, no external service. This matters here specifically:
 * an authenticator secret is exactly the kind of thing that must never
 * leave the browser to get turned into a picture.
 *
 * On failure (or before the image is ready), renders nothing rather than
 * the raw otpauth text — the secret shown alongside this component in
 * `MfaSection` is the real fallback for manual entry, so silently
 * degrading here does not strand anyone.
 */
export function QrCodeImage({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        // Nothing actionable here beyond staying absent — see file doc.
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="animate-pulse rounded-md bg-muted"
        aria-hidden
      />
    );
  }

  return (
    // A locally generated data: URI, not a remote image Next's <Image>
    // optimizer applies to — a plain <img> is the correct tag here.
    <img
      src={dataUrl}
      alt="QR code for your authenticator app"
      width={size}
      height={size}
      className="rounded-md border border-border"
    />
  );
}
