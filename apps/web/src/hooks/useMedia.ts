'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  listImages,
  listVideos,
  listAudio,
  getVideo,
  generateImage,
  generateVideo,
  generateAudio,
  isTerminal,
  type GeneratedImage,
  type GeneratedVideo,
  type GeneratedAudio,
  type GenerateImageInput,
  type GenerateVideoInput,
  type GenerateAudioInput,
} from '../lib/api/media';
import { ApiError } from '../lib/api/client';
import { getAccessToken } from '../lib/auth/token-storage';

/** Poll cadence for in-flight video jobs. */
const VIDEO_POLL_INTERVAL_MS = 4000;

export function useImages(): UseQueryResult<GeneratedImage[]> {
  return useQuery({
    queryKey: ['media', 'images'],
    queryFn: listImages,
    enabled: Boolean(getAccessToken()),
  });
}

export function useVideos(): UseQueryResult<GeneratedVideo[]> {
  return useQuery({
    queryKey: ['media', 'videos'],
    queryFn: listVideos,
    enabled: Boolean(getAccessToken()),
    // Video generation finishes in a worker, so the list has to re-check
    // itself while anything on it is still running. Once every job is
    // terminal the interval returns false and polling stops.
    refetchInterval: (query) => {
      const videos = query.state.data;
      if (!videos || videos.length === 0) return false;
      return videos.some((video) => !isTerminal(video.status)) ? VIDEO_POLL_INTERVAL_MS : false;
    },
  });
}

/** Polls a single video until it reaches a terminal status. */
export function useVideoJob(id: string | undefined): UseQueryResult<GeneratedVideo> {
  return useQuery({
    queryKey: ['media', 'videos', id],
    queryFn: () => getVideo(id!),
    enabled: Boolean(getAccessToken() && id),
    refetchInterval: (query) => {
      const video = query.state.data;
      if (!video) return VIDEO_POLL_INTERVAL_MS;
      return isTerminal(video.status) ? false : VIDEO_POLL_INTERVAL_MS;
    },
  });
}

export function useAudioClips(): UseQueryResult<GeneratedAudio[]> {
  return useQuery({
    queryKey: ['media', 'audio'],
    queryFn: listAudio,
    enabled: Boolean(getAccessToken()),
  });
}

export function useGenerateImage(): UseMutationResult<
  GeneratedImage,
  ApiError,
  GenerateImageInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'images'] });
    },
  });
}

export function useGenerateVideo(): UseMutationResult<
  GeneratedVideo,
  ApiError,
  GenerateVideoInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateVideo,
    onSuccess: () => {
      // Returns 202 with a PROCESSING row; the list query picks up the
      // running job and polls it from here.
      queryClient.invalidateQueries({ queryKey: ['media', 'videos'] });
    },
  });
}

export function useGenerateAudio(): UseMutationResult<
  GeneratedAudio,
  ApiError,
  GenerateAudioInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateAudio,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'audio'] });
    },
  });
}

/**
 * Distinguishes "this deployment has no provider for that medium" (503) from
 * an ordinary failure. The studio tells the user which of the two happened
 * instead of showing one generic error for both.
 */
export function isProviderUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}
