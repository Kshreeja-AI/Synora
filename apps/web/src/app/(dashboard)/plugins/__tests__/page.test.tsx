/**
 * Plugins page tests.
 *
 * The assertions here are about expectation-setting. A user who believes
 * plugins run code will install something expecting behaviour it cannot
 * have, so the page says otherwise plainly. A disabled plugin must not
 * look like it still holds its permissions, because the switch would then
 * be decorative. And because a plugin can now contribute a tool that
 * contacts a host the publisher chose, the destinations have to be on
 * screen BEFORE the install button exists — disclosure afterwards is
 * being informed, not being asked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PluginsPage from '../page';
import * as pluginsApi from '@/lib/api/plugins';
import type { InstalledPlugin } from '@/lib/api/plugins';

vi.mock('@/hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: () => ({ currentWorkspace: { id: 'ws_1', name: 'Test Co' } }),
}));

vi.mock('@/lib/api/plugins', async () => {
  const actual = await vi.importActual<typeof pluginsApi>('@/lib/api/plugins');
  return {
    ...actual,
    usePlugins: vi.fn(),
    usePreviewPlugin: vi.fn(),
    useInstallPlugin: vi.fn(),
    useSetPluginEnabled: vi.fn(),
    useUninstallPlugin: vi.fn(),
  };
});

/** What the server reports a tool-contributing manifest would do. */
const preview = {
  id: 'acme.crm',
  name: 'Acme CRM',
  version: '2.1.0',
  publisher: 'acme',
  permissions: ['tools:contribute'],
  templates: [],
  tools: [
    {
      name: 'acme.crm/create-lead',
      displayName: 'Create a lead',
      description: 'Files a lead in Acme CRM.',
      type: 'HTTP',
      url: 'https://api.acme-crm.example/v1/leads',
    },
  ],
  hosts: ['api.acme-crm.example'],
};

const plugin: InstalledPlugin = {
  id: 'ws_1::acme.summariser',
  workspaceId: 'ws_1',
  manifest: {
    id: 'acme.summariser',
    name: 'Summariser',
    version: '1.0.0',
    description: 'Adds a summarising template.',
    publisher: 'acme',
    permissions: ['templates:contribute'],
    contributions: { templates: [] },
  },
  state: 'enabled',
  grantedPermissions: ['templates:contribute'],
  installedBy: 'u1',
  installedAt: 1,
  updatedAt: 1,
};

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PluginsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(pluginsApi.usePlugins).mockReturnValue({
    data: {
      installed: [plugin],
      grantablePermissions: ['templates:contribute', 'workspace:read'],
      unavailablePermissions: ['code:execute', 'network:outbound'],
    },
    isLoading: false,
  } as never);
  vi.mocked(pluginsApi.usePreviewPlugin).mockReturnValue(idle() as never);
  vi.mocked(pluginsApi.useInstallPlugin).mockReturnValue(idle() as never);
  vi.mocked(pluginsApi.useSetPluginEnabled).mockReturnValue(idle() as never);
  vi.mocked(pluginsApi.useUninstallPlugin).mockReturnValue(idle() as never);
});

/** Open the paste box and put a manifest in it. */
async function paste(user: ReturnType<typeof userEvent.setup>, text = '{{"id":"a.b"}') {
  await user.click(screen.getByRole('button', { name: /install from manifest/i }));
  await user.type(screen.getByLabelText(/manifest \(json\)/i), text);
}

/** Mocks a preview that succeeds with the given report. */
function previewReturns(report: unknown) {
  vi.mocked(pluginsApi.usePreviewPlugin).mockReturnValue(
    idle({ mutate: vi.fn((_v, opts) => opts?.onSuccess?.(report)) }) as never,
  );
}

