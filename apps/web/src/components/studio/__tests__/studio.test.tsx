/**
 * Media Studio tests.
 *
 * The behaviours worth pinning are the ones that would otherwise fail
 * silently or mislead the user:
 *   • a 503 (no provider configured on this deployment) must read
 *     differently from a genuine failure — telling someone to "try again"
 *     when an operator has to configure a provider is a lie
 *   • the exact generation payload, since the backend rejects an empty
 *     `voice` string but accepts the field being absent
 *   • in-flight media renders its status instead of a broken <img>/<video>
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import type { GeneratedAudio, GeneratedImage, GeneratedVideo } from '@/lib/api/media';

const listImages = vi.fn();
const listVideos = vi.fn();
const listAudio = vi.fn();
const generateImage = vi.fn();
const generateVideo = vi.fn();
const generateAudio = vi.fn();

vi.mock('@/lib/api/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/media')>('@/lib/api/media');
  return {
    ...actual,
    listImages: () => listImages(),
    listVideos: () => listVideos(),
    listAudio: () => listAudio(),
    getVideo: (id: string) => Promise.resolve({ id } as GeneratedVideo),
    generateImage: (input: unknown) => generateImage(input),
    generateVideo: (input: unknown) => generateVideo(input),
    generateAudio: (input: unknown) => generateAudio(input),
  };
});

vi.mock('@/lib/auth/token-storage', () => ({
  getAccessToken: () => 'test-token',
}));

import { ImageStudio } from '../ImageStudio';
import { VideoStudio } from '../VideoStudio';
import { AudioStudio } from '../AudioStudio';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const baseImage: GeneratedImage = {
  id: 'img-1',
  userId: 'u1',
  projectId: null,
  prompt: 'a red bicycle',
  imageUrl: 'https://cdn.example.com/img-1.png',
  thumbnailUrl: null,
  width: 1024,
  height: 1024,
  model: 'dall-e-3',
  status: 'COMPLETED',
  createdAt: '2026-08-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  listImages.mockResolvedValue([]);
  listVideos.mockResolvedValue([]);
  listAudio.mockResolvedValue([]);
});

describe('ImageStudio', () => {
  it('sends the trimmed prompt and selected size', async () => {
    generateImage.mockResolvedValue(baseImage);
    renderWithClient(<ImageStudio />);

    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: '  a red bicycle  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate image/i }));

    await waitFor(() =>
      expect(generateImage).toHaveBeenCalledWith({ prompt: 'a red bicycle', size: '1024x1024' })
    );
  });

  it('will not submit an empty prompt', () => {
    renderWithClient(<ImageStudio />);
    expect(screen.getByRole('button', { name: /generate image/i })).toBeDisabled();
  });

  it('explains an unconfigured provider rather than offering a retry', async () => {
    generateImage.mockRejectedValue(
      new ApiError(503, { message: 'Image generation is not available: no image provider is configured.' })
    );
    renderWithClient(<ImageStudio />);

    fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: /generate image/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not available on this deployment/i);
    expect(alert).toHaveTextContent(/administrator needs to configure a provider/i);
  });

  it('reports an ordinary failure as a failure', async () => {
    generateImage.mockRejectedValue(new ApiError(500, { message: 'Upstream exploded' }));
    renderWithClient(<ImageStudio />);

    fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: /generate image/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/generation failed/i);
    expect(alert).not.toHaveTextContent(/not available on this deployment/i);
  });

  it('renders a completed image and its prompt as alt text', async () => {
    listImages.mockResolvedValue([baseImage]);
    renderWithClient(<ImageStudio />);

    const img = await screen.findByAltText('a red bicycle');
    expect(img).toHaveAttribute('src', baseImage.imageUrl);
  });

  it('shows status instead of a broken image while still processing', async () => {
    listImages.mockResolvedValue([{ ...baseImage, status: 'PROCESSING', imageUrl: '' }]);
    renderWithClient(<ImageStudio />);

    expect(await screen.findByText(/processing/i)).toBeDefined();
    expect(screen.queryByAltText('a red bicycle')).toBeNull();
  });
});

describe('VideoStudio', () => {
  it('sends prompt, resolution and duration together', async () => {
    generateVideo.mockResolvedValue({ id: 'vid-1', status: 'PROCESSING' } as GeneratedVideo);
    renderWithClient(<VideoStudio />);

    fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: 'a drone shot' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /generate video/i }));

    await waitFor(() =>
      expect(generateVideo).toHaveBeenCalledWith({
        prompt: 'a drone shot',
        size: '1280x720',
        duration: 12,
      })
    );
  });

  it('blocks a duration outside the range the backend accepts', () => {
    renderWithClient(<VideoStudio />);

    fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: 'a drone shot' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '90' } });

    expect(screen.getByRole('button', { name: /generate video/i })).toBeDisabled();
    expect(screen.getByText(/between 1 and 60 seconds/i)).toBeDefined();
    expect(generateVideo).not.toHaveBeenCalled();
  });

  it('tells the user video runs in the background', () => {
    renderWithClient(<VideoStudio />);
    expect(screen.getByText(/run in the background/i)).toBeDefined();
  });
});

describe('AudioStudio', () => {
  const baseAudio: GeneratedAudio = {
    id: 'aud-1',
    userId: 'u1',
    projectId: null,
    prompt: 'hello world',
    audioUrl: 'https://cdn.example.com/aud-1.mp3',
    duration: 3,
    model: 'tts-1',
    status: 'COMPLETED',
    createdAt: '2026-08-01T10:00:00.000Z',
    completedAt: '2026-08-01T10:00:05.000Z',
  };

  it('omits voice entirely when left blank', async () => {
    generateAudio.mockResolvedValue(baseAudio);
    renderWithClient(<AudioStudio />);

    fireEvent.change(screen.getByLabelText(/text to speak/i), {
      target: { value: 'hello world' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate speech/i }));

    // An empty `voice` would be rejected by the backend's min(1) rule.
    await waitFor(() =>
      expect(generateAudio).toHaveBeenCalledWith({ text: 'hello world', format: 'mp3' })
    );
  });

  it('includes voice and format when supplied', async () => {
    generateAudio.mockResolvedValue(baseAudio);
    renderWithClient(<AudioStudio />);

    fireEvent.change(screen.getByLabelText(/text to speak/i), { target: { value: 'hi' } });
    fireEvent.change(screen.getByLabelText(/voice/i), { target: { value: 'nova' } });
    fireEvent.change(screen.getByLabelText(/format/i), { target: { value: 'wav' } });
    fireEvent.click(screen.getByRole('button', { name: /generate speech/i }));

    await waitFor(() =>
      expect(generateAudio).toHaveBeenCalledWith({ text: 'hi', format: 'wav', voice: 'nova' })
    );
  });

  it('surfaces an unconfigured text-to-speech provider distinctly', async () => {
    generateAudio.mockRejectedValue(
      new ApiError(503, { message: 'Text-to-speech is not available: no audio provider is configured.' })
    );
    renderWithClient(<AudioStudio />);

    fireEvent.change(screen.getByLabelText(/text to speak/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /generate speech/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not available on this deployment/i);
  });
});
