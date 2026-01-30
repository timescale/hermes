// ============================================================================
// Session Store - Zustand store for session selection state management
// ============================================================================

import { create } from 'zustand';

// ============================================================================
// Store
// ============================================================================

export interface SessionState {
  /** Currently selected session ID (containerId) */
  selectedSessionId: string | null;

  /** Set the selected session ID */
  setSelectedSessionId: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  selectedSessionId: null,

  setSelectedSessionId: (id: string | null) => {
    set({ selectedSessionId: id });
  },
}));
