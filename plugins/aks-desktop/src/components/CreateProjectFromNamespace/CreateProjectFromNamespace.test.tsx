// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks (must be defined before imports that use them) ---
const mockPush = vi.fn();
vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockPush }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (!params) return key;
      let result = key;
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      }
      return result;
    },
  }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  PageGrid: ({ children }: any) => <div data-testid="page-grid">{children}</div>,
  SectionBox: ({ children, title, subtitle }: any) => (
    <div data-testid="section-box" data-title={title}>
      {title && <h1>{title}</h1>}
      {subtitle && <p>{subtitle}</p>}
      {children}
    </div>
  ),
}));

const mockUseNamespaceDiscovery = vi.fn();
vi.mock('../../hooks/useNamespaceDiscovery', () => ({
  useNamespaceDiscovery: () => mockUseNamespaceDiscovery(),
}));

const mockUseRegisteredClusters = vi.fn();
vi.mock('../../hooks/useRegisteredClusters', () => ({
  useRegisteredClusters: () => mockUseRegisteredClusters(),
}));

const mockRegisterAKSCluster = vi.fn();
vi.mock('../../utils/azure/aks', () => ({
  registerAKSCluster: (...args: any[]) => mockRegisterAKSCluster(...args),
}));

const mockApplyProjectLabels = vi.fn();
vi.mock('../../utils/kubernetes/namespaceUtils', () => ({
  applyProjectLabels: (...args: any[]) => mockApplyProjectLabels(...args),
}));

const mockUpdateManagedNamespace = vi.fn();
vi.mock('../../utils/azure/az-cli', () => ({
  updateManagedNamespace: (...args: any[]) => mockUpdateManagedNamespace(...args),
  checkAzureCliAndAksPreview: () => Promise.resolve({ suggestions: [] }),
}));

const mockAssignRolesToNamespace = vi.fn();
vi.mock('../../utils/azure/roleAssignment', () => ({
  assignRolesToNamespace: (...args: any[]) => mockAssignRolesToNamespace(...args),
}));

vi.mock('../../utils/shared/clusterSettings', () => ({
  getClusterSettings: () => ({ allowedNamespaces: [] }),
  setClusterSettings: vi.fn(),
}));

vi.mock('../../utils/azure/checkAzureCli', () => ({
  checkAzureCliAndAksPreview: () => Promise.resolve({ suggestions: [] }),
}));

const mockExtensionStatus = {
  installed: true,
  installing: false,
  error: null,
  showSuccess: false,
  checkExtension: vi.fn(),
  installExtension: vi.fn(),
  clearError: vi.fn(),
};
vi.mock('../CreateAKSProject/hooks/useExtensionCheck', () => ({
  useExtensionCheck: () => mockExtensionStatus,
}));

vi.mock('../CreateAKSProject/hooks/useFormData', async () => {
  const { useState } = await import('react');
  return {
    useFormData: () => {
      const [formData, setFormData] = useState({
        projectName: '',
        description: '',
        subscription: '',
        cluster: '',
        resourceGroup: '',
        ingress: 'AllowSameNamespace',
        egress: 'AllowAll',
        cpuRequest: 2000,
        memoryRequest: 4096,
        cpuLimit: 2000,
        memoryLimit: 4096,
        userAssignments: [{ email: '', role: 'Writer' }],
      });
      return {
        formData,
        updateFormData: (updates: any) => setFormData((prev: any) => ({ ...prev, ...updates })),
      };
    },
  };
});

vi.mock('../CreateAKSProject/components/Breadcrumb', () => ({
  Breadcrumb: ({ steps, activeStep }: any) => (
    <div data-testid="breadcrumb" data-active-step={activeStep}>
      {steps.map((s: string, i: number) => (
        <span key={i}>{s}</span>
      ))}
    </div>
  ),
}));

vi.mock('../CreateAKSProject/components/NetworkingStep', () => ({
  NetworkingStep: () => <div data-testid="networking-step">Networking Step</div>,
}));

