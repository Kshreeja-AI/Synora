/**
 * The otpauth URI rendered as an actual scannable QR image, not inert
 * text nobody can point a camera at. Generation is local — this test
 * pins that the raw otpauth string is never shown as a substitute.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QrCodeImage } from '../QrCodeImage';
import QRCode from 'qrcode';

vi.mock('qrcode');

// `toDataURL` is overloaded (callback-style void-returning variants plus
// a Promise-returning one); vitest's automock type inference collapses
// overloads unpredictably, so the mock is cast to the one signature this
// component actually calls rather than fought via `vi.mocked()`.
const toDataURL = QRCode.toDataURL as unknown as Mock<
  (text: string, options?: { width?: number; margin?: number }) => Promise<string>
>;

describe('QrCodeImage', () => {
  it('renders the generated image once encoding finishes', async () => {
    toDataURL.mockResolvedValue('data:image/png;base64,abc123');

    render(<QrCodeImage value="otpauth://totp/Synora:user@example.com?secret=ABC" />);

    const img = await screen.findByRole('img', { name: /qr code for your authenticator app/i });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123');
  });

  it('shows a neutral placeholder, never the raw otpauth text, before the image is ready', () => {
    toDataURL.mockReturnValue(new Promise(() => {}));

    const otpauthUri = 'otpauth://totp/Synora:user@example.com?secret=ABC';
    render(<QrCodeImage value={otpauthUri} />);

    // Nobody can scan a raw URI — showing it as a stand-in would be the
    // exact failure this component exists to fix.
    expect(screen.queryByText(otpauthUri)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('encodes the exact value it is given, at the requested size', async () => {
    toDataURL.mockResolvedValue('data:image/png;base64,xyz');
    const uri = 'otpauth://totp/Synora:someone@example.com?secret=SECRET123';

    render(<QrCodeImage value={uri} size={256} />);

    await waitFor(() => expect(toDataURL).toHaveBeenCalledWith(uri, { width: 256, margin: 1 }));
  });

  it('stays neutral rather than showing a broken image if encoding fails', async () => {
    toDataURL.mockRejectedValue(new Error('bad input'));

    render(<QrCodeImage value="not-a-valid-uri" />);

    await waitFor(() => expect(toDataURL).toHaveBeenCalled());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
