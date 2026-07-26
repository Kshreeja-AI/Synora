'use client';

import { useEffect } from 'react';

/**
 * Replaces the entire root layout when the layout itself crashes, so it
 * cannot depend on the design-system's CSS bundle or fonts having loaded —
 * everything here is inline and self-contained on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#09090b',
          color: '#fafafa',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went seriously wrong</h1>
          <p style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 20 }}>
            Synora hit an unrecoverable error. Reloading usually fixes this.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              backgroundColor: '#fafafa',
              color: '#09090b',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
