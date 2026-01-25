// ============================================================================
// Agent Service - Manage agent configurations and models
// ============================================================================

import type { SelectOption } from '@opentui/core';
import { useEffect, useState } from 'react';
import type { AgentType } from './config';

export interface Model {
  id: string;
  name: string;
  description?: string;
}

// Claude Code models (hardcoded as there's no CLI to list them)
export const CLAUDE_MODELS: Model[] = [
  { id: 'haiku', name: 'Haiku', description: 'Fastest, best for simple tasks' },
  {
    id: 'sonnet',
    name: 'Sonnet',
    description: 'Best balance of speed and capability',
  },
  {
    id: 'opus',
    name: 'Opus',
    description: 'Most capable, best for complex tasks',
  },
];

export interface AgentInfo {
  id: AgentType;
  name: string;
  color: string;
  description: string;
}

export const AGENT_INFO = [
  {
    id: 'opencode',
    name: 'OpenCode',
    color: '#5C9CF5',
    description: 'Open-source coding agent CLI',
  } satisfies AgentInfo,
  {
    id: 'claude',
    name: 'Claude Code',
    color: '#D77757',
    description: 'Anthropic Claude Code CLI',
  } satisfies AgentInfo,
] as const;

export const AGENTS = AGENT_INFO.map((agent) => agent.id);
export const DEFAULT_AGENT = AGENTS[0] || 'opencode';

export const AGENT_SELECT_OPTIONS: SelectOption[] = AGENT_INFO.map((agent) => ({
  name: agent.name,
  value: agent.id,
  description: agent.description || '',
}));

export const AGENT_INFO_MAP: Record<AgentType, AgentInfo> = AGENT_INFO.reduce(
  (map, agent) => {
    map[agent.id] = agent;
    return map;
  },
  {} as Record<AgentType, AgentInfo>,
);

/**
 * Check if opencode is installed and available in PATH
 */
export async function isOpencodeInstalled(): Promise<boolean> {
  try {
    await Bun.$`which opencode`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Install opencode using the recommended method
 */
export async function installOpencode(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Use bun to install opencode globally
    await Bun.$`curl -fsSL https://opencode.ai/install | bash`.quiet();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const openCodeIdToModel = (id: string): Model => {
  const [description, name = id] = id.split('/');
  return {
    id,
    name,
    description,
  };
};

/**
 * Get available models for opencode from the CLI
 */
async function getOpencodeModels(): Promise<readonly Model[]> {
  try {
    const result = await Bun.$`opencode models`.quiet();
    const output = result.stdout.toString().trim();
    return output
      .split('\n')
      .filter((line) => line.length > 0)
      .map(openCodeIdToModel);
  } catch {
    // Return empty array if opencode is not installed or fails
    return [];
  }
}

/**
 * Get models for a specific agent
 */
export async function getModelsForAgent(
  agent: AgentType,
): Promise<readonly Model[]> {
  if (agent === 'claude') {
    return CLAUDE_MODELS;
  }

  // For opencode, fetch from CLI
  return getOpencodeModels();
}

// hook for models
export const useAgentModels = (): Record<
  AgentType,
  null | readonly Model[]
> => {
  const [map, setMap] = useState<Record<AgentType, null | readonly Model[]>>({
    claude: CLAUDE_MODELS,
    opencode: null,
  });

  useEffect(() => {
    getOpencodeModels().then((models) => {
      setMap((prev) => ({
        ...prev,
        opencode: models,
      }));
    });
  }, []);

  return map;
};
