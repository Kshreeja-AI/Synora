/**
 * ToolExecutor tests: the input form is generated from the tool's JSON
 * Schema (typed fields, required markers), values are coerced to their
 * schema types before hitting the execute mutation, and the full
 * backend ExecutionStatus enum renders truthfully — including the
 * PENDING approval state with its approve/reject controls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToolExecutor } from '../ToolExecutor';
import type { Tool, ToolExecution } from '@/lib/api/tools';

const mockExecuteMutate = vi.fn();
const mockApproveMutate = vi.fn();
const mockRejectMutate = vi.fn();
const mockPreviewMutate = vi.fn();
const mockExecutionData = vi.fn<() => ToolExecution | undefined>();

vi.mock('@/lib/api/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/tools')>();
  return {
    ...actual,
    useExecuteTool: () => ({ mutate: mockExecuteMutate, isPending: false, error: null }),
    useToolExecution: () => ({ data: mockExecutionData() }),
    useApproveExecution: () => ({ mutate: mockApproveMutate, isPending: false, error: null }),
    useRejectExecution: () => ({ mutate: mockRejectMutate, isPending: false, error: null }),
    usePreviewExecution: () => ({ mutate: mockPreviewMutate, isPending: false, error: null }),
  };
});

const tool: Tool = {
  id: 'tool-1',
  workspaceId: 'ws-1',
  name: 'weather-lookup',
  displayName: 'Weather Lookup',
  description: 'Looks up current weather',
  category: 'http',
  type: 'HTTP',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
      days: { type: 'number' },
      detailed: { type: 'boolean' },
    },
    required: ['city'],
  },
  config: { url: 'https://api.example.com/weather' },
  permission: 'WORKSPACE',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

function baseExecution(overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    id: 'exec-1',
    toolId: 'tool-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    input: {},
    status: 'RUNNING',
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

/** Fill the form and submit so the component holds an executionId. */
function submitValidRun() {
  fireEvent.change(screen.getByLabelText(/city/), { target: { value: 'Paris' } });
  fireEvent.click(screen.getByRole('button', { name: /execute tool/i }));
  const options = mockExecuteMutate.mock.calls[0][1];
  act(() => {
    options.onSuccess({ id: 'exec-1' });
  });
}

describe('ToolExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutionData.mockReturnValue(undefined);
  });

  it('renders one field per schema property with required markers', () => {
    render(<ToolExecutor workspaceId="ws-1" tool={tool} />);

    expect(screen.getByLabelText(/city/)).toBeInTheDocument();
    expect(screen.getByLabelText(/days/)).toBeInTheDocument();
    expect(screen.getByLabelText(/detailed/)).toBeInTheDocument();
    expect(screen.getByText('City name')).toBeInTheDocument();
  });

  it('blocks submission when a required field is empty', () => {
    render(<ToolExecutor workspaceId="ws-1" tool={tool} />);

    fireEvent.click(screen.getByRole('button', { name: /execute tool/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('"city" is required');
    expect(mockExecuteMutate).not.toHaveBeenCalled();
  });

  it('coerces values to their schema types before executing', () => {
    render(<ToolExecutor workspaceId="ws-1" tool={tool} conversationId="conv-9" />);

    fireEvent.change(screen.getByLabelText(/city/), { target: { value: 'Paris' } });
    fireEvent.change(screen.getByLabelText(/days/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /execute tool/i }));

    expect(mockExecuteMutate).toHaveBeenCalledWith(
      {
        input: { city: 'Paris', days: 3, detailed: false },
        conversationId: 'conv-9',
      },
      expect.anything()
    );
  });

  it('omits empty optional fields from the payload instead of sending blanks', () => {
    render(<ToolExecutor workspaceId="ws-1" tool={tool} />);

    fireEvent.change(screen.getByLabelText(/city/), { target: { value: 'Paris' } });
    fireEvent.click(screen.getByRole('button', { name: /execute tool/i }));

    const payload = mockExecuteMutate.mock.calls[0][0];
    expect(payload.input).toEqual({ city: 'Paris', detailed: false });
    expect('days' in payload.input).toBe(false);
  });

  it('shows approval controls for a PENDING execution and sends the rejection reason', () => {
    mockExecutionData.mockReturnValue(baseExecution({ status: 'PENDING' }));
    render(<ToolExecutor workspaceId="ws-1" tool={tool} />);
    submitValidRun();

    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockApproveMutate).toHaveBeenCalledWith('exec-1');

    const rejectButton = screen.getByRole('button', { name: 'Reject' });
    expect(rejectButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'Untrusted endpoint' },
    });
    fireEvent.click(rejectButton);
    expect(mockRejectMutate).toHaveBeenCalledWith({
      executionId: 'exec-1',
      reason: 'Untrusted endpoint',
    });
  });

  it('renders COMPLETED output with the upstream HTTP status', () => {
    mockExecutionData.mockReturnValue(
      baseExecution({
        status: 'COMPLETED',
        output: { statusCode: 200, body: { temperature: 21 } },
        duration: 342,
      })
    );
    render(<ToolExecutor workspaceId="ws-1" tool={tool} />);
    submitValidRun();

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('342ms')).toBeInTheDocument();
    expect(screen.getByText(/Output \(HTTP 200\)/)).toBeInTheDocument();
    expect(screen.getByText(/"temperature": 21/)).toBeInTheDocument();
  });

  it('renders FAILED executions with their error', () => {
    mockExecutionData.mockReturnValue(
      baseExecution({ status: 'FAILED', error: 'Tool endpoint responded with HTTP 503' })
    );
    render(<ToolExecutor workspaceId="ws-1" tool={tool} />);
    submitValidRun();

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Tool endpoint responded with HTTP 503')).toBeInTheDocument();
  });
});
