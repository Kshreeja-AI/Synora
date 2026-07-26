import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import UsagePage from '../page';
import * as billingApi from '../../../../lib/api/billing';

vi.mock('../../../../lib/api/billing');

describe('UsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders usage analytics dashboard', async () => {
    const mockBalance = { balance: 7500 };
    const mockSummary = {
      text_generation: { quantity: 50, creditsCost: 125 },
      image_generation: { quantity: 10, creditsCost: 500 },
    };
    const mockLedger = [
      { id: '1', type: 'GRANT', amount: 10000, createdAt: new Date().toISOString() },
      { id: '2', type: 'DEDUCTION', amount: -2375, createdAt: new Date().toISOString() },
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary as any);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue(mockLedger as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/available credits/i)).toBeInTheDocument();
    });
  });

  it('displays credit balance card', async () => {
    const mockBalance = { balance: 5000 };

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({} as any);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([] as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/5000/)).toBeInTheDocument();
    });
  });

  it('displays usage breakdown by capability', async () => {
    const mockSummary = {
      text_generation: { quantity: 100, creditsCost: 250 },
      image_generation: { quantity: 5, creditsCost: 500 },
      video_generation: { quantity: 2, creditsCost: 1000 },
    };

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary as any);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([] as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/text generation/i)).toBeInTheDocument();
      expect(screen.getByText(/image generation/i)).toBeInTheDocument();
      expect(screen.getByText(/video generation/i)).toBeInTheDocument();
    });
  });

  it('displays usage percentages', async () => {
    const mockSummary = {
      text_generation: { quantity: 100, creditsCost: 1000 },
      image_generation: { quantity: 50, creditsCost: 1000 },
    };

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary as any);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([] as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });
  });

  it('displays credit ledger table', async () => {
    const mockLedger = [
      {
        id: '1',
        type: 'GRANT',
        amount: 10000,
        reason: 'Monthly subscription',
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'DEDUCTION',
        amount: -250,
        reason: 'Text generation',
        createdAt: new Date().toISOString(),
      },
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({} as any);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue(mockLedger as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/monthly subscription/i)).toBeInTheDocument();
      expect(screen.getByText(/text generation/i)).toBeInTheDocument();
    });
  });

  it('displays ledger entry types', async () => {
    const mockLedger = [
      { id: '1', type: 'GRANT', amount: 5000, createdAt: new Date().toISOString() },
      { id: '2', type: 'DEDUCTION', amount: -100, createdAt: new Date().toISOString() },
      { id: '3', type: 'ADJUSTMENT', amount: -50, createdAt: new Date().toISOString() },
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({} as any);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue(mockLedger as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/grant/i)).toBeInTheDocument();
      expect(screen.getByText(/adjustment/i)).toBeInTheDocument();
    });
  });

  it('handles empty usage', async () => {
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({} as any);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([] as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/no usage yet/i)).toBeInTheDocument();
    });
  });

  it('displays loading state', () => {
    vi.mocked(billingApi.getCreditBalance).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<UsagePage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows usage summary cards', async () => {
    const mockBalance = { balance: 7500 };

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance as any);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(
      {
        text_generation: { quantity: 100, creditsCost: 250 },
      } as any
    );
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([] as any);

    render(<UsagePage />);

    await waitFor(() => {
      expect(screen.getByText(/available credits/i)).toBeInTheDocument();
      expect(screen.getByText(/total used/i)).toBeInTheDocument();
    });
  });
});
