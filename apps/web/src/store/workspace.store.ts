import type { Recipe, SourceKind, Step } from '@dewpond/recipe';
import { create } from 'zustand';
import type { GridColumnMeta, QueryTableResult } from '../app/arrowFormat';
import type { ReplaySource } from '../workers/duckdb.client';

export type EngineStatus = 'idle' | 'booting' | 'ready' | 'error';
export type WorkbenchFeature = 'data' | 'profile' | 'clean' | 'query' | 'redact' | 'export';

export interface LoadedTableMeta {
  id: string;
  displayName: string;
  baseAlias: string;
  alias: string;
  sourceKind: SourceKind;
  bytes: number;
  rowCount: number;
  rejectCount: number;
  columns: GridColumnMeta[];
}

export interface StepSnapshot {
  stepId: string;
  label: string;
  tableId: string;
  targetAlias: string;
  sql: string;
  rowCount: number;
  columns: GridColumnMeta[];
}

function createInitialRecipe(now = Date.now()): Recipe {
  return {
    version: 1,
    id: 'local-session',
    name: 'Local Session Recipe',
    sources: [],
    steps: [],
    head: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function deriveTableStates(
  baseTables: Record<string, LoadedTableMeta>,
  snapshots: readonly StepSnapshot[],
  head: number,
): LoadedTableMeta[] {
  const active: Record<string, LoadedTableMeta> = {};
  for (const [id, meta] of Object.entries(baseTables)) {
    active[id] = { ...meta };
  }

  const limit = Math.min(head, snapshots.length);
  for (let i = 0; i < limit; i++) {
    const snap = snapshots[i];
    if (!snap) continue;
    const prev = active[snap.tableId];
    if (prev) {
      active[snap.tableId] = {
        ...prev,
        alias: snap.targetAlias,
        rowCount: snap.rowCount,
        columns: snap.columns,
      };
    }
  }

  return Object.values(active);
}

export interface WorkspaceState {
  engineStatus: EngineStatus;
  engineBundle: string | null;
  engineVersion: string | null;
  engineError: string | null;
  memoryBytes: number;
  isBusy: boolean;
  busyLabel: string | null;
  activeFeature: WorkbenchFeature;
  baseTables: Record<string, LoadedTableMeta>;
  replaySources: Record<string, ReplaySource>;
  tables: LoadedTableMeta[];
  selectedTableId: string | null;
  recipe: Recipe;
  stepSnapshots: StepSnapshot[];
  sqlDraft: string;
  queryResult: QueryTableResult | null;
  queryError: string | null;
  setEngineStatus: (
    status: EngineStatus,
    opts?: { bundle?: string | null; version?: string | null; error?: string | null },
  ) => void;
  setMemoryBytes: (bytes: number) => void;
  setBusy: (isBusy: boolean, label?: string | null) => void;
  setActiveFeature: (feature: WorkbenchFeature) => void;
  setSelectedTableId: (tableId: string | null) => void;
  registerLoadedTable: (table: LoadedTableMeta, replaySource: ReplaySource) => void;
  recordExecutedStep: (step: Step, snapshot: StepSnapshot) => void;
  setHead: (head: number) => void;
  setSqlDraft: (sql: string) => void;
  setQueryResult: (result: QueryTableResult | null, error?: string | null) => void;
  resetWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  engineStatus: 'idle',
  engineBundle: null,
  engineVersion: null,
  engineError: null,
  memoryBytes: 0,
  isBusy: false,
  busyLabel: null,
  activeFeature: 'data',
  baseTables: {},
  replaySources: {},
  tables: [],
  selectedTableId: null,
  recipe: createInitialRecipe(),
  stepSnapshots: [],
  sqlDraft: 'SELECT 1 AS status_check;',
  queryResult: null,
  queryError: null,

  setEngineStatus: (engineStatus, opts) =>
    set(() => ({
      engineStatus,
      engineBundle: opts?.bundle ?? null,
      engineVersion: opts?.version ?? null,
      engineError: opts?.error ?? null,
    })),

  setMemoryBytes: (memoryBytes) => set(() => ({ memoryBytes })),

  setBusy: (isBusy, label = null) => set(() => ({ isBusy, busyLabel: isBusy ? label : null })),

  setActiveFeature: (activeFeature) => set(() => ({ activeFeature })),

  setSelectedTableId: (selectedTableId) => set(() => ({ selectedTableId })),

  registerLoadedTable: (table, replaySource) =>
    set((state) => {
      const nextBase = { ...state.baseTables, [table.id]: table };
      const nextReplay = { ...state.replaySources, [table.id]: replaySource };
      const tables = deriveTableStates(nextBase, state.stepSnapshots, state.recipe.head);
      return {
        baseTables: nextBase,
        replaySources: nextReplay,
        tables,
        selectedTableId: table.id,
        sqlDraft: `SELECT *\nFROM "${table.baseAlias}"\nLIMIT 200;`,
      };
    }),

  recordExecutedStep: (step, snapshot) =>
    set((state) => {
      const nextSteps = [...state.recipe.steps.slice(0, state.recipe.head), step];
      const nextSnapshots = [...state.stepSnapshots.slice(0, state.recipe.head), snapshot];
      const nextHead = nextSteps.length;
      const tables = deriveTableStates(state.baseTables, nextSnapshots, nextHead);
      return {
        recipe: {
          ...state.recipe,
          steps: nextSteps,
          head: nextHead,
          updatedAt: Date.now(),
        },
        stepSnapshots: nextSnapshots,
        tables,
        selectedTableId: snapshot.tableId,
        sqlDraft: `SELECT *\nFROM "${snapshot.targetAlias}"\nLIMIT 200;`,
      };
    }),

  setHead: (head) =>
    set((state) => {
      const clamped = Math.max(0, Math.min(head, state.recipe.steps.length));
      const tables = deriveTableStates(state.baseTables, state.stepSnapshots, clamped);
      const selected = tables.find((t) => t.id === state.selectedTableId);
      return {
        recipe: {
          ...state.recipe,
          head: clamped,
          updatedAt: Date.now(),
        },
        tables,
        sqlDraft: selected ? `SELECT *\nFROM "${selected.alias}"\nLIMIT 200;` : state.sqlDraft,
      };
    }),

  setSqlDraft: (sqlDraft) => set(() => ({ sqlDraft })),

  setQueryResult: (queryResult, queryError = null) => set(() => ({ queryResult, queryError })),

  resetWorkspace: () =>
    set(() => ({
      memoryBytes: 0,
      baseTables: {},
      replaySources: {},
      tables: [],
      selectedTableId: null,
      recipe: createInitialRecipe(),
      stepSnapshots: [],
      sqlDraft: 'SELECT 1 AS status_check;',
      queryResult: null,
      queryError: null,
    })),
}));
