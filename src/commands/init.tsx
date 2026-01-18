// ============================================================================
// Init Command - Configure conductor for a project
// ============================================================================

import { createCliRenderer, type SelectOption } from '@opentui/core';
import { createRoot, useKeyboard } from '@opentui/react';
import { Command } from 'commander';
import { useState } from 'react';
import { AGENTS, getModelsForAgent } from '../services/agents';
import {
  type AgentType,
  type ConductorConfig,
  mergeConfig,
  readHomeConfig,
  readLocalConfig,
  writeConfig,
} from '../services/config';
import { listServices, type TigerService } from '../services/tiger';

// ============================================================================
// Types
// ============================================================================

type Step = 'service' | 'agent' | 'model';

interface SelectionResult<T> {
  type: 'selected';
  value: T;
}

interface CancelledResult {
  type: 'cancelled';
}

interface BackResult {
  type: 'back';
}

type StepResult<T> = SelectionResult<T> | CancelledResult | BackResult;

// ============================================================================
// Generic Selector Component
// ============================================================================

interface SelectorProps {
  title: string;
  description: string;
  options: SelectOption[];
  initialIndex: number;
  showBack?: boolean;
  onSelect: (value: string | null) => void;
  onCancel: () => void;
  onBack?: () => void;
}

function Selector({
  title,
  description,
  options,
  initialIndex,
  showBack = false,
  onSelect,
  onCancel,
  onBack,
}: SelectorProps) {
  const [_selectedIndex, setSelectedIndex] = useState(
    initialIndex >= 0 ? initialIndex : 0,
  );

  useKeyboard((key) => {
    if (key.name === 'escape') {
      onCancel();
    }
    if (showBack && onBack && (key.name === 'backspace' || key.name === 'b')) {
      onBack();
    }
  });

  const handleChange = (index: number, _option: SelectOption | null) => {
    setSelectedIndex(index);
  };

  const handleSelect = (_index: number, option: SelectOption | null) => {
    if (option) {
      onSelect(option.value === '__null__' ? null : (option.value as string));
    }
  };

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      <box
        title={title}
        style={{
          border: true,
          borderStyle: 'single',
          padding: 1,
          flexDirection: 'column',
          flexGrow: 1,
        }}
      >
        <text>{description}</text>
        <text style={{ fg: '#888888' }}>
          {showBack
            ? 'Arrow keys to navigate, Enter to select, b/Backspace to go back, Esc to cancel'
            : 'Arrow keys to navigate, Enter to select, Esc to cancel'}
        </text>

        <select
          options={options}
          focused
          selectedIndex={initialIndex >= 0 ? initialIndex : 0}
          onChange={handleChange}
          onSelect={handleSelect}
          showScrollIndicator
          style={{
            marginTop: 1,
            flexShrink: 1,
            flexGrow: 1,
            maxHeight: options.length * 2,
          }}
        />
      </box>
    </box>
  );
}

// ============================================================================
// Step Runner Helper
// ============================================================================

async function runStep<T>(
  renderApp: (
    onSelect: (value: T) => void,
    onCancel: () => void,
    onBack: () => void,
  ) => React.ReactNode,
): Promise<StepResult<T>> {
  let resolveStep: (result: StepResult<T>) => void;
  const stepPromise = new Promise<StepResult<T>>((resolve) => {
    resolveStep = resolve;
  });

  const renderer = await createCliRenderer({ exitOnCtrlC: true });

  const App = () =>
    renderApp(
      (value) => resolveStep({ type: 'selected', value }),
      () => resolveStep({ type: 'cancelled' }),
      () => resolveStep({ type: 'back' }),
    );

  const root = createRoot(renderer);
  root.render(<App />);

  const result = await stepPromise;
  renderer.destroy();

  return result;
}

// ============================================================================
// Individual Steps
// ============================================================================

async function selectService(
  services: TigerService[],
  currentValue?: string | null,
): Promise<StepResult<string | null>> {
  const options: SelectOption[] = [
    {
      name: '(None)',
      description: "This project doesn't need database forks",
      value: '__null__',
    },
    ...services.map((svc) => ({
      name: svc.name,
      description: `${svc.service_id} - ${svc.metadata.environment}, ${svc.region_code}, ${svc.status}${svc.paused ? ' (PAUSED)' : ''}`,
      value: svc.service_id,
    })),
  ];

  const initialIndex =
    currentValue === null
      ? 0
      : currentValue
        ? options.findIndex((opt) => opt.value === currentValue)
        : 0;

  return runStep((onSelect, onCancel) => (
    <Selector
      title="Step 1/3: Database Service"
      description="Select a Tiger service to use as the default parent for database forks."
      options={options}
      initialIndex={initialIndex}
      showBack={false}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  ));
}

async function selectAgent(
  currentValue?: AgentType,
): Promise<StepResult<AgentType>> {
  const options: SelectOption[] = AGENTS.map((agent) => ({
    name: agent.name,
    description: agent.description,
    value: agent.id,
  }));

  const initialIndex = currentValue
    ? options.findIndex((opt) => opt.value === currentValue)
    : 0;

  return runStep((onSelect, onCancel, onBack) => (
    <Selector
      title="Step 2/3: Default Agent"
      description="Select the default coding agent to use."
      options={options}
      initialIndex={initialIndex >= 0 ? initialIndex : 0}
      showBack
      onSelect={(v) => onSelect(v as AgentType)}
      onCancel={onCancel}
      onBack={onBack}
    />
  ));
}

