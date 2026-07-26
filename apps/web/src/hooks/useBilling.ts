'use client';

import { useQuery, useMutation, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query';
import {
  listPlans,
  getSubscription,
  getCreditBalance,
  listCreditLedger,
  getUsageSummary,
  listInvoices,
  changePlan,
  cancelSubscription,
  reactivateSubscription,
  createCheckoutSession,
} from '../lib/api/billing';
import type {
  Plan,
  Subscription,
  WorkspaceCredits,
  CreditLedgerEntry,
  Invoice,
} from '../lib/api/types';
import { getAccessToken } from '../lib/auth/token-storage';

export function usePlans(): UseQueryResult<Plan[]> {
  return useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listPlans,
    enabled: Boolean(getAccessToken()),
  });
}

export function useSubscription(workspaceId: string): UseQueryResult<Subscription> {
  return useQuery({
    queryKey: ['billing', 'subscription', workspaceId],
    queryFn: () => getSubscription(workspaceId),
    enabled: Boolean(getAccessToken() && workspaceId),
  });
}

export function useCreditBalance(workspaceId: string): UseQueryResult<WorkspaceCredits> {
  return useQuery({
    queryKey: ['billing', 'credits', workspaceId],
    queryFn: () => getCreditBalance(workspaceId),
    enabled: Boolean(getAccessToken() && workspaceId),
  });
}

export function useCreditLedger(workspaceId: string): UseQueryResult<CreditLedgerEntry[]> {
  return useQuery({
    queryKey: ['billing', 'creditLedger', workspaceId],
    queryFn: () => listCreditLedger(workspaceId),
    enabled: Boolean(getAccessToken() && workspaceId),
  });
}

export function useUsageSummary(workspaceId: string): UseQueryResult<Record<string, { quantity: number; creditsCost: number }>> {
  return useQuery({
    queryKey: ['billing', 'usage', workspaceId],
    queryFn: () => getUsageSummary(workspaceId),
    enabled: Boolean(getAccessToken() && workspaceId),
  });
}

export function useInvoices(workspaceId: string): UseQueryResult<Invoice[]> {
  return useQuery({
    queryKey: ['billing', 'invoices', workspaceId],
    queryFn: () => listInvoices(workspaceId),
    enabled: Boolean(getAccessToken() && workspaceId),
  });
}

export function useChangePlan(workspaceId: string): UseMutationResult<Subscription, Error, { planId: string }> {
  return useMutation({
    mutationFn: (input) => changePlan(workspaceId, input),
  });
}

export function useCancelSubscription(workspaceId: string): UseMutationResult<Subscription, Error, { atPeriodEnd: boolean }> {
  return useMutation({
    mutationFn: (input) => cancelSubscription(workspaceId, input),
  });
}

export function useReactivateSubscription(workspaceId: string): UseMutationResult<Subscription, Error, void> {
  return useMutation({
    mutationFn: () => reactivateSubscription(workspaceId),
  });
}

export function useCreateCheckoutSession(workspaceId: string): UseMutationResult<{ url: string; sessionId: string }, Error, { planId: string; successUrl: string; cancelUrl: string }> {
  return useMutation({
    mutationFn: (input) => createCheckoutSession(workspaceId, input),
  });
}