vi.mock('../CreateAKSProject/components/ComputeStep', () => ({
  ComputeStep: () => <div data-testid="compute-step">Compute Step</div>,
}));

vi.mock('../CreateAKSProject/components/AccessStep', () => ({
  AccessStep: () => <div data-testid="access-step">Access Step</div>,
}));

vi.mock('../CreateAKSProject/validators', () => ({
  validateNetworkingPolicies: () => ({ isValid: true, errors: [], warnings: [] }),
  validateComputeQuota: () => ({ isValid: true, errors: [], warnings: [] }),
  validateAccessStep: () => ({ isValid: true, errors: [], warnings: [] }),
  formatCpuValue: (v: number) => `${v}m`,
  formatMemoryValue: (v: number) => `${v}Mi`,
}));

vi.mock('../AzureAuth/AzureAuthGuard', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../AzureCliWarning', () => ({
  default: () => null,
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: any) => <span data-testid={`icon-${icon}`} />,
}));

// Import after mocks
import CreateProjectFromNamespace from './CreateProjectFromNamespace';

function makeDiscoveredNamespace(overrides: Partial<any> = {}) {
  return {
    name: 'test-ns',
    clusterName: 'test-cluster',
    resourceGroup: 'test-rg',
    subscriptionId: 'test-sub',
    labels: null,
    provisioningState: 'Succeeded',
    isAksProject: false,
    isManagedNamespace: true,
    category: 'needs-conversion' as const,
    ...overrides,
  };
}