async function selectModel(
  agent: AgentType,
  currentValue?: string,
): Promise<StepResult<string | null>> {
  const models = await getModelsForAgent(agent);

  if (models.length === 0) {
    // No models available, skip this step
    return { type: 'selected', value: '' };
  }

  const options: SelectOption[] = models.map((model) => ({
    name: model.name,
    description: model.description,
    value: model.id,
  }));

  const initialIndex = currentValue
    ? options.findIndex((opt) => opt.value === currentValue)
    : options.findIndex((opt) =>
        agent === 'claude'
          ? opt.value === 'opus'
          : opt.value === 'anthropic/claude-opus-4-5',
      );

  return runStep((onSelect, onCancel, onBack) => (
    <Selector
      title={`Step 3/3: Default Model (${agent})`}
      description={`Select the default model for ${agent}.`}
      options={options}
      initialIndex={initialIndex >= 0 ? initialIndex : 0}
      showBack
      onSelect={onSelect}
      onCancel={onCancel}
      onBack={onBack}
    />
  ));
}

// ============================================================================
// Main Init Action
// ============================================================================

async function initAction(): Promise<void> {
  // Check for existing config (local and home)
  const [localConfig, homeConfig] = await Promise.all([
    readLocalConfig(),
    readHomeConfig(),
  ]);

  // Show current configuration with source indicators
  const hasLocalConfig = localConfig && Object.keys(localConfig).length > 0;
  const hasHomeConfig = homeConfig && Object.keys(homeConfig).length > 0;

  if (hasLocalConfig || hasHomeConfig) {
    console.log('Current configuration:');

    // Display each config key with its source
    const configKeys: Array<{
      key: keyof ConductorConfig;
      label: string;
      format?: (v: unknown) => string;
    }> = [
      {
        key: 'tigerServiceId',
        label: 'Service',
        format: (v) => (v === null ? '(None)' : String(v)),
      },
      { key: 'agent', label: 'Agent' },
      { key: 'model', label: 'Model' },
    ];

    for (const { key, label, format = String } of configKeys) {
      const localVal = localConfig?.[key];
      const homeVal = homeConfig?.[key];
      if (localVal !== undefined) {
        console.log(`  ${label}: ${format(localVal)} (local)`);
      } else if (homeVal !== undefined) {
        console.log(`  ${label}: ${format(homeVal)} (global)`);
      }
    }
    console.log('');
  }

  // Merge configs for initial values (local takes precedence)
  const existingConfig = mergeConfig(localConfig, homeConfig);

  // Fetch available services
  console.log('Fetching Tiger services...');
  let services: TigerService[];
  try {
    services = await listServices();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (services.length === 0) {
    console.log('No Tiger services found.');
    console.log(
      'Create a service at https://console.cloud.timescale.com or use the tiger CLI.',
    );
    console.log('You can still configure conductor to skip database forks.\n');
  }

  // Track selections as we go through steps
  const config: ConductorConfig = { ...existingConfig };
  let currentStep: Step = 'service';

  // Step through the wizard
  while (true) {
    if (currentStep === 'service') {
      const result = await selectService(services, config.tigerServiceId);

      if (result.type === 'cancelled') {
        console.log('\nCancelled. No changes made.');
        return;
      }
      if (result.type === 'selected') {
        config.tigerServiceId = result.value;
        currentStep = 'agent';
      }
    } else if (currentStep === 'agent') {
      const result = await selectAgent(config.agent);

      if (result.type === 'cancelled') {
        console.log('\nCancelled. No changes made.');
        return;
      }
      if (result.type === 'back') {
        currentStep = 'service';
        continue;
      }
      if (result.type === 'selected') {
        // If agent changed, clear the model selection
        if (config.agent !== result.value) {
          config.model = undefined;
        }
        config.agent = result.value;
        currentStep = 'model';
      }
    } else if (currentStep === 'model' && config.agent) {
      const result = await selectModel(config.agent, config.model);

      if (result.type === 'cancelled') {
        console.log('\nCancelled. No changes made.');
        return;
      }
      if (result.type === 'back') {
        currentStep = 'agent';
        continue;
      }
      if (result.type === 'selected') {
        config.model = result.value || undefined;
        break; // Done with wizard
      }
    }
  }

  // Write the config
  await writeConfig(config);

  // Print confirmation
  console.log('\nConfiguration saved to .conductor/config.yml');
  console.log('');
  console.log('Summary:');

  if (config.tigerServiceId === null) {
    console.log('  Database: (None) - forks will be skipped by default');
  } else if (config.tigerServiceId) {
    const svc = services.find((s) => s.service_id === config.tigerServiceId);
    console.log(`  Database: ${svc?.name ?? config.tigerServiceId}`);
  }

  console.log(`  Agent: ${config.agent}`);
  if (config.model) {
    console.log(`  Model: ${config.model}`);
  }
}

export const initCommand = new Command('init')
  .description('Configure conductor for this project')
  .action(initAction);