describe('plugins page', () => {
  it('says plainly that plugins do not run code, and why', () => {
    renderPage();
    expect(screen.getByText('Plugins do not run code')).toBeInTheDocument();
    // The reason matters as much as the fact: it explains what would have
    // to exist first, rather than reading as an arbitrary restriction.
    expect(screen.getByText(/isolated runtime that does not exist yet/)).toBeInTheDocument();
  });

  it('shows what a plugin was granted', () => {
    renderPage();
    expect(screen.getByText(/Granted: templates:contribute/)).toBeInTheDocument();
  });

  it('says a disabled plugin holds none of its permissions', () => {
    vi.mocked(pluginsApi.usePlugins).mockReturnValue({
      data: {
        installed: [{ ...plugin, state: 'disabled' }],
        grantablePermissions: [],
        unavailablePermissions: [],
      },
      isLoading: false,
    } as never);

    renderPage();
    // Otherwise the record reads as "still granted" and the toggle looks
    // cosmetic.
    expect(screen.getByText(/none of which apply while it is disabled/)).toBeInTheDocument();
  });

  it('disables an enabled plugin', async () => {
    const user = userEvent.setup();
    const setEnabled = vi.fn();
    vi.mocked(pluginsApi.useSetPluginEnabled).mockReturnValue(
      idle({ mutate: setEnabled }) as never,
    );

    renderPage();
    await user.click(screen.getByRole('button', { name: /disable plugin/i }));

    expect(setEnabled).toHaveBeenCalledWith(
      { pluginId: 'acme.summariser', enabled: false },
      expect.anything(),
    );
  });

  it('uninstalls', async () => {
    const user = userEvent.setup();
    const uninstall = vi.fn();
    vi.mocked(pluginsApi.useUninstallPlugin).mockReturnValue(idle({ mutate: uninstall }) as never);

    renderPage();
    await user.click(screen.getByRole('button', { name: /uninstall plugin/i }));

    expect(uninstall).toHaveBeenCalledWith('acme.summariser', expect.anything());
  });

  it('rejects text that is not JSON before troubling the server', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    const toastError = vi.spyOn(toast, 'error');
    const previewFn = vi.fn();
    vi.mocked(pluginsApi.usePreviewPlugin).mockReturnValue(idle({ mutate: previewFn }) as never);

    renderPage();
    await paste(user, 'not json');
    await user.click(screen.getByRole('button', { name: /review manifest/i }));

    // A different problem from a server refusal, and named as such.
    expect(toastError).toHaveBeenCalledWith('That is not valid JSON');
    expect(previewFn).not.toHaveBeenCalled();
  });

  it('surfaces the server\'s refusal verbatim, at review rather than after installing', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    const toastError = vi.spyOn(toast, 'error');
    vi.mocked(pluginsApi.usePreviewPlugin).mockReturnValue(
      idle({
        mutate: vi.fn((_v, opts) =>
          opts?.onError?.(
            new Error('this plugin wants to run code, which Synora cannot do safely yet'),
          ),
        ),
      }) as never,
    );

    renderPage();
    await paste(user);
    await user.click(screen.getByRole('button', { name: /review manifest/i }));

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot do safely yet'));
    // Refused before anyone agreed to anything, so there is nothing to
    // press.
    expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
  });

  describe('reviewing before installing', () => {
    it('names the hosts a plugin will contact before offering to install it', async () => {
      const user = userEvent.setup();
      previewReturns(preview);

      renderPage();
      await paste(user);
      await user.click(screen.getByRole('button', { name: /review manifest/i }));

      // The host is the part a person can actually judge. "Contributes 1
      // tool" is not something anyone can consent to. It appears twice on
      // purpose — the exact URL on the tool, and the host in the summary.
      expect(screen.getAllByText(/api\.acme-crm\.example/).length).toBeGreaterThan(1);
      expect(screen.getByText(/Create a lead/)).toBeInTheDocument();
      expect(screen.getByText(/send requests when used/)).toBeInTheDocument();
      // And that the publisher cannot waive the approval on their own tool.
      expect(screen.getByText(/a plugin cannot waive that/)).toBeInTheDocument();

      // Only now is there something to press.
      expect(screen.getByRole('button', { name: /^install$/i })).toBeInTheDocument();
    });

    it('makes an edited manifest be reviewed again', async () => {
      const user = userEvent.setup();
      previewReturns(preview);

      renderPage();
      await paste(user);
      await user.click(screen.getByRole('button', { name: /review manifest/i }));
      expect(screen.getByRole('button', { name: /^install$/i })).toBeInTheDocument();

      await user.type(screen.getByLabelText(/manifest \(json\)/i), ' ');

      // Otherwise someone could agree to one manifest and install another.
      expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /review manifest/i })).toBeInTheDocument();
    });

    it('reports tools that could not be added instead of claiming a clean install', async () => {
      const user = userEvent.setup();
      const { toast } = await import('sonner');
      const toastWarning = vi.spyOn(toast, 'warning');
      previewReturns(preview);
      vi.mocked(pluginsApi.useInstallPlugin).mockReturnValue(
        idle({
          mutate: vi.fn((_v, opts) =>
            opts?.onSuccess?.({
              tools: {
                active: [],
                deactivated: [],
                skipped: [
                  {
                    name: 'acme.crm/create-lead',
                    reason: 'a different tool already uses this name in this workspace',
                  },
                ],
              },
            }),
          ),
        }) as never,
      );

      renderPage();
      await paste(user);
      await user.click(screen.getByRole('button', { name: /review manifest/i }));
      await user.click(screen.getByRole('button', { name: /^install$/i }));

      // A plugin that contributed none of its tools must not report
      // success as though it had.
      expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('already uses this name'));
    });
  });

  it('shows an empty state before anything is installed', () => {
    vi.mocked(pluginsApi.usePlugins).mockReturnValue({
      data: { installed: [], grantablePermissions: [], unavailablePermissions: [] },
      isLoading: false,
    } as never);

    renderPage();
    expect(screen.getByText('No plugins installed')).toBeInTheDocument();
  });
});