function defaultDiscoveryReturn(needsConversion: any[] = [], needsImport: any[] = []) {
  return {
    namespaces: [...needsConversion, ...needsImport],
    needsConversion,
    needsImport,
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
}

describe('CreateProjectFromNamespace', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRegisterAKSCluster.mockReset();
    mockApplyProjectLabels.mockReset();
    mockUpdateManagedNamespace.mockReset();
    mockAssignRolesToNamespace.mockReset();
    mockUseRegisteredClusters.mockReturnValue(new Set());
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn());
  });

  afterEach(() => {
    cleanup();
  });

  test('renders wizard with correct title', () => {
    render(<CreateProjectFromNamespace />);

    expect(screen.getByText('Project from Existing Namespace')).toBeInTheDocument();
  });

  test('renders namespace selection step by default', () => {
    const ns = makeDiscoveredNamespace({ name: 'ns1' });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));

    render(<CreateProjectFromNamespace />);

    expect(screen.getByText('Select a Namespace')).toBeInTheDocument();
  });

  test('next button is disabled when no namespace is selected', () => {
    const ns = makeDiscoveredNamespace({ name: 'ns1' });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));

    render(<CreateProjectFromNamespace />);

    const nextButton = screen.getByText('Next').closest('button');
    expect(nextButton).toBeDisabled();
  });

  test('cancel navigates to home', () => {
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn());

    render(<CreateProjectFromNamespace />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  test('selecting a namespace enables the Next button', () => {
    const ns = makeDiscoveredNamespace({ name: 'ns1' });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));

    render(<CreateProjectFromNamespace />);

    // Click the row to select the namespace
    fireEvent.click(screen.getByText('ns1'));

    const nextButton = screen.getByText('Next').closest('button');
    expect(nextButton).not.toBeDisabled();
  });

  test('navigates through wizard steps', () => {
    const ns = makeDiscoveredNamespace({ name: 'ns1' });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));

    render(<CreateProjectFromNamespace />);

    // Select namespace and advance
    fireEvent.click(screen.getByText('ns1'));
    fireEvent.click(screen.getByText('Next'));

    // Should be on Networking step (step content rendered by NetworkingStep)
    // Back button should be present
    expect(screen.getByText('Back')).toBeInTheDocument();

    // Go forward to Compute
    fireEvent.click(screen.getByText('Next'));

    // Go forward to Access
    fireEvent.click(screen.getByText('Next'));

    // Go forward to Review — should show "Convert to Project" button
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Convert to Project')).toBeInTheDocument();
  });

  test('shows Import Project button for needs-import namespaces', () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      isAksProject: true,
      category: 'needs-import',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([], [ns]));

    render(<CreateProjectFromNamespace />);

    // Select namespace and advance to review
    fireEvent.click(screen.getByText('ns1'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));

    expect(screen.getByText('Import Project')).toBeInTheDocument();
  });

  test('submit registers cluster, applies labels, and assigns roles', async () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      clusterName: 'cluster-a',
      resourceGroup: 'rg-a',
      subscriptionId: 'sub-a',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockRegisterAKSCluster.mockResolvedValue({ success: true });
    mockApplyProjectLabels.mockResolvedValue(undefined);
    mockUpdateManagedNamespace.mockResolvedValue(undefined);
    mockAssignRolesToNamespace.mockResolvedValue({
      success: true,
      results: [],
      errors: [],
    });

    render(<CreateProjectFromNamespace />);

    // Navigate to review
    fireEvent.click(screen.getByText('ns1'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));

    // Submit
    fireEvent.click(screen.getByText('Convert to Project'));

    await waitFor(() => {
      expect(mockRegisterAKSCluster).toHaveBeenCalledWith('sub-a', 'rg-a', 'cluster-a', 'ns1');
    });

    await waitFor(() => {
      expect(mockApplyProjectLabels).toHaveBeenCalledWith({
        namespaceName: 'ns1',
        clusterName: 'cluster-a',
        subscriptionId: 'sub-a',
        resourceGroup: 'rg-a',
      });
    });

    await waitFor(() => {
      expect(mockAssignRolesToNamespace).toHaveBeenCalled();
    });
  });

  test('skips cluster registration when already registered', async () => {
    mockUseRegisteredClusters.mockReturnValue(new Set(['cluster-a']));

    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      clusterName: 'cluster-a',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockApplyProjectLabels.mockResolvedValue(undefined);
    mockUpdateManagedNamespace.mockResolvedValue(undefined);
    mockAssignRolesToNamespace.mockResolvedValue({
      success: true,
      results: [],
      errors: [],
    });

    render(<CreateProjectFromNamespace />);

    // Navigate to review and submit
    fireEvent.click(screen.getByText('ns1'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Convert to Project'));

    await waitFor(() => {
      expect(mockApplyProjectLabels).toHaveBeenCalled();
    });

    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
  });

  test('skips applyProjectLabels for needs-import namespaces', async () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      clusterName: 'cluster-a',
      isAksProject: true,
      category: 'needs-import',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([], [ns]));
    mockRegisterAKSCluster.mockResolvedValue({ success: true });
    mockUpdateManagedNamespace.mockResolvedValue(undefined);
    mockAssignRolesToNamespace.mockResolvedValue({
      success: true,
      results: [],
      errors: [],
    });

    render(<CreateProjectFromNamespace />);

    // Navigate to review and submit
    fireEvent.click(screen.getByText('ns1'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Import Project'));

    await waitFor(() => {
      expect(mockAssignRolesToNamespace).toHaveBeenCalled();
    });

    expect(mockApplyProjectLabels).not.toHaveBeenCalled();
  });

  test('shows error overlay on conversion failure', async () => {
    const ns = makeDiscoveredNamespace({ name: 'ns1' });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockRegisterAKSCluster.mockRejectedValue(new Error('Cluster registration failed'));

    render(<CreateProjectFromNamespace />);

    // Navigate to review and submit
    fireEvent.click(screen.getByText('ns1'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Convert to Project'));

    await waitFor(() => {
      expect(screen.getByText('Conversion Failed')).toBeInTheDocument();
    });

    expect(screen.getByText('Cluster registration failed')).toBeInTheDocument();
  });
});
