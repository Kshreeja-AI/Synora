'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';

/**
 * Documents — where a piece of writing goes when it stops being a chat
 * message and starts being a thing of its own.
 *
 * Documents are USER-scoped, not workspace-scoped: your documents follow
 * you across workspaces. Filing one into a project (`projectId`) is the
 * bridge back into shared context — the server verifies you can actually
 * see that project before accepting the claim.
 */
export interface Document {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  content: string;
  format: 'MARKDOWN' | 'HTML' | 'PLAIN_TEXT';
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentInput {
  title: string;
  content: string;
  format?: Document['format'];
  projectId?: string;
}

export const DOCUMENTS_KEY = 'documents';

export function useDocuments(options?: { enabled?: boolean }): UseQueryResult<Document[]> {
  return useQuery({
    queryKey: [DOCUMENTS_KEY],
    queryFn: () => api.get<Document[]>('/api/documents'),
    enabled: options?.enabled !== false,
  });
}

export function useDocument(id: string): UseQueryResult<Document> {
  return useQuery({
    queryKey: [DOCUMENTS_KEY, id],
    queryFn: () => api.get<Document>(`/api/documents/${id}`),
    enabled: !!id,
  });
}

export function useCreateDocument(): UseMutationResult<Document, Error, CreateDocumentInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentInput) => api.post<Document>('/api/documents', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DOCUMENTS_KEY] });
    },
  });
}
