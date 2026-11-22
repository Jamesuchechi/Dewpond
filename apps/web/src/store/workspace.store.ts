import type { Recipe, Step } from '@dewpond/recipe';
import { create } from 'zustand';

export type EngineStatus = 'idle' | 'booting' | 'ready' | 'error';
export type WorkbenchFeature = 'ingest' | 'profile' | 'clean' | 'query' | 'redact' | 'export';

function createInitialRecipe(now = Date.now()): Recipe {
  return {
    version: 1,
    id: 'local-session',
    name: 'Untitled Recipe',
    sources: [],
    steps: [],
    head: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export interface WorkspaceState {
  engineStatus: EngineStatus;
  engineBundle: string | null;
  engineError: string | null;
  activeFeature: WorkbenchFeature;
  selectedTableId: string | null;
  recipe: Recipe;
  setEngineStatus: (
    status: EngineStatus,
    opts?: { bundle?: string | null; error?: string | null },
  ) => void;
  setActiveFeature: (feature: WorkbenchFeature) => void;
  setSelectedTableId: (tableId: string | null) => void;
  appendStep: (step: Step) => void;
  setHead: (head: number) => void;
  resetWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  engineStatus: 'idle',
  engineBundle: null,
  engineError: null,
  activeFeature: 'ingest',
  selectedTableId: null,
  recipe: createInitialRecipe(),

  setEngineStatus: (engineStatus, opts) =>
    set(() => ({
      engineStatus,
      engineBundle: opts?.bundle ?? null,
      engineError: opts?.error ?? null,
    })),

  setActiveFeature: (activeFeature) => set(() => ({ activeFeature })),

  setSelectedTableId: (selectedTableId) => set(() => ({ selectedTableId })),

  appendStep: (step) =>
    set((state) => {
      const nextSteps = [...state.recipe.steps.slice(0, state.recipe.head), step];
      return {
        recipe: {
          ...state.recipe,
          steps: nextSteps,
          head: nextSteps.length,
          updatedAt: Date.now(),
        },
      };
    }),

  setHead: (head) =>
    set((state) => {
      const clamped = Math.max(0, Math.min(head, state.recipe.steps.length));
      return {
        recipe: {
          ...state.recipe,
          head: clamped,
          updatedAt: Date.now(),
        },
      };
    }),

  resetWorkspace: () =>
    set(() => ({
      selectedTableId: null,
      recipe: createInitialRecipe(),
    })),
}));
