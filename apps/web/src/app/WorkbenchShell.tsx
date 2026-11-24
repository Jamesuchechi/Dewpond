import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  buildProfileIssueProbesSql,
  detectProfileIssues,
  type ColumnInference,
  type NormalizedCsvResult,
  type ProfileIssue,
  type XlsxSheetInfo,
  XLSX_HARD_CAP_BYTES,
} from '@dewpond/ingest';
import {
  formatRedactionReportMarkdown,
  scanColumnSample,
  type PiiFinding,
  type RedactionAuditReport,
} from '@dewpond/pii';
import {
  decodeShareRecipe,
  detectSchemaDrift,
  encodeShareRecipe,
  findShareUnsafeLiterals,
  remapRecipeColumns,
  validateRecipeJson,
  type EditOverlay,
  type LogicalType,
  type Recipe,
  type Step,
} from '@dewpond/recipe';
import { ident, lit, validateReadOnlySql } from '@dewpond/sqlkit';
import { ComputeClient } from '../workers/compute.client';
import type { ParsedXlsxWorkerResult } from '../workers/compute.worker';
import { DuckDBClient } from '../workers/duckdb.client';
import {
  useWorkspaceStore,
  type LoadedTableMeta,
  type WorkbenchFeature,
} from '../store/workspace.store';
import type { GridColumnMeta, QueryTableResult } from './arrowFormat';
import {
  ChartRenderer,
  type ChartBoxPoint,
  type ChartCategoryPoint,
  type ChartScatterPoint,
} from './ChartRenderer';
import { DataGrid, type TablePageNav } from './DataGrid';
import {
  buildCsvExportBytes,
  buildJsonExportBytes,
  buildNdjsonExportBytes,
  buildParquetExportBytes,
  buildPythonPipelineExport,
  buildSelfContainedHtmlReport,
  buildTokenizationKeyMapJson,
  buildXlsxExportBytes,
} from './exporters';
import {
  buildSchemaOnlyNlPayload,
  compileLocalNlToSql,
  extractSqlFromLlmResponse,
} from './nlToSql';
import {
  detectOpfsCapability,
  loadOpfsSnapshot,
  loadRecipeFromIndexedDb,
  saveOpfsSnapshot,
  saveRecipeToIndexedDb,
  wipeAllLocalPersistence,
  type OpfsCapability,
  type PersistedWorkspaceSnapshot,
} from './persistence';
import { ProfileSparkline } from './ProfileSparkline';
import { buildSyntheticMessyPayrollCsv } from './sampleDataset';
import {
  buildArrowTableTypedCastSql,
  buildAttachSql,
  buildBarChartSql,
  buildBoxPlotChartSql,
  buildCompareDiffSql,
  buildCompareSummarySql,
  buildCsvRejectCountSql,
  buildCsvTypedIngestSql,
  buildDetachSql,
  buildFuzzyDedupeCandidatesSql,
  buildFuzzyDedupeCommitSql,
  buildFuzzyReconcileSql,
  buildHistogramChartSql,
  buildImportAttachedTableSql,
  buildKAnonymityQuery,
  buildKeysetPageSql,
  buildKeyUniquenessCheckSql,
  buildLazyFileIngestSql,
  buildLineChartSql,
  buildListAttachedTablesSql,
  buildPivotCardinalitySql,
  buildPivotSql,
  buildPopulateRejectsSql,
  buildScatterChartSql,
  buildTokenizationKeyMapSql,
  buildUnpivotSql,
  compileCellRowOverlaySql,
  compileCleanStepSql,
  compileFullRecipeSql,
  compileLowercaseColumnSql,
  compileRedactViewSql,
  computeSchemaDiff,
  sanitizeTableName,
  type BlockingMode,
  type ChartAggFn,
  type ChartTimeGrain,
  type ChartType,
  type PivotAggFn,
  type RedactColumnPlan,
} from './sqlCompiler';
import { SqlEditor } from './SqlEditor';
import { initOfflineServiceWorker, type OfflineSwStatus } from './swClient';
import {
  DewpondLogo,
  IconAlertTriangle,
  IconDownload,
  IconLock,
  IconPlay,
  IconRedo,
  IconShieldCheck,
  IconTable,
  IconUndo,
  IconUpload,
} from './WorkbenchIcons';

const FEATURE_TABS: ReadonlyArray<{ id: WorkbenchFeature; label: string }> = [
  { id: 'data', label: 'Data Grid' },
  { id: 'profile', label: 'Profile' },
  { id: 'clean', label: 'Clean' },
  { id: 'charts', label: 'Charts' },
  { id: 'query', label: 'SQL Query' },
  { id: 'redact', label: 'Redact' },
  { id: 'compare', label: 'Compare (Diff)' },
  { id: 'export', label: 'Export' },
];

const VALID_FEATURES = new Set<WorkbenchFeature>(FEATURE_TABS.map((t) => t.id));

function readFeatureFromHash(): WorkbenchFeature {
  if (typeof window === 'undefined') return 'data';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_FEATURES.has(raw as WorkbenchFeature) ? (raw as WorkbenchFeature) : 'data';
}

const LOGICAL_TYPES: readonly LogicalType[] = [
  'VARCHAR',
  'BIGINT',
  'DOUBLE',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
];

const SMALL_CSV_NORMALIZE_CAP_BYTES = 20 * 1024 * 1024;

interface StagedCsvReview {
  kind: 'csv';
  displayName: string;
  virtualName: string;
  targetTableName: string;
  bytes: number;
  inferences: ColumnInference[];
  overrides: Record<string, LogicalType>;
  dateOrder: 'DMY' | 'MDY' | 'ISO';
  hasDateAmbiguity: boolean;
  normInfo?: Omit<NormalizedCsvResult, 'normalizedCsv'>;
  rawBytes?: Uint8Array;
  excludeFooter: boolean;
}

interface StagedXlsxReview {
  kind: 'xlsx';
  displayName: string;
  targetTableName: string;
  bytes: number;
  rawBytes: Uint8Array;
  sheets: XlsxSheetInfo[];
  selectedSheet: string;
  date1904: boolean;
  rowCount: number;
  mergedCells: string[];
  hiddenRowCount: number;
  skippedBannerRows: string[][];
  excludedFooterRows: string[][];
  warnings: string[];
  inferences: ColumnInference[];
  overrides: Record<string, LogicalType>;
  dateOrder: 'DMY' | 'MDY' | 'ISO';
  hasDateAmbiguity: boolean;
  ipcBytes: Uint8Array;
}

type StagedReview = StagedCsvReview | StagedXlsxReview;
type CleanOp =
  | 'dedupe'
  | 'fuzzyDedupe'
  | 'trim'
  | 'case'
  | 'filter'
  | 'derive'
  | 'cast'
  | 'rename'
  | 'drop'
  | 'reorder'
  | 'replace'
  | 'regexExtract'
  | 'split'
  | 'merge'
  | 'fillNulls'
  | 'parseDate'
  | 'parseNumber'
  | 'pivot'
  | 'unpivot';

interface ProfileSummaryState {
  tableAlias: string;
  elapsedMs: number;
  summarize: QueryTableResult;
  issues: ProfileIssue[];
  sparklines: Record<string, number[]>;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function triggerBlobDownload(filename: string, data: Uint8Array | string, mimeType: string): void {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function defaultRedactionForFindings(findings: readonly PiiFinding[]): RedactColumnPlan['mode'] {
  if (findings.some((f) => f.detector === 'eleven_digit_id')) return 'hash_sha256';
  if (
    findings.some(
      (f) =>
        f.detector === 'email' || f.detector === 'nigerian_phone' || f.detector === 'luhn_card',
    )
  ) {
    return 'mask';
  }
  return 'keep';
}

function buildSparklineBuckets(
  columns: readonly { name: string }[],
  sampleGrid: QueryTableResult | null,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!sampleGrid || sampleGrid.rows.length === 0) return out;

  for (const col of columns) {
    if (col.name === '__rid') continue;
    const colIdx = sampleGrid.columns.findIndex((c) => c.name === col.name);
    if (colIdx === -1) {
      out[col.name] = [1, 1];
      continue;
    }

    const nums: number[] = [];
    const counts = new Map<string, number>();
    for (const row of sampleGrid.rows) {
      const cell = row[colIdx];
      if (!cell || cell === 'NULL') continue;
      const n = Number(cell.replace(/,/g, ''));
      if (Number.isFinite(n)) nums.push(n);
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }

    if (nums.length >= 4) {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      if (max === min) {
        out[col.name] = [0, nums.length, 0];
      } else {
        const bins = new Array<number>(10).fill(0);
        const span = max - min;
        for (const v of nums) {
          const b = Math.min(9, Math.floor(((v - min) / span) * 10));
          bins[b] = (bins[b] ?? 0) + 1;
        }
        out[col.name] = bins;
      }
    } else {
      const topFreq = [...counts.values()].sort((a, b) => b - a).slice(0, 10);
      out[col.name] = topFreq.length >= 2 ? topFreq : [0, topFreq[0] ?? 1];
    }
  }
  return out;
}

export function WorkbenchShell() {
  const clientRef = useRef<DuckDBClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new DuckDBClient();
  }
  const computeRef = useRef<ComputeClient | null>(null);
  if (!computeRef.current) {
    computeRef.current = new ComputeClient();
  }
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recipeImportInputRef = useRef<HTMLInputElement | null>(null);
  const stagedSourceRef = useRef<{ file?: File; text?: string } | null>(null);
  const pageCacheRef = useRef<Map<string, QueryTableResult>>(new Map());
  const pageCursorsRef = useRef<
    Map<string, { firstOrd: number; firstRid: string; lastOrd: number; lastRid: string }>
  >(new Map());

  const {
    engineStatus,
    engineBundle,
    engineVersion,
    engineError,
    memoryBytes,
    isBusy,
    busyLabel,
    activeFeature,
    tables,
    selectedTableId,
    recipe,
    stepSnapshots,
    sqlDraft,
    queryResult,
    queryError,
    setEngineStatus,
    setMemoryBytes,
    setBusy,
    setActiveFeature,
    setSelectedTableId,
    registerLoadedTable,
    recordExecutedStep,
    setHead,
    setSqlDraft,
    setQueryResult,
    resetWorkspace,
  } = useWorkspaceStore();

  const [statusNote, setStatusNote] = useState('Local DuckDB-WASM 1.32.0 idle until booted.');
  const [dragOver, setDragOver] = useState(false);
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [stagedReview, setStagedReview] = useState<StagedReview | null>(null);
  const [gridPageNav, setGridPageNav] = useState<TablePageNav | null>(null);
  const [swStatus, setSwStatus] = useState<OfflineSwStatus>({
    supported: false,
    ready: false,
    cachedCount: 0,
    netFetchCount: 0,
    externalBlockedCount: 0,
  });

  useEffect(() => initOfflineServiceWorker(setSwStatus), []);

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#r=')) {
        const decoded = decodeShareRecipe(hash);
        if (decoded.ok) {
          setImportedRecipe(decoded.recipe);
          setStatusNote(
            `Decoded shared #r= Recipe "${decoded.recipe.name}" (${decoded.recipe.steps.length} steps). Review & replay.`,
          );
        } else {
          setStatusNote(`Blocked shared #r= Recipe: ${decoded.error}`);
        }
        return;
      }
      setActiveFeature(readFeatureFromHash());
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [setActiveFeature]);

  useEffect(() => {
    void detectOpfsCapability().then(setOpfsCap);
    void loadRecipeFromIndexedDb().then((snap) => {
      if (snap && snap.recipe.steps.length > 0) {
        setSavedSnapshot(snap);
      }
    });
  }, []);

  useEffect(() => {
    if (recipe.steps.length === 0) return;
    const baseAlias =
      (tables.find((t) => t.id === selectedTableId) ?? tables[0])?.baseAlias ?? null;
    void saveRecipeToIndexedDb({
      recipe,
      tableName: baseAlias,
      savedAt: Date.now(),
    });
  }, [recipe, tables, selectedTableId]);

  function navigateFeature(next: WorkbenchFeature): void {
    setActiveFeature(next);
    if (typeof window !== 'undefined') {
      const targetHash = `#/${next}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(null, '', targetHash);
      }
    }
  }

  // Profile state
  const [profileState, setProfileState] = useState<ProfileSummaryState | null>(null);

  // Clean form state
  const [cleanOp, setCleanOp] = useState<CleanOp>('dedupe');
  const [cleanPrimaryCol, setCleanPrimaryCol] = useState<string>('email');
  const [cleanOrderCol, setCleanOrderCol] = useState<string>('tx_date');
  const [cleanDedupeKeep, setCleanDedupeKeep] = useState<'first' | 'last'>('last');
  const [cleanFilterOp, setCleanFilterOp] = useState<'not_null' | 'eq' | 'contains' | 'gt'>(
    'not_null',
  );
  const [cleanFilterVal, setCleanFilterVal] = useState<string>('');
  const [cleanRenameTo, setCleanRenameTo] = useState<string>('renamed_col');
  const [cleanCaseMode, setCleanCaseMode] = useState<'lower' | 'upper' | 'title'>('lower');
  const [cleanCastType, setCleanCastType] = useState<LogicalType>('DOUBLE');
  const [cleanDeriveCol, setCleanDeriveCol] = useState<string>('derived_col');
  const [cleanDeriveExpr, setCleanDeriveExpr] = useState<string>('amount * 1.075');
  const [cleanReplaceSearch, setCleanReplaceSearch] = useState<string>('');
  const [cleanReplaceWith, setCleanReplaceWith] = useState<string>('');
  const [cleanRegexPattern, setCleanRegexPattern] = useState<string>('([0-9]+)');
  const [cleanRegexInto, setCleanRegexInto] = useState<string>('extracted_part');
  const [cleanSplitDelim, setCleanSplitDelim] = useState<string>('@');
  const [cleanSplitInto, setCleanSplitInto] = useState<string>('part_1, part_2');
  const [cleanMergeCols, setCleanMergeCols] = useState<string>('');
  const [cleanMergeSep, setCleanMergeSep] = useState<string>(' ');
  const [cleanMergeInto, setCleanMergeInto] = useState<string>('merged_col');
  const [cleanFillStrategy, setCleanFillStrategy] = useState<'value' | 'mean' | 'median' | 'ffill'>(
    'value',
  );
  const [cleanFillVal, setCleanFillVal] = useState<string>('0');
  const [cleanDateFmt, setCleanDateFmt] = useState<'DMY' | 'MDY' | 'ISO'>('DMY');
  const [cleanNumLocale, setCleanNumLocale] = useState<'us_currency' | 'eu_decimal'>('us_currency');
  const [cleanReorderCsv, setCleanReorderCsv] = useState<string>('');
  const [pivotIndexCols, setPivotIndexCols] = useState<string[]>([]);
  const [pivotOnCol, setPivotOnCol] = useState<string>('');
  const [pivotValueCol, setPivotValueCol] = useState<string>('');
  const [pivotAgg, setPivotAgg] = useState<PivotAggFn>('SUM');
  const [pivotMaxCols, setPivotMaxCols] = useState<number>(40);
  const [unpivotCols, setUnpivotCols] = useState<string[]>([]);
  const [unpivotNameCol, setUnpivotNameCol] = useState<string>('attribute');
  const [unpivotValueCol, setUnpivotValueCol] = useState<string>('value');

  // Persistence & Recipe Import state
  const [opfsCap, setOpfsCap] = useState<OpfsCapability>({ available: true });
  const [savedSnapshot, setSavedSnapshot] = useState<PersistedWorkspaceSnapshot | null>(null);
  const [importedRecipe, setImportedRecipe] = useState<Recipe | null>(null);
  const [driftMap, setDriftMap] = useState<Record<string, string>>({});
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [editOverlay, setEditOverlay] = useState<EditOverlay | null>(null);

  // SQL Guard override state
  const [allowTrustedDdl, setAllowTrustedDdl] = useState(false);

  // Local-first Schema-Only NL->SQL state
  const [nlPrompt, setNlPrompt] = useState('total amount by department');
  const [nlMode, setNlMode] = useState<'local' | 'byo'>('local');
  const [nlExternalResponse, setNlExternalResponse] = useState('');
  const [nlPayloadApproved, setNlPayloadApproved] = useState(false);

  // Charts state
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [chartXCol, setChartXCol] = useState<string>('');
  const [chartYCol, setChartYCol] = useState<string>('');
  const [chartSeriesCol, setChartSeriesCol] = useState<string>('');
  const [chartAgg, setChartAgg] = useState<ChartAggFn>('COUNT');
  const [chartTimeGrain, setChartTimeGrain] = useState<ChartTimeGrain>('none');
  const [chartBins, setChartBins] = useState<number>(12);
  const [chartTopN, setChartTopN] = useState<number>(20);
  const [chartCategoryData, setChartCategoryData] = useState<ChartCategoryPoint[]>([]);
  const [chartScatterData, setChartScatterData] = useState<ChartScatterPoint[]>([]);
  const [chartBoxData, setChartBoxData] = useState<ChartBoxPoint[]>([]);
  const [chartTitle, setChartTitle] = useState<string>('Dataset Chart');
  const [pinnedReportCharts, setPinnedReportCharts] = useState<
    Array<{ title: string; svgMarkup: string }>
  >([]);
  const [queryViewMode, setQueryViewMode] = useState<'table' | 'chart'>('table');

  // Redact state
  const [piiFindings, setPiiFindings] = useState<PiiFinding[]>([]);
  const [redactPlans, setRedactPlans] = useState<Record<string, RedactColumnPlan['mode']>>({});
  const [redactSalt, setRedactSalt] = useState('vendor_2026_salt');
  const [shuffleSeed, setShuffleSeed] = useState('dewpond_seed_01');
  const [kThreshold, setKThreshold] = useState(5);
  const [qiColumns, setQiColumns] = useState<string[]>([]);
  const [kAnonResult, setKAnonResult] = useState<QueryTableResult | null>(null);
  const [lastRedactTimestamp, setLastRedactTimestamp] = useState<number | null>(null);
  const [neutralizeFormulas, setNeutralizeFormulas] = useState(true);

  // Compare (Diff) v1.1 state
  const [compareLeftAlias, setCompareLeftAlias] = useState<string>('');
  const [compareRightAlias, setCompareRightAlias] = useState<string>('');
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [compareStatusFilter, setCompareStatusFilter] = useState<
    'all' | 'added' | 'removed' | 'changed' | 'unchanged'
  >('all');
  const [compareSummary, setCompareSummary] = useState<{
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    leftDuplicates: number;
    rightDuplicates: number;
  } | null>(null);
  const [compareLastResult, setCompareLastResult] = useState<QueryTableResult | null>(null);
  const [compareMode, setCompareMode] = useState<'exact' | 'fuzzy'>('exact');
  const [fuzzyBlockMode, setFuzzyBlockMode] = useState<BlockingMode>('prefix_3');
  const [fuzzyMinSim, setFuzzyMinSim] = useState<number>(0.85);
  const [fuzzyTolCol, setFuzzyTolCol] = useState<string>('');
  const [fuzzyTolDelta, setFuzzyTolDelta] = useState<string>('5');
  const [fuzzyQueue, setFuzzyQueue] = useState<
    Array<{
      keepRid: string;
      dropRid: string;
      leftValue: string;
      rightValue: string;
      similarity: string;
      editDist: string;
    }>
  >([]);
  const [fuzzyApprovedDrops, setFuzzyApprovedDrops] = useState<string[]>([]);

  const activeTable: LoadedTableMeta | undefined =
    tables.find((t) => t.id === selectedTableId) ?? tables[0];

  const userColumns = activeTable?.columns.filter((c) => c.name !== '__rid') ?? [];
  const shareFindings = findShareUnsafeLiterals(recipe);
  const sqlSafety = validateReadOnlySql(sqlDraft);
  const sqlSchema: Record<string, string[]> = Object.fromEntries(
    tables.map((t) => [t.alias, t.columns.map((c) => c.name)]),
  );

  // PWA File Handling API (launchQueue) registration
  useEffect(() => {
    const win = window as unknown as {
      launchQueue?: {
        setConsumer: (
          cb: (params: { files: Array<{ getFile: () => Promise<File> }> }) => void,
        ) => void;
      };
    };
    win.launchQueue?.setConsumer((launchParams) => {
      const firstHandle = launchParams.files?.[0];
      if (!firstHandle) return;
      void firstHandle.getFile().then((file) => ingestLocalFile(file));
    });
  }, []);

  async function refreshMemoryGauge(): Promise<void> {
    const client = clientRef.current;
    if (!client || !client.isReady) return;
    try {
      const bytes = await client.getMemoryUsageBytes();
      setMemoryBytes(bytes);
    } catch {
      // Non-fatal metric refresh
    }
  }

  async function ensureEngineReady(): Promise<DuckDBClient> {
    const client = clientRef.current!;
    if (client.isReady) return client;
    setEngineStatus('booting');
    setStatusNote('Booting DuckDB-WASM 1.32.0 inside a same-origin blob: worker…');
    try {
      const info = await client.ensureBooted();
      setEngineStatus('ready', { bundle: info.bundle, version: info.version });
      setStatusNote(`DuckDB ${info.version} (${info.bundle}) running in :memory: blob: worker.`);
      await refreshMemoryGauge();
      return client;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEngineStatus('error', { error: msg });
      setStatusNote(`Engine boot failed: ${msg}`);
      throw err;
    }
  }

  async function previewAliasInGrid(
    client: DuckDBClient,
    alias: string,
    totalRows: number,
    pageIndex = 0,
    prevPageIndex = 0,
  ): Promise<QueryTableResult> {
    const pageSize = 500;
    const safePage = Math.max(0, pageIndex);
    const cacheKey = `${alias}:${safePage}`;
    const cached = pageCacheRef.current.get(cacheKey);
    const activeMeta = useWorkspaceStore
      .getState()
      .tables.find((t) => t.alias === alias || t.baseAlias === alias);
    const hasRid = Boolean(activeMeta?.columns.some((c) => c.name === '__rid'));
    const hasOrd = Boolean(activeMeta?.columns.some((c) => c.name === '__ord'));

    if (cached) {
      setQueryResult(cached, null);
      setGridPageNav({
        pageIndex: safePage,
        pageSize,
        totalRows,
        cacheHit: true,
        keyset: hasRid,
        onChangePage: (next) => {
          void previewAliasInGrid(client, alias, totalRows, next, safePage);
        },
      });
      return cached;
    }

    let sql: string;
    const prevCursor = pageCursorsRef.current.get(`${alias}:${prevPageIndex}`);
    if (hasRid && safePage === 0) {
      sql = buildKeysetPageSql({ alias, pageSize, hasRid, hasOrd, direction: 'first' });
    } else if (hasRid && safePage === prevPageIndex + 1 && prevCursor) {
      sql = buildKeysetPageSql({
        alias,
        pageSize,
        hasRid,
        hasOrd,
        direction: 'next',
        cursorOrd: prevCursor.lastOrd,
        cursorRid: prevCursor.lastRid,
      });
    } else if (hasRid && safePage === prevPageIndex - 1 && prevCursor) {
      sql = buildKeysetPageSql({
        alias,
        pageSize,
        hasRid,
        hasOrd,
        direction: 'prev',
        cursorOrd: prevCursor.firstOrd,
        cursorRid: prevCursor.firstRid,
      });
    } else {
      sql = buildKeysetPageSql({
        alias,
        pageSize,
        hasRid: false,
        hasOrd: false,
        fallbackOffset: safePage * pageSize,
      });
    }

    const res = await client.queryRows(sql, pageSize);
    const ridIdx = res.columns.findIndex((c) => c.name === '__rid');
    const ordIdx = res.columns.findIndex((c) => c.name === '__ord');
    if (ridIdx >= 0 && res.rows.length > 0) {
      const firstRow = res.rows[0]!;
      const lastRow = res.rows[res.rows.length - 1]!;
      const firstRid = String(firstRow[ridIdx] ?? '0');
      const lastRid = String(lastRow[ridIdx] ?? '0');
      const firstOrd = ordIdx >= 0 ? Number(firstRow[ordIdx]) : Number(firstRid);
      const lastOrd = ordIdx >= 0 ? Number(lastRow[ordIdx]) : Number(lastRid);
      pageCursorsRef.current.set(cacheKey, { firstOrd, firstRid, lastOrd, lastRid });
    }

    pageCacheRef.current.set(cacheKey, res);
    setQueryResult(res, null);
    setGridPageNav({
      pageIndex: safePage,
      pageSize,
      totalRows,
      cacheHit: false,
      keyset: hasRid,
      onChangePage: (next) => {
        void previewAliasInGrid(client, alias, totalRows, next, safePage);
      },
    });
    return res;
  }

  async function syncRejectsTableIfAny(client: DuckDBClient, rejectCount: number): Promise<void> {
    if (rejectCount <= 0) return;
    const countRes = await client.queryRows('SELECT count(*)::BIGINT FROM "_rejects";', 1);
    const totalRejectRows = Number(countRes.rows[0]?.[0] ?? rejectCount);
    const rejPreview = await client.queryRows('SELECT * FROM "_rejects" LIMIT 500;', 500);
    const rejMeta: LoadedTableMeta = {
      id: '_rejects',
      displayName: '_rejects (Quarantine)',
      baseAlias: '_rejects',
      alias: '_rejects',
      sourceKind: 'csv',
      bytes: 0,
      rowCount: totalRejectRows,
      rejectCount: totalRejectRows,
      columns: rejPreview.columns,
    };
    registerLoadedTable(rejMeta, {
      virtualName: '_rejects_virtual',
      ingestSql: 'SELECT 1;',
    });
  }

  function applyLoadedSelectionDefaults(loaded: LoadedTableMeta): void {
    const nonRidCols = loaded.columns.filter((c) => c.name !== '__rid');
    if (nonRidCols[0]) setCleanPrimaryCol(nonRidCols[0].name);
    if (nonRidCols.some((c) => c.name === 'email')) setCleanPrimaryCol('email');
    if (nonRidCols.some((c) => c.name === 'tx_date')) setCleanOrderCol('tx_date');
    setQiColumns(nonRidCols.slice(0, 2).map((c) => c.name));
  }

  async function stageCsvTextOrFile(opts: {
    displayName: string;
    virtualName: string;
    bytes: number;
    file?: File;
    text?: string;
    rawBytes?: Uint8Array;
    excludeFooter?: boolean;
  }): Promise<void> {
    const excludeFooter = opts.excludeFooter ?? true;
    setBusy(true, `Sniffing & sampling first 5,000 rows of ${opts.displayName}…`);
    stagedSourceRef.current = { file: opts.file, text: opts.text };
    try {
      const computeApi = await computeRef.current!.getApi();
      const client = await ensureEngineReady();

      let rawBytes = opts.rawBytes;
      let normInfo: Omit<NormalizedCsvResult, 'normalizedCsv'> | undefined;

      if (!rawBytes && opts.bytes <= SMALL_CSV_NORMALIZE_CAP_BYTES) {
        if (opts.file) {
          rawBytes = new Uint8Array(await opts.file.arrayBuffer());
        } else if (opts.text !== undefined) {
          rawBytes = new TextEncoder().encode(opts.text);
        }
      }

      if (rawBytes && opts.bytes <= SMALL_CSV_NORMALIZE_CAP_BYTES) {
        const normalized = await computeApi.preprocessCsv(rawBytes, { excludeFooter });
        const { normalizedCsv, ...meta } = normalized;
        normInfo = meta;
        stagedSourceRef.current = { text: normalizedCsv };
        await client.registerTextFile(opts.virtualName, normalizedCsv);
      } else if (opts.file) {
        await client.registerFile(opts.file, opts.virtualName);
      } else if (opts.text !== undefined) {
        await client.registerTextFile(opts.virtualName, opts.text);
      }

      const sampleRes = await client.queryRows(
        `SELECT * FROM read_csv(${lit(opts.virtualName)}, all_varchar=true, header=true) LIMIT 5000;`,
        5000,
      );

      const batchPayload = sampleRes.columns.map((col, colIdx) => ({
        columnName: col.name,
        values: sampleRes.rows.map((r) => {
          const val = r[colIdx];
          return val === 'NULL' || val === undefined ? null : val;
        }),
      }));

      const inferences = await computeApi.scoreColumnsBatch(batchPayload);
      const overrides: Record<string, LogicalType> = {};
      let hasDateAmbiguity = false;
      for (const inf of inferences) {
        overrides[inf.columnName] = inf.type;
        if (inf.dateAmbiguity) hasDateAmbiguity = true;
      }

      setStagedReview({
        kind: 'csv',
        displayName: opts.displayName,
        virtualName: opts.virtualName,
        targetTableName: sanitizeTableName(opts.displayName),
        bytes: opts.bytes,
        inferences,
        overrides,
        dateOrder: 'DMY',
        hasDateAmbiguity,
        normInfo,
        rawBytes,
        excludeFooter,
      });
      setStatusNote(
        `Sampled ${sampleRes.rows.length.toLocaleString('en-US')} rows from ${opts.displayName}. Review type vetoes and commit.`,
      );
      setIngestModalOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`Ingest sampling failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function stageXlsxFile(file: File, selectedSheet?: string): Promise<void> {
    if (file.size > XLSX_HARD_CAP_BYTES) {
      setStatusNote(
        `XLSX "${file.name}" (${formatBytes(file.size)}) exceeds the 50 MB hard cap. Export to CSV or Parquet and open lazily instead.`,
      );
      return;
    }

    setBusy(true, `Streaming XLSX "${file.name}" in fflate compute worker…`);
    try {
      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const computeApi = await computeRef.current!.getApi();
      const parsed: ParsedXlsxWorkerResult = await computeApi.parseXlsxToArrowIpc(
        rawBytes,
        selectedSheet,
      );

      const overrides: Record<string, LogicalType> = {};
      let hasDateAmbiguity = false;
      for (const inf of parsed.inferences) {
        overrides[inf.columnName] = inf.type;
        if (inf.dateAmbiguity) hasDateAmbiguity = true;
      }

      setStagedReview({
        kind: 'xlsx',
        displayName: file.name,
        targetTableName: sanitizeTableName(file.name),
        bytes: file.size,
        rawBytes,
        sheets: parsed.sheets,
        selectedSheet: parsed.selectedSheet,
        date1904: parsed.date1904,
        rowCount: parsed.rowCount,
        mergedCells: parsed.mergedCells,
        hiddenRowCount: parsed.hiddenRowCount,
        skippedBannerRows: parsed.skippedBannerRows,
        excludedFooterRows: parsed.excludedFooterRows,
        warnings: parsed.warnings,
        inferences: parsed.inferences,
        overrides,
        dateOrder: 'DMY',
        hasDateAmbiguity,
        ipcBytes: parsed.ipcBytes,
      });
      setStatusNote(
        `Parsed XLSX sheet "${parsed.selectedSheet}" (${parsed.rowCount.toLocaleString('en-US')} rows, ${parsed.date1904 ? '1904' : '1900'} UTC epoch).`,
      );
      setIngestModalOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`XLSX parsing failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function switchStagedXlsxSheet(sheetName: string): Promise<void> {
    if (!stagedReview || stagedReview.kind !== 'xlsx') return;
    setBusy(true, `Switching XLSX sheet to "${sheetName}"…`);
    try {
      const computeApi = await computeRef.current!.getApi();
      const parsed = await computeApi.parseXlsxToArrowIpc(stagedReview.rawBytes, sheetName);
      const overrides: Record<string, LogicalType> = {};
      let hasDateAmbiguity = false;
      for (const inf of parsed.inferences) {
        overrides[inf.columnName] = inf.type;
        if (inf.dateAmbiguity) hasDateAmbiguity = true;
      }
      setStagedReview({
        ...stagedReview,
        selectedSheet: parsed.selectedSheet,
        rowCount: parsed.rowCount,
        mergedCells: parsed.mergedCells,
        hiddenRowCount: parsed.hiddenRowCount,
        skippedBannerRows: parsed.skippedBannerRows,
        excludedFooterRows: parsed.excludedFooterRows,
        warnings: parsed.warnings,
        inferences: parsed.inferences,
        overrides,
        hasDateAmbiguity,
        ipcBytes: parsed.ipcBytes,
      });
    } finally {
      setBusy(false);
    }
  }

  async function commitStagedReview(): Promise<void> {
    if (!stagedReview) return;
    setBusy(true, `Committing typed table ${stagedReview.targetTableName}…`);
    try {
      const client = await ensureEngineReady();
      const castSpecs = stagedReview.inferences.map((inf) => ({
        name: inf.columnName,
        targetType: stagedReview.overrides[inf.columnName] ?? inf.type,
        localeNumberFormat: inf.localeNumberFormat,
      }));

      let ingestSql: string;
      let rejectCount = 0;

      if (stagedReview.kind === 'xlsx') {
        const stageName = `__xlsx_stage_${stagedReview.targetTableName}`;
        await client.insertArrowIpc(stageName, stagedReview.ipcBytes);
        ingestSql = buildArrowTableTypedCastSql(
          stageName,
          stagedReview.targetTableName,
          castSpecs,
          stagedReview.dateOrder,
        );
        await client.exec(ingestSql);
        const rejSql = buildPopulateRejectsSql(
          stagedReview.targetTableName,
          ident(stageName),
          castSpecs,
          stagedReview.dateOrder,
        );
        if (rejSql) {
          await client.exec(rejSql);
          const cnt = await client.queryRows(
            `SELECT count(*)::BIGINT FROM "_rejects" WHERE "source_id" = ${lit(stagedReview.targetTableName)};`,
            1,
          );
          rejectCount = Number(cnt.rows[0]?.[0] ?? 0);
        }
        await client.exec(`DROP TABLE IF EXISTS ${ident(stageName)};`);
      } else {
        ingestSql = buildCsvTypedIngestSql({
          virtualFileName: stagedReview.virtualName,
          targetTableName: stagedReview.targetTableName,
          columns: castSpecs,
          dateOrder: stagedReview.dateOrder,
        });
        await client.exec(ingestSql);

        if (stagedReview.bytes <= SMALL_CSV_NORMALIZE_CAP_BYTES) {
          const rejPop = buildPopulateRejectsSql(
            stagedReview.targetTableName,
            `read_csv(${lit(stagedReview.virtualName)}, all_varchar=true, header=true)`,
            castSpecs,
            stagedReview.dateOrder,
          );
          if (rejPop) {
            await client.exec(rejPop);
            const cnt = await client.queryRows(
              `SELECT count(*)::BIGINT FROM "_rejects" WHERE "source_id" = ${lit(stagedReview.targetTableName)};`,
              1,
            );
            rejectCount = Number(cnt.rows[0]?.[0] ?? 0);
          }
        } else {
          const rejCountSql = buildCsvRejectCountSql(
            stagedReview.virtualName,
            castSpecs,
            stagedReview.dateOrder,
          );
          if (rejCountSql) {
            // Skip secondary full scan on >20 MB CSV unless needed later; keep single-pass <3s speed
            rejectCount = 0;
          }
        }
      }

      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS total_rows FROM ${ident(stagedReview.targetTableName)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const previewRes = await client.queryRows(
        `SELECT * FROM ${ident(stagedReview.targetTableName)} LIMIT 500;`,
        500,
      );

      const loaded: LoadedTableMeta = {
        id: stagedReview.targetTableName,
        displayName: stagedReview.displayName,
        baseAlias: stagedReview.targetTableName,
        alias: stagedReview.targetTableName,
        sourceKind:
          stagedReview.kind === 'xlsx'
            ? 'xlsx'
            : stagedReview.displayName.toLowerCase().endsWith('.tsv')
              ? 'tsv'
              : 'csv',
        bytes: stagedReview.bytes,
        rowCount,
        rejectCount,
        columns: previewRes.columns,
      };

      const stagedSource = stagedSourceRef.current;
      await syncRejectsTableIfAny(client, rejectCount);

      registerLoadedTable(
        loaded,
        stagedReview.kind === 'xlsx'
          ? {
              virtualName: stagedReview.targetTableName,
              arrowStageName: `__xlsx_stage_${stagedReview.targetTableName}`,
              arrowIpc: stagedReview.ipcBytes,
              ingestSql,
            }
          : {
              virtualName: stagedReview.virtualName,
              file: stagedSource?.file,
              text: stagedSource?.text,
              ingestSql,
            },
      );

      pageCacheRef.current.set(`${loaded.alias}:0`, previewRes);
      setQueryResult(previewRes, null);
      setGridPageNav({
        pageIndex: 0,
        pageSize: 500,
        totalRows: rowCount,
        cacheHit: false,
        onChangePage: (next) => {
          void previewAliasInGrid(client, loaded.alias, rowCount, next);
        },
      });

      setProfileState(null);
      setPiiFindings([]);
      setKAnonResult(null);
      applyLoadedSelectionDefaults(loaded);

      setStagedReview(null);
      setIngestModalOpen(false);
      navigateFeature('data');
      setStatusNote(
        `Loaded "${loaded.baseAlias}" (${rowCount.toLocaleString('en-US')} rows, ${rejectCount} quarantined reject(s)).`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`Failed loading table: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function ingestLocalFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      await stageXlsxFile(file);
      return;
    }
    if (lower.endsWith('.xls')) {
      setStatusNote('Legacy binary .xls is not supported; re-save as .xlsx, CSV, or Parquet.');
      return;
    }

    const virtualName = `__upload_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    if (
      lower.endsWith('.duckdb') ||
      lower.endsWith('.sqlite') ||
      lower.endsWith('.sqlite3') ||
      lower.endsWith('.db')
    ) {
      const dbKind: 'duckdb' | 'sqlite' = lower.endsWith('.duckdb') ? 'duckdb' : 'sqlite';
      const attachAlias = `__attach_${Date.now()}`;
      setBusy(true, `Attaching ${dbKind.toUpperCase()} database "${file.name}"…`);
      try {
        const client = await ensureEngineReady();
        const bytes = new Uint8Array(await file.arrayBuffer());
        await client.registerFileBuffer(virtualName, bytes);
        try {
          await client.exec(buildAttachSql(virtualName, attachAlias, dbKind, true));
        } catch (attachErr) {
          const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);
          if (dbKind === 'sqlite' && /sqlite|extension|network|http/i.test(msg)) {
            throw new Error(
              `SQLite ATTACH requires the self-hosted sqlite_scanner extension in /duckdb/extensions/ (zero-network CSP blocks remote downloads). (${msg})`,
              { cause: attachErr },
            );
          }
          throw attachErr;
        }
        try {
          const listRes = await client.queryRows(buildListAttachedTablesSql(attachAlias), 200);
          const remoteTables = listRes.rows.map((r) => String(r[0] ?? '')).filter(Boolean);
          if (remoteTables.length === 0) {
            setStatusNote(`Attached "${file.name}", but found 0 tables in schema "main".`);
            return;
          }
          let firstPreview: QueryTableResult | null = null;
          let firstMeta: LoadedTableMeta | null = null;
          for (const remoteName of remoteTables) {
            const descRes = await client.queryRows(
              `DESCRIBE ${ident(attachAlias)}.${ident(remoteName)};`,
              500,
            );
            const hasRid = descRes.rows.some((r) => String(r[0] ?? '') === '__rid');
            const localName = sanitizeTableName(
              remoteTables.length === 1
                ? file.name.replace(/\.(duckdb|sqlite3?|db)$/i, '')
                : `${file.name.replace(/\.(duckdb|sqlite3?|db)$/i, '')}_${remoteName}`,
            );
            const importSql = buildImportAttachedTableSql(
              attachAlias,
              remoteName,
              localName,
              hasRid,
            );
            await client.exec(importSql);
            const countRes = await client.queryRows(
              `SELECT count(*)::BIGINT AS total_rows FROM ${ident(localName)};`,
              1,
            );
            const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
            const preview = await client.queryRows(
              `SELECT * FROM ${ident(localName)} LIMIT 500;`,
              500,
            );
            const loaded: LoadedTableMeta = {
              id: localName,
              displayName: `${file.name} › ${remoteName}`,
              baseAlias: localName,
              alias: localName,
              sourceKind: dbKind,
              bytes: file.size,
              rowCount,
              rejectCount: 0,
              columns: preview.columns,
            };
            registerLoadedTable(loaded, {
              virtualName,
              file,
              ingestSql: importSql,
            });
            pageCacheRef.current.set(`${localName}:0`, preview);
            if (!firstPreview) {
              firstPreview = preview;
              firstMeta = loaded;
            }
          }
          if (firstPreview && firstMeta) {
            const meta = firstMeta;
            setQueryResult(firstPreview, null);
            setGridPageNav({
              pageIndex: 0,
              pageSize: 500,
              totalRows: meta.rowCount,
              cacheHit: false,
              onChangePage: (next) => {
                void previewAliasInGrid(client, meta.alias, meta.rowCount, next);
              },
            });
            applyLoadedSelectionDefaults(meta);
            navigateFeature('data');
            setStatusNote(
              `Attached ${file.name} (${dbKind.toUpperCase()}): imported ${remoteTables.length} table(s).`,
            );
          }
          setIngestModalOpen(false);
          await refreshMemoryGauge();
        } finally {
          await client.exec(buildDetachSql(attachAlias)).catch(() => undefined);
          await client.dropVirtualFile(virtualName);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setQueryResult(null, msg);
        setStatusNote(`${dbKind.toUpperCase()} ATTACH failed: ${msg}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
      await stageCsvTextOrFile({
        displayName: file.name,
        virtualName,
        bytes: file.size,
        file,
      });
      return;
    }

    const sourceKind = lower.endsWith('.parquet')
      ? 'parquet'
      : lower.endsWith('.ndjson') || lower.endsWith('.jsonl')
        ? 'ndjson'
        : lower.endsWith('.json')
          ? 'json'
          : null;
    if (!sourceKind) {
      setStatusNote(
        `Unsupported file extension for "${file.name}". Use CSV, TSV, XLSX, Parquet, or JSON.`,
      );
      return;
    }

    setBusy(true, `Opening ${file.name} via BROWSER_FILEREADER…`);
    try {
      const client = await ensureEngineReady();
      await client.registerFile(file, virtualName);
      const targetTable = sanitizeTableName(file.name);
      const lazyIngestSql = buildLazyFileIngestSql(sourceKind, virtualName, targetTable);
      await client.exec(lazyIngestSql);
      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS total_rows FROM ${ident(targetTable)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(`SELECT * FROM ${ident(targetTable)} LIMIT 500;`, 500);
      const loaded: LoadedTableMeta = {
        id: targetTable,
        displayName: file.name,
        baseAlias: targetTable,
        alias: targetTable,
        sourceKind,
        bytes: file.size,
        rowCount,
        rejectCount: 0,
        columns: preview.columns,
      };
      registerLoadedTable(loaded, {
        virtualName,
        file,
        ingestSql: lazyIngestSql,
      });
      pageCacheRef.current.set(`${targetTable}:0`, preview);
      setQueryResult(preview, null);
      setGridPageNav({
        pageIndex: 0,
        pageSize: 500,
        totalRows: rowCount,
        cacheHit: false,
        onChangePage: (next) => {
          void previewAliasInGrid(client, targetTable, rowCount, next);
        },
      });
      applyLoadedSelectionDefaults(loaded);
      setIngestModalOpen(false);
      navigateFeature('data');
      setStatusNote(
        `Opened ${sourceKind.toUpperCase()} "${targetTable}" (${rowCount.toLocaleString('en-US')} rows${sourceKind === 'parquet' ? ', lazy VIEW' : ''}).`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`Failed loading ${file.name}: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadMessyDemo(): Promise<void> {
    const csv = buildSyntheticMessyPayrollCsv(1200);
    await stageCsvTextOrFile({
      displayName: 'payroll_export_q4_messy.csv',
      virtualName: 'payroll_export_q4_messy.csv',
      bytes: new TextEncoder().encode(csv).length,
      text: csv,
    });
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void ingestLocalFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingestLocalFile(file);
  }

  async function handleRunProfile(): Promise<void> {
    if (!activeTable) return;
    setBusy(true, `Running SUMMARIZE & issue probes on ${activeTable.alias}…`);
    try {
      const client = await ensureEngineReady();
      const summarize = await client.queryRows(`SUMMARIZE ${ident(activeTable.alias)};`, 500);
      const probeSql = buildProfileIssueProbesSql(
        activeTable.alias,
        activeTable.columns.map((c) => c.name),
      );
      const probeRes = await client.queryRows(probeSql, 200);
      const stats = probeRes.rows.map((r) => ({
        columnName: r[0] ?? '',
        totalRows: Number(r[1] ?? 0),
        nonNullCount: Number(r[2] ?? 0),
        distinctCount: Number(r[3] ?? 0),
        whitespaceCount: Number(r[4] ?? 0),
        caseNormalizedDistinctCount: Number(r[5] ?? 0),
        rejectCount: activeTable.rejectCount > 0 && r[0] === 'amount' ? activeTable.rejectCount : 0,
      }));
      const issues = detectProfileIssues(stats);
      const sampleForSparks =
        pageCacheRef.current.get(`${activeTable.alias}:0`) ??
        (await previewAliasInGrid(client, activeTable.alias, activeTable.rowCount, 0));
      const sparklines = buildSparklineBuckets(activeTable.columns, sampleForSparks);

      setProfileState({
        tableAlias: activeTable.alias,
        elapsedMs: summarize.elapsedMs + probeRes.elapsedMs,
        summarize,
        issues,
        sparklines,
      });
      setStatusNote(
        `Profiled "${activeTable.alias}" (${issues.length} issue flag(s)) in ${(summarize.elapsedMs + probeRes.elapsedMs).toFixed(1)} ms.`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyOneClickIssueFix(issue: ProfileIssue): Promise<void> {
    if (!activeTable || !issue.fixAction) return;
    if (issue.fixAction === 'inspect_rejects') {
      const rejTbl = tables.find((t) => t.id === '_rejects');
      if (rejTbl) {
        await handleSelectTable(rejTbl);
      }
      return;
    }

    const stepIndex = recipe.head + 1;
    const stepId = `s${stepIndex}`;
    const targetAlias = `${activeTable.baseAlias}@${stepId}`;

    let compiled: { sql: string; label: string };
    let step: Step;
    if (issue.fixAction === 'lowercase') {
      compiled = compileLowercaseColumnSql(activeTable.alias, targetAlias, issue.columnName);
      step = {
        id: stepId,
        op: 'derive',
        table: activeTable.alias,
        column: issue.columnName,
        expr: { kind: 'sql', expression: `lower(trim(${ident(issue.columnName)}::VARCHAR))` },
      };
    } else if (issue.fixAction === 'trim') {
      step = { id: stepId, op: 'trim', table: activeTable.alias, columns: [issue.columnName] };
      compiled = compileCleanStepSql(activeTable.alias, targetAlias, step);
    } else if (issue.fixAction === 'drop') {
      step = { id: stepId, op: 'drop', table: activeTable.alias, columns: [issue.columnName] };
      compiled = compileCleanStepSql(activeTable.alias, targetAlias, step);
    } else {
      step = {
        id: stepId,
        op: 'dedupe',
        table: activeTable.alias,
        keys: [issue.columnName],
        keep: 'first',
      };
      compiled = compileCleanStepSql(activeTable.alias, targetAlias, step);
    }

    setBusy(true, `Applying one-click fix: ${compiled.label}…`);
    try {
      const client = await ensureEngineReady();
      await client.exec(compiled.sql);
      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(`SELECT * FROM ${ident(targetAlias)} LIMIT 500;`, 500);

      recordExecutedStep(step, {
        stepId,
        label: compiled.label,
        tableId: activeTable.id,
        targetAlias,
        sql: compiled.sql,
        rowCount,
        columns: preview.columns,
      });
      pageCacheRef.current.set(`${targetAlias}:0`, preview);
      setQueryResult(preview, null);
      setGridPageNav({
        pageIndex: 0,
        pageSize: 500,
        totalRows: rowCount,
        cacheHit: false,
        onChangePage: (next) => {
          void previewAliasInGrid(client, targetAlias, rowCount, next);
        },
      });
      setStatusNote(`Applied "${compiled.label}" → ${rowCount.toLocaleString('en-US')} rows.`);
      await refreshMemoryGauge();
    } finally {
      setBusy(false);
    }
  }

  async function handleRunSql(): Promise<void> {
    if (!sqlSafety.ok) {
      const uriBlocked = sqlSafety.reasons.some((r) => r.includes('URI scheme'));
      if (uriBlocked || !allowTrustedDdl) {
        setQueryResult(
          null,
          `SQL Safety Guard blocked execution:\n- ${sqlSafety.reasons.join('\n- ')}`,
        );
        return;
      }
    }

    setBusy(true, 'Executing SQL in local DuckDB worker…');
    try {
      const client = await ensureEngineReady();
      const res = await client.queryRows(sqlDraft, 2500);
      setGridPageNav(null);
      setQueryResult(res, null);
      setStatusNote(
        `Query returned ${res.totalRowsReturned} row(s) in ${res.elapsedMs.toFixed(1)} ms.`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGridPageNav(null);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  function buildCandidateCleanStep(stepIndex: number): { step?: Step; error?: string } {
    if (!activeTable) return { error: 'Load a table first.' };
    const stepId = `s${stepIndex}`;
    const table = activeTable.alias;

    switch (cleanOp) {
      case 'trim':
        return { step: { id: stepId, op: 'trim', table, columns: userColumns.map((c) => c.name) } };
      case 'case':
        return {
          step: { id: stepId, op: 'case', table, columns: [cleanPrimaryCol], mode: cleanCaseMode },
        };
      case 'dedupe':
        return {
          step: {
            id: stepId,
            op: 'dedupe',
            table,
            keys: [cleanPrimaryCol],
            keep: cleanDedupeKeep,
            orderBy: cleanOrderCol || undefined,
          },
        };
      case 'filter':
        return {
          step: {
            id: stepId,
            op: 'filter',
            table,
            predicate: {
              column: cleanPrimaryCol,
              op: cleanFilterOp,
              value: cleanFilterOp === 'not_null' ? null : cleanFilterVal,
            },
          },
        };
      case 'cast':
        return {
          step: {
            id: stepId,
            op: 'cast',
            table,
            column: cleanPrimaryCol,
            to: cleanCastType,
            onFail: 'null',
          },
        };
      case 'derive': {
        const col = cleanDeriveCol.trim();
        const expr = cleanDeriveExpr.trim();
        if (!col || !expr) return { error: 'Provide both target column name and SQL expression.' };
        return {
          step: {
            id: stepId,
            op: 'derive',
            table,
            column: col,
            expr: { kind: 'sql', expression: expr },
          },
        };
      }
      case 'rename': {
        const targetName = cleanRenameTo.trim();
        if (!targetName || targetName === cleanPrimaryCol) {
          return { error: 'Choose a distinct target column name before renaming.' };
        }
        return { step: { id: stepId, op: 'rename', table, from: cleanPrimaryCol, to: targetName } };
      }
      case 'drop':
        return { step: { id: stepId, op: 'drop', table, columns: [cleanPrimaryCol] } };
      case 'reorder': {
        const cols = cleanReorderCsv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (cols.length === 0) return { error: 'Enter comma-separated column names to reorder.' };
        return { step: { id: stepId, op: 'reorder', table, columns: cols } };
      }
      case 'replace':
        return {
          step: {
            id: stepId,
            op: 'replace',
            table,
            column: cleanPrimaryCol,
            search: cleanReplaceSearch,
            replacement: cleanReplaceWith,
          },
        };
      case 'regexExtract': {
        const into = cleanRegexInto.trim();
        if (!cleanRegexPattern || !into)
          return { error: 'Provide regex pattern and output column.' };
        return {
          step: {
            id: stepId,
            op: 'regexExtract',
            table,
            column: cleanPrimaryCol,
            pattern: cleanRegexPattern,
            into,
            group: 1,
          },
        };
      }
      case 'split': {
        const into = cleanSplitInto
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (into.length === 0) return { error: 'Provide comma-separated output column names.' };
        return {
          step: {
            id: stepId,
            op: 'split',
            table,
            column: cleanPrimaryCol,
            delimiter: cleanSplitDelim,
            into,
          },
        };
      }
      case 'merge': {
        const cols = cleanMergeCols
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const into = cleanMergeInto.trim();
        if (cols.length < 2 || !into) {
          return { error: 'Provide at least 2 comma-separated columns and output column name.' };
        }
        return {
          step: { id: stepId, op: 'merge', table, columns: cols, separator: cleanMergeSep, into },
        };
      }
      case 'fillNulls':
        return {
          step: {
            id: stepId,
            op: 'fillNulls',
            table,
            column: cleanPrimaryCol,
            strategy: cleanFillStrategy,
            value: cleanFillStrategy === 'value' ? cleanFillVal : undefined,
          },
        };
      case 'parseDate':
        return {
          step: {
            id: stepId,
            op: 'parseDate',
            table,
            column: cleanPrimaryCol,
            format: cleanDateFmt,
          },
        };
      case 'parseNumber':
        return {
          step: {
            id: stepId,
            op: 'parseNumber',
            table,
            column: cleanPrimaryCol,
            locale: cleanNumLocale,
          },
        };
      case 'fuzzyDedupe':
        return { error: 'Use "Find Fuzzy Candidates" and the Review Queue below.' };
      case 'pivot':
        return { error: 'Configure Pivot options and click "Apply Pivot" below.' };
      case 'unpivot':
        return { error: 'Select columns to unpivot and click "Apply Unpivot" below.' };
    }
  }

  const candidateCleanPreview = (() => {
    if (!activeTable || activeFeature !== 'clean') return null;
    const stepIndex = recipe.head + 1;
    const targetAlias = `${activeTable.baseAlias}@s${stepIndex}`;
    const candidate = buildCandidateCleanStep(stepIndex);
    if (!candidate.step) return null;
    try {
      return {
        checkpoint: stepIndex % 5 === 0,
        compiled: compileCleanStepSql(activeTable.alias, targetAlias, candidate.step, {
          checkpoint: stepIndex % 5 === 0,
        }),
      };
    } catch {
      return null;
    }
  })();

  async function handleApplyCleanStep(): Promise<void> {
    if (!activeTable) return;
    const stepIndex = recipe.head + 1;
    const stepId = `s${stepIndex}`;
    const targetAlias = `${activeTable.baseAlias}@${stepId}`;

    const candidate = buildCandidateCleanStep(stepIndex);
    if (!candidate.step) {
      if (candidate.error) setStatusNote(candidate.error);
      return;
    }
    const step = candidate.step;

    setBusy(true, `Applying ${step.op} (${stepId})…`);
    try {
      const client = await ensureEngineReady();
      const compiled = compileCleanStepSql(activeTable.alias, targetAlias, step, {
        checkpoint: stepIndex % 5 === 0,
      });
      await client.exec(compiled.sql);

      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(`SELECT * FROM ${ident(targetAlias)} LIMIT 500;`, 500);

      recordExecutedStep(step, {
        stepId,
        label: compiled.label,
        tableId: activeTable.id,
        targetAlias,
        sql: compiled.sql,
        rowCount,
        columns: preview.columns,
      });
      pageCacheRef.current.set(`${targetAlias}:0`, preview);
      setQueryResult(preview, null);
      setGridPageNav({
        pageIndex: 0,
        pageSize: 500,
        totalRows: rowCount,
        cacheHit: false,
        onChangePage: (next) => {
          void previewAliasInGrid(client, targetAlias, rowCount, next);
        },
      });
      setStatusNote(`Applied "${compiled.label}" → ${rowCount.toLocaleString('en-US')} rows.`);
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleScanPii(): Promise<void> {
    if (!activeTable) return;
    setBusy(true, `Scanning "${activeTable.alias}" for PII with @dewpond/pii…`);
    try {
      const client = await ensureEngineReady();
      const sampleRes = await client.queryRows(
        `SELECT * FROM ${ident(activeTable.alias)} LIMIT 250;`,
        250,
      );

      const allFindings: PiiFinding[] = [];
      const nextPlans: Record<string, RedactColumnPlan['mode']> = {};

      for (let c = 0; c < sampleRes.columns.length; c++) {
        const colName = sampleRes.columns[c]!.name;
        if (colName === '__rid') continue;
        const vals = sampleRes.rows.map((r) => {
          const val = r[c];
          return val === 'NULL' || val === undefined ? null : val;
        });
        const found = scanColumnSample(colName, vals);
        allFindings.push(...found);
        nextPlans[colName] = redactPlans[colName] ?? defaultRedactionForFindings(found);
      }

      setPiiFindings(allFindings);
      setRedactPlans(nextPlans);
      setStatusNote(
        `PII scan found ${allFindings.length} detector match(es) across ${sampleRes.columns.length - 1} column(s); zero raw values stored.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyRedaction(): Promise<void> {
    if (!activeTable) return;
    const plans: RedactColumnPlan[] = userColumns.map((col) => {
      const mode = redactPlans[col.name] ?? 'keep';
      return {
        columnName: col.name,
        mode,
        keepStart: 2,
        keepEnd: 2,
        maskChar: '*',
        generalizeStrategy: col.type.startsWith('Date') ? 'date_month' : 'numeric_bucket',
        bucketSize: 1000,
      };
    });

    const changedCols = plans.filter((p) => p.mode !== 'keep');
    if (changedCols.length === 0) {
      setStatusNote('Select at least one mask, hash, generalize, shuffle, or drop action first.');
      return;
    }

    const stepIndex = recipe.head + 1;
    const stepId = `s${stepIndex}`;
    const targetAlias = `${activeTable.baseAlias}@${stepId}`;
    const firstRedacted = changedCols[0]!;

    const sql = compileRedactViewSql(
      activeTable.alias,
      targetAlias,
      plans,
      redactSalt,
      shuffleSeed,
    );

    const step: Step = {
      id: stepId,
      op: 'redact',
      table: activeTable.alias,
      column: changedCols.map((c) => c.columnName).join(', '),
      action:
        firstRedacted.mode === 'hash_sha256'
          ? { mode: 'hash_sha256', salt: redactSalt }
          : firstRedacted.mode === 'shuffle'
            ? { mode: 'shuffle', seed: shuffleSeed }
            : firstRedacted.mode === 'drop'
              ? { mode: 'drop' }
              : firstRedacted.mode === 'generalize'
                ? { mode: 'generalize', strategy: 'date_month' }
                : { mode: 'mask', keepStart: 2, keepEnd: 2, maskChar: '*' },
    };

    setBusy(true, `Applying PII redaction (${changedCols.length} columns)…`);
    try {
      const client = await ensureEngineReady();
      await client.exec(sql);

      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(`SELECT * FROM ${ident(targetAlias)} LIMIT 500;`, 500);

      recordExecutedStep(step, {
        stepId,
        label: `Redact ${changedCols.length} column(s)`,
        tableId: activeTable.id,
        targetAlias,
        sql,
        rowCount,
        columns: preview.columns,
      });
      pageCacheRef.current.set(`${targetAlias}:0`, preview);
      setQueryResult(preview, null);
      setGridPageNav({
        pageIndex: 0,
        pageSize: 500,
        totalRows: rowCount,
        cacheHit: false,
        onChangePage: (next) => {
          void previewAliasInGrid(client, targetAlias, rowCount, next);
        },
      });
      setLastRedactTimestamp(Date.now());
      setStatusNote(
        `Created redacted table "${targetAlias}" (${changedCols.length} column(s) transformed).`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckKAnonymity(): Promise<void> {
    if (!activeTable || qiColumns.length === 0) return;
    setBusy(true, 'Checking quasi-identifier cohort sizes…');
    try {
      const client = await ensureEngineReady();
      const sql = buildKAnonymityQuery(activeTable.alias, qiColumns, kThreshold);
      const res = await client.queryRows(sql, 100);
      setKAnonResult(res);
      setStatusNote(
        res.rows.length === 0
          ? `k-anonymity check passed: all cohorts have at least k = ${kThreshold} rows.`
          : `Found ${res.rows.length} quasi-identifier cohort(s) below k = ${kThreshold}.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  function buildRedactAuditReport(): RedactionAuditReport | null {
    if (!activeTable) return null;
    return {
      generatedAt: new Date(lastRedactTimestamp ?? Date.now()).toISOString(),
      tableAlias: activeTable.alias,
      rowCount: activeTable.rowCount,
      containsRawCellValues: false,
      detectors: piiFindings,
      appliedActions: Object.entries(redactPlans).map(([columnName, mode]) => ({
        columnName,
        mode,
      })),
      kAnonymityThreshold: kThreshold,
      quasiIdentifiers: qiColumns,
      smallCohortsDetected: kAnonResult?.rows.length ?? null,
    };
  }

  function handleDownloadRedactReport(format: 'json' | 'md'): void {
    const report = buildRedactAuditReport();
    if (!report || !activeTable) return;
    if (format === 'md') {
      triggerBlobDownload(
        `${activeTable.baseAlias}_redaction_report.md`,
        formatRedactionReportMarkdown(report),
        'text/markdown;charset=utf-8',
      );
      return;
    }
    triggerBlobDownload(
      `${activeTable.baseAlias}_redaction_report.json`,
      JSON.stringify(report, null, 2),
      'application/json',
    );
  }

  async function handleExportData(
    format: 'csv' | 'json' | 'ndjson' | 'parquet' | 'xlsx' | 'duckdb',
  ): Promise<void> {
    if (!activeTable) return;
    setBusy(true, `Exporting "${activeTable.alias}" as ${format.toUpperCase()}…`);
    try {
      const client = await ensureEngineReady();
      if (format === 'duckdb') {
        const bytes = await client.exportDuckdbFile([
          { alias: activeTable.alias, exportName: activeTable.baseAlias },
        ]);
        triggerBlobDownload(`${activeTable.baseAlias}.duckdb`, bytes, 'application/octet-stream');
        setStatusNote(`Exported ${activeTable.alias} as DUCKDB (${formatBytes(bytes.length)}).`);
        return;
      }
      const res = await client.queryRows(
        `SELECT * EXCLUDE ("__rid") FROM ${ident(activeTable.alias)} LIMIT 250000;`,
        250000,
      );
      let bytes: Uint8Array;
      let mime: string;

      if (format === 'csv') {
        bytes = buildCsvExportBytes(res.columns, res.rows, neutralizeFormulas);
        mime = 'text/csv;charset=utf-8';
      } else if (format === 'json') {
        bytes = buildJsonExportBytes(res.columns, res.rows);
        mime = 'application/json';
      } else if (format === 'ndjson') {
        bytes = buildNdjsonExportBytes(res.columns, res.rows);
        mime = 'application/x-ndjson';
      } else if (format === 'parquet') {
        bytes = buildParquetExportBytes(res.columns, res.rows);
        mime = 'application/vnd.apache.parquet';
      } else {
        bytes = buildXlsxExportBytes(res.columns, res.rows, neutralizeFormulas);
        mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }

      triggerBlobDownload(`${activeTable.baseAlias}.${format}`, bytes, mime);
      setStatusNote(
        `Exported ${activeTable.alias} as ${format.toUpperCase()} (${formatBytes(bytes.length)}).`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`Export failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleExportHtmlReport(): Promise<void> {
    if (!activeTable) return;
    setBusy(true, `Building self-contained HTML report for "${activeTable.alias}"…`);
    try {
      const client = await ensureEngineReady();
      const res = await client.queryRows(
        `SELECT * EXCLUDE ("__rid") FROM ${ident(activeTable.alias)} LIMIT 50;`,
        50,
      );
      const htmlBytes = buildSelfContainedHtmlReport({
        datasetName: activeTable.displayName,
        activeAlias: activeTable.alias,
        rowCount: activeTable.rowCount,
        columns: res.columns,
        previewRows: res.rows,
        steps: stepSnapshots.slice(0, recipe.head).map((s) => ({
          stepId: s.stepId,
          label: s.label,
          sql: s.sql,
        })),
        issues:
          profileState?.tableAlias === activeTable.alias
            ? profileState.issues.map((i) => ({
                columnName: i.columnName,
                severity: i.severity,
                message: i.message,
              }))
            : [],
        redactModes: redactPlans,
        pinnedCharts: pinnedReportCharts,
      });
      triggerBlobDownload(
        `${activeTable.baseAlias}_report.html`,
        htmlBytes,
        'text/html;charset=utf-8',
      );
      setStatusNote(`Exported self-contained HTML report (${formatBytes(htmlBytes.length)}).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`HTML report export failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleExportTokenKeyMap(format: 'json' | 'csv'): Promise<void> {
    if (!activeTable) return;
    const tokenizedCols = Object.entries(redactPlans)
      .filter(([, mode]) => mode === 'hash_sha256')
      .map(([col]) => col);
    if (tokenizedCols.length === 0) {
      setStatusNote(
        'Mark at least one column as "Hash (SHA-256 + salt)" in Redact first to export a reversible key map.',
      );
      return;
    }
    setBusy(true, `Generating reversible key map for ${tokenizedCols.length} column(s)…`);
    try {
      const client = await ensureEngineReady();
      const sql = buildTokenizationKeyMapSql(activeTable.baseAlias, tokenizedCols, redactSalt);
      const res = await client.queryRows(sql, 200000);
      if (format === 'json') {
        const entries = res.rows.map((r) => ({
          column: String(r[0] ?? ''),
          original: String(r[1] ?? ''),
          token: String(r[2] ?? ''),
        }));
        const bytes = buildTokenizationKeyMapJson(activeTable.baseAlias, entries);
        triggerBlobDownload(`${activeTable.baseAlias}.keymap.json`, bytes, 'application/json');
        setStatusNote(`Exported reversible key map JSON (${entries.length} entries).`);
      } else {
        const bytes = buildCsvExportBytes(res.columns, res.rows, neutralizeFormulas);
        triggerBlobDownload(`${activeTable.baseAlias}.keymap.csv`, bytes, 'text/csv;charset=utf-8');
        setStatusNote(`Exported reversible key map CSV (${res.rows.length} entries).`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`Key map export failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  const compareCandidates = (() => {
    const out: Array<{ alias: string; columns: GridColumnMeta[] }> = [];
    const seen = new Set<string>();
    for (const t of tables) {
      if (!seen.has(t.baseAlias)) {
        seen.add(t.baseAlias);
        out.push({ alias: t.baseAlias, columns: t.columns });
      }
      if (!seen.has(t.alias)) {
        seen.add(t.alias);
        out.push({ alias: t.alias, columns: t.columns });
      }
    }
    for (const snap of stepSnapshots) {
      if (!seen.has(snap.targetAlias)) {
        seen.add(snap.targetAlias);
        out.push({ alias: snap.targetAlias, columns: snap.columns });
      }
    }
    return out;
  })();

  const resolvedLeftAlias =
    compareLeftAlias && compareCandidates.some((c) => c.alias === compareLeftAlias)
      ? compareLeftAlias
      : (compareCandidates[0]?.alias ?? '');
  const resolvedRightAlias =
    compareRightAlias && compareCandidates.some((c) => c.alias === compareRightAlias)
      ? compareRightAlias
      : (compareCandidates[1]?.alias ?? compareCandidates[0]?.alias ?? '');
  const leftSchemaCols =
    compareCandidates.find((c) => c.alias === resolvedLeftAlias)?.columns ?? [];
  const rightSchemaCols =
    compareCandidates.find((c) => c.alias === resolvedRightAlias)?.columns ?? [];
  const compareSchemaDiff = computeSchemaDiff(leftSchemaCols, rightSchemaCols);

  async function handleRunCompare(
    statusOverride?: 'all' | 'added' | 'removed' | 'changed' | 'unchanged',
  ): Promise<void> {
    if (!resolvedLeftAlias || !resolvedRightAlias) return;
    const keys =
      compareKeys.length > 0
        ? compareKeys.filter((k) => compareSchemaDiff.shared.includes(k))
        : compareSchemaDiff.shared[0]
          ? [compareSchemaDiff.shared[0]]
          : [];
    if (keys.length === 0) {
      setStatusNote('Select at least one shared key column to run Compare (Diff).');
      return;
    }

    const activeFilter = statusOverride ?? compareStatusFilter;
    if (statusOverride) setCompareStatusFilter(statusOverride);
    const compareColumns = compareSchemaDiff.shared.filter((c) => !keys.includes(c));

    setBusy(true, `Comparing ${resolvedLeftAlias} vs ${resolvedRightAlias}…`);
    try {
      const client = await ensureEngineReady();
      const [leftUniq, rightUniq, sumRes, diffRes] = await Promise.all([
        client.queryRows(buildKeyUniquenessCheckSql(resolvedLeftAlias, keys), 1),
        client.queryRows(buildKeyUniquenessCheckSql(resolvedRightAlias, keys), 1),
        client.queryRows(
          buildCompareSummarySql({
            leftAlias: resolvedLeftAlias,
            rightAlias: resolvedRightAlias,
            keyColumns: keys,
            compareColumns,
          }),
          1,
        ),
        client.queryRows(
          buildCompareDiffSql({
            leftAlias: resolvedLeftAlias,
            rightAlias: resolvedRightAlias,
            keyColumns: keys,
            compareColumns,
            statusFilter: activeFilter,
          }),
          2500,
        ),
      ]);

      const leftDuplicates = Number(leftUniq.rows[0]?.[1] ?? 0);
      const rightDuplicates = Number(rightUniq.rows[0]?.[1] ?? 0);
      const summary = {
        added: Number(sumRes.rows[0]?.[0] ?? 0),
        removed: Number(sumRes.rows[0]?.[1] ?? 0),
        changed: Number(sumRes.rows[0]?.[2] ?? 0),
        unchanged: Number(sumRes.rows[0]?.[3] ?? 0),
        leftDuplicates,
        rightDuplicates,
      };
      setCompareSummary(summary);
      setCompareLastResult(diffRes);
      setGridPageNav(null);
      setQueryResult(diffRes, null);
      setStatusNote(
        `Diff (${resolvedLeftAlias} vs ${resolvedRightAlias}): ${summary.changed} changed, ${summary.added} added, ${summary.removed} removed, ${summary.unchanged} unchanged.`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`Compare failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleFindFuzzyCandidates(): Promise<void> {
    if (!activeTable) return;
    setBusy(true, 'Scanning blocking groups for fuzzy duplicates…');
    try {
      const client = await ensureEngineReady();
      const tolNum = Number(fuzzyTolDelta);
      const sql = buildFuzzyDedupeCandidatesSql({
        tableAlias: activeTable.alias,
        matchColumn: cleanPrimaryCol,
        blockingMode: fuzzyBlockMode,
        minSimilarity: fuzzyMinSim,
        numericColumn: fuzzyTolCol || undefined,
        numericTolerance: fuzzyTolCol && Number.isFinite(tolNum) ? tolNum : undefined,
      });
      const res = await client.queryRows(sql, 200);
      const pairs = res.rows.map((r) => ({
        keepRid: String(r[0] ?? ''),
        dropRid: String(r[1] ?? ''),
        leftValue: String(r[2] ?? ''),
        rightValue: String(r[3] ?? ''),
        similarity: String(r[4] ?? ''),
        editDist: String(r[5] ?? ''),
      }));
      setFuzzyQueue(pairs);
      setFuzzyApprovedDrops(pairs.map((p) => p.dropRid).filter(Boolean));
      setStatusNote(`Found ${pairs.length} fuzzy duplicate candidate(s) in review queue.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommitFuzzyMerges(): Promise<void> {
    if (!activeTable || fuzzyApprovedDrops.length === 0) return;
    const stepIndex = recipe.head + 1;
    const stepId = `s${stepIndex}`;
    const targetAlias = `${activeTable.baseAlias}@${stepId}`;
    const sql = buildFuzzyDedupeCommitSql(activeTable.alias, targetAlias, fuzzyApprovedDrops);

    setBusy(true, `Committing ${fuzzyApprovedDrops.length} approved fuzzy merge(s)…`);
    try {
      const client = await ensureEngineReady();
      await client.exec(sql);
      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(`SELECT * FROM ${ident(targetAlias)} LIMIT 500;`, 500);
      recordExecutedStep(
        {
          id: stepId,
          op: 'rawSql',
          sql: `SELECT * FROM ${ident(activeTable.alias)} WHERE "__rid"::VARCHAR NOT IN (${fuzzyApprovedDrops.map((r) => lit(r)).join(', ')})`,
          as: targetAlias,
          trusted: true,
        },
        {
          stepId,
          label: `Fuzzy dedupe (${fuzzyApprovedDrops.length} merged)`,
          tableId: activeTable.id,
          targetAlias,
          sql,
          rowCount,
          columns: preview.columns,
        },
      );
      pageCacheRef.current.set(`${targetAlias}:0`, preview);
      setQueryResult(preview, null);
      setFuzzyQueue([]);
      setFuzzyApprovedDrops([]);
      setStatusNote(`Committed fuzzy dedupe → ${rowCount.toLocaleString('en-US')} rows.`);
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyPivot(): Promise<void> {
    if (!activeTable) return;
    const onCol = pivotOnCol || userColumns[0]?.name || '';
    const valCol = pivotValueCol || userColumns[0]?.name || '';
    if (!onCol || !valCol) {
      setQueryResult(null, 'Select both a Pivot Column (ON) and a Value Column (USING).');
      return;
    }
    const cap = Math.max(2, Math.min(200, Math.round(pivotMaxCols || 40)));
    setBusy(true, `Checking cardinality on "${onCol}" (cap: ${cap})…`);
    try {
      const client = await ensureEngineReady();
      const cardRes = await client.queryRows(buildPivotCardinalitySql(activeTable.alias, onCol), 1);
      const distinctCount = Number(cardRes.rows[0]?.[0] ?? 0);
      if (distinctCount <= 0) {
        setQueryResult(null, `Pivot column "${onCol}" has no distinct values.`);
        return;
      }
      if (distinctCount > cap) {
        setQueryResult(
          null,
          `Column-cardinality cap exceeded: "${onCol}" has ${distinctCount} distinct values (cap: ${cap}). Increase the cap or filter rows first.`,
        );
        return;
      }
      const stepIndex = recipe.head + 1;
      const stepId = `s${stepIndex}`;
      const targetAlias = `${activeTable.baseAlias}@${stepId}`;
      const sql = buildPivotSql({
        sourceAlias: activeTable.alias,
        targetAlias,
        indexColumns: pivotIndexCols,
        pivotColumn: onCol,
        valueColumn: valCol,
        aggFn: pivotAgg,
      });
      await client.exec(sql);
      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(`SELECT * FROM ${ident(targetAlias)} LIMIT 500;`, 500);
      recordExecutedStep(
        {
          id: stepId,
          op: 'rawSql',
          sql: `SELECT * FROM ${ident(targetAlias)}`,
          as: targetAlias,
          trusted: true,
        },
        {
          stepId,
          label: `Pivot ${onCol} (${pivotAgg}(${valCol}))`,
          tableId: activeTable.id,
          targetAlias,
          sql,
          rowCount,
          columns: preview.columns,
        },
      );
      pageCacheRef.current.set(`${targetAlias}:0`, preview);
      setQueryResult(preview, null);
      setStatusNote(
        `Pivoted "${onCol}" (${distinctCount} cols, cap ${cap}) → ${rowCount.toLocaleString('en-US')} rows.`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyUnpivot(): Promise<void> {
    if (!activeTable) return;
    if (unpivotCols.length === 0) {
      setQueryResult(null, 'Select at least one column to unpivot.');
      return;
    }
    const stepIndex = recipe.head + 1;
    const stepId = `s${stepIndex}`;
    const targetAlias = `${activeTable.baseAlias}@${stepId}`;
    setBusy(true, `Unpivoting ${unpivotCols.length} column(s)…`);
    try {
      const client = await ensureEngineReady();
      const sql = buildUnpivotSql({
        sourceAlias: activeTable.alias,
        targetAlias,
        unpivotColumns: unpivotCols,
        nameColumn: unpivotNameCol,
        valueColumn: unpivotValueCol,
      });
      await client.exec(sql);
      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(`SELECT * FROM ${ident(targetAlias)} LIMIT 500;`, 500);
      recordExecutedStep(
        {
          id: stepId,
          op: 'rawSql',
          sql: `SELECT * FROM ${ident(targetAlias)}`,
          as: targetAlias,
          trusted: true,
        },
        {
          stepId,
          label: `Unpivot (${unpivotCols.length} cols → ${unpivotNameCol.trim() || 'attribute'})`,
          tableId: activeTable.id,
          targetAlias,
          sql,
          rowCount,
          columns: preview.columns,
        },
      );
      pageCacheRef.current.set(`${targetAlias}:0`, preview);
      setQueryResult(preview, null);
      setStatusNote(
        `Unpivoted ${unpivotCols.length} column(s) → ${rowCount.toLocaleString('en-US')} rows.`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleBuildChart(override?: {
    type?: ChartType;
    xCol?: string;
    yCol?: string;
  }): Promise<void> {
    if (!activeTable) return;
    const effType = override?.type ?? chartType;
    const xCol = override?.xCol ?? (chartXCol || userColumns[0]?.name || '');
    const yCol =
      override?.yCol ?? (chartYCol || userColumns[1]?.name || userColumns[0]?.name || '');
    if (!xCol) {
      setStatusNote('Select an X-axis column to build a chart.');
      return;
    }
    setBusy(true, `Aggregating ${effType} chart in DuckDB…`);
    try {
      const client = await ensureEngineReady();
      if (effType === 'scatter') {
        if (!yCol) {
          setStatusNote('Select both X and Y numeric columns for a scatter plot.');
          return;
        }
        const sql = buildScatterChartSql({
          tableAlias: activeTable.alias,
          xColumn: xCol,
          yColumn: yCol,
        });
        const res = await client.queryRows(sql, 1200);
        setChartScatterData(
          res.rows
            .map((r) => ({ x: Number(r[0]), y: Number(r[1]) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        );
        setChartCategoryData([]);
        setChartBoxData([]);
        setChartTitle(`${yCol} vs ${xCol} (${activeTable.alias})`);
        setStatusNote(`Plotted ${res.rows.length} scatter points.`);
        return;
      }

      if (effType === 'box') {
        if (!yCol) {
          setStatusNote('Select a numeric Y column for the Box / Outlier plot.');
          return;
        }
        const sql = buildBoxPlotChartSql({
          tableAlias: activeTable.alias,
          xColumn: xCol,
          yColumn: yCol,
          topN: chartTopN,
        });
        const res = await client.queryRows(sql, 30);
        const boxes: ChartBoxPoint[] = res.rows.map((r) => ({
          label: String(r[0] ?? '(null)'),
          min: Number(r[1] ?? 0),
          q1: Number(r[2] ?? 0),
          median: Number(r[3] ?? 0),
          q3: Number(r[4] ?? 0),
          max: Number(r[5] ?? 0),
          count: Number(r[6] ?? 0),
        }));
        setChartBoxData(boxes);
        setChartCategoryData([]);
        setChartScatterData([]);
        setChartTitle(`Outliers & Quartiles: ${yCol} by ${xCol}`);
        setStatusNote(`Rendered Box/Outlier summary (${boxes.length} groups).`);
        return;
      }

      const sql =
        effType === 'histogram'
          ? buildHistogramChartSql({
              tableAlias: activeTable.alias,
              column: xCol,
              bins: chartBins,
            })
          : effType === 'line'
            ? buildLineChartSql({
                tableAlias: activeTable.alias,
                xColumn: xCol,
                yColumn: yCol,
                aggFn: chartAgg,
                timeGrain: chartTimeGrain,
              })
            : buildBarChartSql({
                tableAlias: activeTable.alias,
                xColumn: xCol,
                yColumn: yCol,
                seriesColumn: chartSeriesCol || undefined,
                aggFn: chartAgg,
                topN: chartTopN,
              });
      const res = await client.queryRows(sql, 500);
      const points: ChartCategoryPoint[] = res.rows.map((r) => ({
        label: String(r[0] ?? '(null)'),
        value: Number(r[1] ?? 0),
        series: effType === 'bar' && chartSeriesCol ? String(r[2] ?? '(null)') : undefined,
        binMin: effType === 'histogram' && r[2] !== undefined ? Number(r[2]) : undefined,
        binMax: effType === 'histogram' && r[3] !== undefined ? Number(r[3]) : undefined,
      }));
      setChartCategoryData(points);
      setChartScatterData([]);
      setChartBoxData([]);
      setChartTitle(
        effType === 'histogram'
          ? `Distribution of ${xCol} (${chartBins} bins)`
          : `${chartAgg === 'COUNT' ? 'COUNT(*)' : `${chartAgg}(${yCol})`} by ${xCol}`,
      );
      setStatusNote(`Rendered ${effType} chart (${points.length} groups/bins).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunFuzzyReconcile(): Promise<void> {
    if (!resolvedLeftAlias || !resolvedRightAlias) return;
    const keyCol = compareKeys[0] ?? compareSchemaDiff.shared[0];
    if (!keyCol) {
      setStatusNote('Select a shared key column for Fuzzy Reconcile.');
      return;
    }
    setBusy(true, `Fuzzy reconciling ${resolvedLeftAlias} vs ${resolvedRightAlias}…`);
    try {
      const client = await ensureEngineReady();
      const tolNum = Number(fuzzyTolDelta);
      const sql = buildFuzzyReconcileSql({
        leftAlias: resolvedLeftAlias,
        rightAlias: resolvedRightAlias,
        keyColumn: keyCol,
        blockingMode: fuzzyBlockMode,
        minSimilarity: fuzzyMinSim,
        numericColumn: fuzzyTolCol || undefined,
        numericTolerance: fuzzyTolCol && Number.isFinite(tolNum) ? tolNum : undefined,
      });
      const res = await client.queryRows(sql, 500);
      setCompareLastResult(res);
      setGridPageNav(null);
      setQueryResult(res, null);
      setStatusNote(
        `Fuzzy Reconcile returned ${res.rows.length} candidate match(es) using ${fuzzyBlockMode} blocking.`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  function handleExportDiff(format: 'csv' | 'xlsx'): void {
    if (!compareLastResult) return;
    const bytes =
      format === 'csv'
        ? buildCsvExportBytes(compareLastResult.columns, compareLastResult.rows, neutralizeFormulas)
        : buildXlsxExportBytes(
            compareLastResult.columns,
            compareLastResult.rows,
            neutralizeFormulas,
          );
    triggerBlobDownload(
      `diff_${resolvedLeftAlias}_vs_${resolvedRightAlias}.${format}`,
      bytes,
      format === 'csv'
        ? 'text/csv;charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  async function handleMoveHead(nextHead: number): Promise<void> {
    setHead(nextHead);
    const state = useWorkspaceStore.getState();
    const target = state.tables.find((t) => t.id === state.selectedTableId) ?? state.tables[0];
    if (target && clientRef.current?.isReady) {
      try {
        await previewAliasInGrid(clientRef.current, target.alias, target.rowCount, 0);
        setStatusNote(
          `Recipe head moved to step ${nextHead}/${recipe.steps.length} (${target.alias}).`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setQueryResult(null, msg);
      }
    }
  }

  async function handleSelectTable(table: LoadedTableMeta): Promise<void> {
    setSelectedTableId(table.id);
    setSqlDraft(`SELECT *\nFROM ${ident(table.alias)}\nLIMIT 200;`);
    if (clientRef.current?.isReady) {
      await previewAliasInGrid(clientRef.current, table.alias, table.rowCount, 0);
    }
  }

  async function handleHardCancelReset(): Promise<void> {
    const client = clientRef.current;
    if (!client) return;
    const state = useWorkspaceStore.getState();
    const sources = Object.entries(state.replaySources)
      .filter(([id]) => id !== '_rejects')
      .map(([, s]) => s);
    const stepSqls = state.stepSnapshots.slice(0, state.recipe.head).map((s) => s.sql);

    if (sources.length === 0) {
      client.cancelAndReset();
      pageCacheRef.current.clear();
      setGridPageNav(null);
      setEngineStatus('idle');
      setMemoryBytes(0);
      setBusy(false);
      setStatusNote('DuckDB worker terminated cleanly; ready to reboot on demand.');
      return;
    }

    setBusy(true, 'Terminating worker & replaying active Recipe…');
    setEngineStatus('booting');
    try {
      const info = await client.cancelAndReplay({ sources, stepSqls });
      pageCacheRef.current.clear();
      setEngineStatus('ready', { bundle: info.bundle, version: info.version });
      const active = state.tables.find((t) => t.id === state.selectedTableId) ?? state.tables[0];
      if (active && active.id !== '_rejects') {
        await previewAliasInGrid(client, active.alias, active.rowCount, 0);
      }
      await refreshMemoryGauge();
      setStatusNote(
        `Hard-cancelled worker & replayed ${sources.length} source(s) + ${stepSqls.length} step(s) cleanly.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEngineStatus('error', { error: msg });
      setStatusNote(`Hard-cancel replay failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  function handleWipeSession(): void {
    clientRef.current?.cancelAndReset();
    computeRef.current?.terminate();
    pageCacheRef.current.clear();
    setGridPageNav(null);
    setEngineStatus('idle');
    resetWorkspace();
    stagedSourceRef.current = null;
    setStagedReview(null);
    setEditOverlay(null);
    setImportedRecipe(null);
    setSavedSnapshot(null);
    setProfileState(null);
    setPiiFindings([]);
    setKAnonResult(null);
    void wipeAllLocalPersistence();
    setStatusNote(
      'Wiped in-memory tables, Recipe history, IndexedDB, OPFS snapshots, offline cache, and workers.',
    );
  }

  async function applyOverlayMutation(nextOverlay: EditOverlay): Promise<void> {
    if (!activeTable) return;
    setBusy(true, 'Applying local cell/row overlay…');
    try {
      const client = await ensureEngineReady();
      const sourceAlias = activeTable.alias.endsWith('@edits')
        ? activeTable.baseAlias
        : activeTable.alias;
      const targetAlias = `${activeTable.baseAlias}@edits`;
      const sql = compileCellRowOverlaySql(
        sourceAlias,
        targetAlias,
        activeTable.columns,
        nextOverlay,
      );
      await client.exec(sql);
      const countRes = await client.queryRows(
        `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
        1,
      );
      const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
      const preview = await client.queryRows(
        `SELECT * FROM ${ident(targetAlias)} ORDER BY "__ord" ASC, "__rid" ASC LIMIT 500;`,
        500,
      );
      setEditOverlay(nextOverlay);
      pageCacheRef.current.clear();
      pageCursorsRef.current.clear();
      pageCacheRef.current.set(`${targetAlias}:0`, preview);
      setQueryResult(preview, null);
      setGridPageNav({
        pageIndex: 0,
        pageSize: 500,
        totalRows: rowCount,
        cacheHit: false,
        keyset: true,
        onChangePage: (next) => {
          void previewAliasInGrid(client, targetAlias, rowCount, next, 0);
        },
      });
      setStatusNote(
        `Overlay applied (${nextOverlay.cellEdits.length} edit(s), ${nextOverlay.insertedRows.length} insert(s), ${nextOverlay.deletedRids.length} delete(s)) — excluded from #r= share links.`,
      );
      await refreshMemoryGauge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
    } finally {
      setBusy(false);
    }
  }

  function handleEditCell(rid: string, column: string, nextValue: string | null): void {
    if (!activeTable) return;
    const base: EditOverlay = editOverlay ?? {
      tableId: activeTable.id,
      cellEdits: [],
      deletedRids: [],
      insertedRows: [],
    };
    const filteredEdits = base.cellEdits.filter((e) => !(e.rid === rid && e.column === column));
    const insertedIdx = base.insertedRows.findIndex((r) => r.rid === rid);
    if (insertedIdx >= 0) {
      const updatedInserts = base.insertedRows.map((r, i) =>
        i === insertedIdx ? { ...r, values: { ...r.values, [column]: nextValue } } : r,
      );
      void applyOverlayMutation({ ...base, insertedRows: updatedInserts });
      return;
    }
    void applyOverlayMutation({
      ...base,
      cellEdits: [...filteredEdits, { rid, column, value: nextValue }],
    });
  }

  function handleInsertRowAfter(afterOrd: number): void {
    if (!activeTable) return;
    const base: EditOverlay = editOverlay ?? {
      tableId: activeTable.id,
      cellEdits: [],
      deletedRids: [],
      insertedRows: [],
    };
    const nextOrd = afterOrd + 0.5;
    const newRid = String(1_000_000 + base.insertedRows.length + 1);
    const values: Record<string, string | null> = {};
    for (const col of userColumns) {
      values[col.name] = null;
    }
    void applyOverlayMutation({
      ...base,
      insertedRows: [...base.insertedRows, { rid: newRid, ord: nextOrd, values }],
    });
  }

  function handleDeleteRow(rid: string): void {
    if (!activeTable) return;
    const base: EditOverlay = editOverlay ?? {
      tableId: activeTable.id,
      cellEdits: [],
      deletedRids: [],
      insertedRows: [],
    };
    const isInserted = base.insertedRows.some((r) => r.rid === rid);
    if (isInserted) {
      void applyOverlayMutation({
        ...base,
        insertedRows: base.insertedRows.filter((r) => r.rid !== rid),
      });
      return;
    }
    if (base.deletedRids.includes(rid)) return;
    void applyOverlayMutation({
      ...base,
      deletedRids: [...base.deletedRids, rid],
    });
  }

  async function handleCopyShareLink(): Promise<void> {
    const token = encodeShareRecipe({ ...recipe, overlay: editOverlay ?? undefined });
    const shareUrl = `${window.location.origin}${window.location.pathname}${token}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2000);
      setStatusNote(`Copied #r= share link (${token.length} chars) to clipboard.`);
    } catch {
      window.history.replaceState(null, '', token);
      setStatusNote(`Encoded #r= share link into URL bar (${token.length} chars).`);
    }
  }

  async function handleImportDewJson(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const res = validateRecipeJson(parsed);
      if (!res.ok) {
        setStatusNote(`Invalid .dew.json Recipe: ${res.errors.join(' ')}`);
        return;
      }
      setDriftMap({});
      setImportedRecipe(res.recipe);
      setStatusNote(
        `Loaded Recipe "${res.recipe.name}" (${res.recipe.steps.length} steps) for review.`,
      );
    } catch (err) {
      setStatusNote(
        `Failed reading .dew.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function handleReplayImportedRecipe(recipeToRun: Recipe): Promise<void> {
    if (!activeTable) {
      setStatusNote('Load a table first before replaying an imported Recipe.');
      return;
    }
    const remapped =
      Object.keys(driftMap).length > 0 ? remapRecipeColumns(recipeToRun, driftMap) : recipeToRun;
    const stepsToRun = remapped.steps.slice(0, remapped.head);
    if (stepsToRun.length === 0) {
      setImportedRecipe(null);
      return;
    }

    setBusy(true, `Replaying ${stepsToRun.length} imported step(s)…`);
    try {
      const client = await ensureEngineReady();
      let currentAlias = activeTable.alias;
      const baseIndex = recipe.head;

      for (let i = 0; i < stepsToRun.length; i++) {
        const step = stepsToRun[i]!;
        const stepNum = baseIndex + i + 1;
        const stepId = `s${stepNum}`;
        const targetAlias = `${activeTable.baseAlias}@${stepId}`;
        const compiled = compileCleanStepSql(currentAlias, targetAlias, step, {
          checkpoint: stepNum % 5 === 0,
        });
        await client.exec(compiled.sql);

        const countRes = await client.queryRows(
          `SELECT count(*)::BIGINT AS c FROM ${ident(targetAlias)};`,
          1,
        );
        const rowCount = Number(countRes.rows[0]?.[0] ?? 0);
        const preview = await client.queryRows(
          `SELECT * FROM ${ident(targetAlias)} LIMIT 500;`,
          500,
        );

        recordExecutedStep(
          { ...step, id: stepId },
          {
            stepId,
            label: compiled.label,
            tableId: activeTable.id,
            targetAlias,
            sql: compiled.sql,
            rowCount,
            columns: preview.columns,
          },
        );
        pageCacheRef.current.set(`${targetAlias}:0`, preview);
        setQueryResult(preview, null);
        currentAlias = targetAlias;
      }

      setImportedRecipe(null);
      setDriftMap({});
      setSavedSnapshot(null);
      navigateFeature('data');
      await refreshMemoryGauge();
      setStatusNote(`Replayed ${stepsToRun.length} step(s) onto "${activeTable.baseAlias}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryResult(null, msg);
      setStatusNote(`Recipe replay failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveOpfsSnapshot(): Promise<void> {
    const ok = await saveOpfsSnapshot({
      recipe,
      tableName: activeTable?.baseAlias ?? null,
      savedAt: Date.now(),
    });
    setStatusNote(
      ok
        ? `Saved OPFS workspace snapshot (${recipe.steps.length} steps).`
        : 'OPFS snapshot unavailable; Recipe remains autosaved in IndexedDB.',
    );
  }

  async function handleRestoreOpfsSnapshot(): Promise<void> {
    const snap = await loadOpfsSnapshot();
    if (!snap) {
      setStatusNote('No OPFS workspace snapshot found.');
      return;
    }
    setDriftMap({});
    setImportedRecipe(snap.recipe);
    setStatusNote(`Loaded OPFS snapshot (${snap.recipe.steps.length} steps) for replay.`);
  }

  const ambiguousCols =
    stagedReview?.inferences.filter((inf) => inf.dateAmbiguity && inf.ambiguousDatePreviews) ?? [];

  return (
    <div className="wb-studio">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xlsm,.parquet,.json,.ndjson,.duckdb,.sqlite,.sqlite3,.db"
        className="wb-sr-only"
        onChange={handleFileInputChange}
      />
      <input
        ref={recipeImportInputRef}
        type="file"
        accept=".json,.dew.json"
        className="wb-sr-only"
        onChange={handleImportDewJson}
      />

      {/* Deep Navy Top Command Bar */}
      <header className="wb-topbar">
        <div className="wb-topbar-left">
          <a href="../" className="wb-brand-link" title="Return to Dewpond landing page">
            <DewpondLogo size={24} />
            <strong>Dewpond</strong>
          </a>
          <span className="wb-env-pill">
            <IconLock className="wb-ico-xs" />
            <code>blob:</code> worker · <code>connect-src &apos;self&apos;</code>
          </span>
        </div>

        <nav className="wb-ribbon" role="tablist" aria-label="Workbench studio modules">
          {FEATURE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeFeature === tab.id}
              className={activeFeature === tab.id ? 'wb-ribbon-tab active' : 'wb-ribbon-tab'}
              onClick={() => navigateFeature(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="wb-topbar-right">
          <span className="wb-mem-pill" title="DuckDB WASM memory usage">
            Heap: <strong>{formatBytes(memoryBytes)}</strong>
          </span>
          <span className={`wb-engine-pill wb-engine-${engineStatus}`}>
            {engineStatus === 'ready'
              ? `Ready (${engineVersion ?? '1.32.0'} · ${engineBundle ?? 'eh'})`
              : engineStatus === 'booting'
                ? 'Booting…'
                : engineStatus === 'error'
                  ? 'Error'
                  : 'Idle'}
          </span>
          <button
            type="button"
            className="wb-top-btn wb-top-btn-primary"
            disabled={engineStatus === 'booting' || isBusy}
            onClick={() => void ensureEngineReady()}
          >
            {engineStatus === 'ready' ? 'Engine Ready' : 'Boot Engine'}
          </button>
          <button type="button" className="wb-top-btn" onClick={() => void handleHardCancelReset()}>
            Hard Cancel
          </button>
        </div>
      </header>

      {/* Main 3-Pane Studio Workspace */}
      <div className="wb-workspace">
        {/* Left Explorer Rail */}
        <aside className="wb-explorer" aria-label="Loaded tables and schema explorer">
          <div className="wb-explorer-actions">
            <button
              type="button"
              className="wb-btn wb-btn-primary wb-btn-block"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUpload className="wb-ico-sm" /> Open Local File
            </button>
            <button
              type="button"
              className="wb-btn wb-btn-outline wb-btn-block"
              disabled={isBusy}
              onClick={() => void handleLoadMessyDemo()}
            >
              Load Messy Demo (1,200 rows)
            </button>
          </div>

          <div className="wb-explorer-section">
            <div className="wb-section-title">TABLES IN MEMORY ({tables.length})</div>
            {tables.length === 0 ? (
              <p className="wb-empty-note">No tables committed yet.</p>
            ) : (
              <ul className="wb-table-list">
                {tables.map((tbl) => {
                  const isActive = tbl.id === activeTable?.id;
                  return (
                    <li key={tbl.id}>
                      <button
                        type="button"
                        className={isActive ? 'wb-table-item active' : 'wb-table-item'}
                        onClick={() => void handleSelectTable(tbl)}
                      >
                        <div className="wb-table-item-top">
                          <IconTable className="wb-ico-xs" />
                          <strong>{tbl.alias}</strong>
                        </div>
                        <small>
                          {tbl.rowCount.toLocaleString('en-US')} rows · {tbl.columns.length} cols
                          {tbl.id !== '_rejects' && tbl.rejectCount > 0
                            ? ` · ${tbl.rejectCount} rejects`
                            : ''}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {activeTable ? (
            <div className="wb-explorer-section wb-schema-scroll">
              <div className="wb-section-title">SCHEMA ({activeTable.columns.length} COLS)</div>
              <ul className="wb-schema-list">
                {activeTable.columns.map((col) => (
                  <li key={col.name}>
                    <span className="wb-col-name">{col.name}</span>
                    <span className="wb-col-type">{col.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="wb-explorer-foot">
            <small>Compare (Diff) v1.1 active — FULL OUTER JOIN + IS DISTINCT FROM.</small>
          </div>
        </aside>

        {/* Center Analytical Canvas */}
        <main className="wb-center">
          {activeFeature === 'data' && tables.length === 0 ? (
            <div className="wb-welcome-wrap">
              <section
                className="wb-stage-card wb-welcome-card"
                aria-label="Upload or stage local dataset"
              >
                <div className="wb-welcome-head">
                  <span className="wb-welcome-badge">
                    <span className="wb-welcome-dot" aria-hidden="true" />
                    Local-first · Zero server upload
                  </span>
                  <h1>Load a dataset to get started</h1>
                  <p>
                    Drop messy spreadsheets or structured data. Dewpond normalizes encoding, guards
                    leading-zero IDs, and loads everything straight into your browser.
                  </p>
                </div>

                <div
                  className={dragOver ? 'wb-dropzone dragover' : 'wb-dropzone'}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <div className="wb-drop-icon-wrap" aria-hidden="true">
                    <IconUpload className="wb-drop-icon" />
                  </div>
                  <strong>Drop a file here, or choose from your computer</strong>
                  <div className="wb-format-pills" aria-label="Supported file formats">
                    <span>CSV</span>
                    <span>TSV</span>
                    <span>XLSX ≤ 50 MB</span>
                    <span>Parquet</span>
                    <span>JSON</span>
                    <span>NDJSON</span>
                    <span>.duckdb</span>
                    <span>.sqlite</span>
                  </div>
                  <div className="wb-drop-buttons">
                    <button
                      type="button"
                      className="wb-btn wb-btn-primary"
                      disabled={isBusy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose File…
                    </button>
                    <button
                      type="button"
                      className="wb-btn wb-btn-outline"
                      disabled={isBusy}
                      onClick={() => void handleLoadMessyDemo()}
                    >
                      Try Messy Fintech Demo (1,200 rows)
                    </button>
                  </div>
                </div>

                <div className="wb-welcome-pillars">
                  <div className="wb-pillar">
                    <strong>Auto-Unmess</strong>
                    <span>Strips BOM, Windows-1252 quirks, and stray banner rows.</span>
                  </div>
                  <div className="wb-pillar">
                    <strong>Type-Guarded</strong>
                    <span>Protects IDs &amp; postal codes with strict integer veto scoring.</span>
                  </div>
                  <div className="wb-pillar">
                    <strong>50 MB+ Streaming</strong>
                    <span>Large CSV &amp; Parquet files stream lazily with zero copy.</span>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeFeature !== 'data' ? (
            <section
              className={
                activeFeature === 'profile' ||
                activeFeature === 'charts' ||
                activeFeature === 'redact' ||
                activeFeature === 'export'
                  ? 'wb-stage-card wb-stage-full'
                  : 'wb-stage-card'
              }
              aria-label="Active workbench module"
            >
              {activeFeature === 'profile' ? (
                <div>
                  <div className="wb-stage-header">
                    <div>
                      <h1>Column Profile (`SUMMARIZE` + uPlot + Issue Flags)</h1>
                      <p>
                        Computes summary stats, binned canvas sparklines, and structural hygiene
                        flags with one-click Recipe fixes.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="wb-btn wb-btn-primary"
                      disabled={!activeTable || isBusy}
                      onClick={() => void handleRunProfile()}
                    >
                      <IconPlay className="wb-ico-xs" /> Run SUMMARIZE Profile
                    </button>
                  </div>

                  {activeTable ? (
                    <div className="wb-kpi-strip">
                      <div>
                        <small>Active Alias</small>
                        <strong>{activeTable.alias}</strong>
                      </div>
                      <div>
                        <small>Total Rows</small>
                        <strong>{activeTable.rowCount.toLocaleString('en-US')}</strong>
                      </div>
                      <div>
                        <small>Columns</small>
                        <strong>{activeTable.columns.length}</strong>
                      </div>
                      <div>
                        <small>Quarantined Cast Rejects</small>
                        <strong>{activeTable.rejectCount}</strong>
                      </div>
                    </div>
                  ) : null}

                  {profileState && profileState.tableAlias === activeTable?.alias ? (
                    <div className="wb-profile-stack">
                      {profileState.issues.length > 0 ? (
                        <div className="wb-issues-grid">
                          {profileState.issues.map((issue, idx) => (
                            <div
                              key={`${issue.columnName}-${issue.kind}-${idx}`}
                              className="wb-issue-card"
                            >
                              <div>
                                <span className="wb-tag wb-tag-warn">{issue.kind}</span>
                                <strong>{issue.columnName}</strong>
                                <p>{issue.message}</p>
                              </div>
                              {issue.fixLabel ? (
                                <button
                                  type="button"
                                  className="wb-btn-mini"
                                  disabled={isBusy}
                                  onClick={() => void handleApplyOneClickIssueFix(issue)}
                                >
                                  {issue.fixLabel}
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="wb-review-table-wrap">
                        <table className="wb-mini-table">
                          <thead>
                            <tr>
                              <th>column_name</th>
                              <th>sparkline</th>
                              <th>column_type</th>
                              <th>min</th>
                              <th>max</th>
                              <th>approx_unique</th>
                              <th>null_percentage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profileState.summarize.rows.map((row, idx) => {
                              const colName = row[0] ?? '';
                              const sparkVals = profileState.sparklines[colName] ?? [0, 1];
                              return (
                                <tr key={idx}>
                                  <td>
                                    <strong>{colName}</strong>
                                  </td>
                                  <td>
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                      }}
                                    >
                                      <ProfileSparkline values={sparkVals} label={colName} />
                                      <button
                                        type="button"
                                        className="wb-btn-mini"
                                        title={`Plot ${colName} in Charts`}
                                        onClick={() => {
                                          const colType = String(row[1] ?? '');
                                          const nextType: ChartType =
                                            /int|float|double|decimal|bigint/i.test(colType)
                                              ? 'histogram'
                                              : 'bar';
                                          setChartType(nextType);
                                          setChartXCol(colName);
                                          setChartAgg('COUNT');
                                          navigateFeature('charts');
                                          void handleBuildChart({ type: nextType, xCol: colName });
                                        }}
                                      >
                                        Plot
                                      </button>
                                    </div>
                                  </td>
                                  <td className="wb-mono">{row[1] ?? ''}</td>
                                  <td className="wb-mono">{row[2] ?? ''}</td>
                                  <td className="wb-mono">{row[3] ?? ''}</td>
                                  <td className="wb-mono">{row[4] ?? ''}</td>
                                  <td className="wb-mono">
                                    {row[9] ?? row[profileState.summarize.columns.length - 1] ?? ''}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="wb-empty-note">
                      {activeTable
                        ? 'Click "Run SUMMARIZE Profile" to inspect column sparklines and issue flags.'
                        : 'Load or stage a table first to profile columns.'}
                    </p>
                  )}
                </div>
              ) : null}

              {activeFeature === 'clean' ? (
                <div>
                  <div className="wb-stage-header">
                    <div>
                      <h1>Click-to-SQL Clean</h1>
                      <p>
                        Every clean step compiles to deterministic DuckDB SQL with{' '}
                        <code>&quot;__rid&quot; ASC</code> tiebreakers and non-destructive{' '}
                        <code>head</code> undo.
                      </p>
                    </div>
                  </div>

                  {!activeTable ? (
                    <p className="wb-empty-note">Load a table first to build cleaning steps.</p>
                  ) : (
                    <div className="wb-clean-builder">
                      <div className="wb-pill-row">
                        {(
                          [
                            ['dedupe', 'Exact Dedupe'],
                            ['fuzzyDedupe', 'Fuzzy Dedupe'],
                            ['trim', 'Trim Text'],
                            ['case', 'Case'],
                            ['filter', 'Filter Rows'],
                            ['derive', 'Derive'],
                            ['cast', 'Cast'],
                            ['rename', 'Rename'],
                            ['drop', 'Drop'],
                            ['reorder', 'Reorder'],
                            ['replace', 'Replace'],
                            ['regexExtract', 'Regex Extract'],
                            ['split', 'Split'],
                            ['merge', 'Merge'],
                            ['fillNulls', 'Fill Nulls'],
                            ['parseDate', 'Parse Date'],
                            ['parseNumber', 'Parse Number'],
                            ['pivot', 'Pivot'],
                            ['unpivot', 'Unpivot'],
                          ] as const
                        ).map(([op, label]) => (
                          <button
                            key={op}
                            type="button"
                            className={cleanOp === op ? 'wb-pill active' : 'wb-pill'}
                            onClick={() => setCleanOp(op)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="wb-form-row">
                        {cleanOp !== 'trim' &&
                        cleanOp !== 'derive' &&
                        cleanOp !== 'reorder' &&
                        cleanOp !== 'merge' &&
                        cleanOp !== 'pivot' &&
                        cleanOp !== 'unpivot' ? (
                          <label>
                            Target / Key Column
                            <select
                              value={cleanPrimaryCol}
                              onChange={(e) => setCleanPrimaryCol(e.target.value)}
                            >
                              {userColumns.map((c) => (
                                <option key={c.name} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        {cleanOp === 'dedupe' ? (
                          <>
                            <label>
                              Keep Row
                              <select
                                value={cleanDedupeKeep}
                                onChange={(e) =>
                                  setCleanDedupeKeep(e.target.value as 'first' | 'last')
                                }
                              >
                                <option value="last">Newest / Last</option>
                                <option value="first">Oldest / First</option>
                              </select>
                            </label>
                            <label>
                              Order By
                              <select
                                value={cleanOrderCol}
                                onChange={(e) => setCleanOrderCol(e.target.value)}
                              >
                                <option value="">__rid only</option>
                                {userColumns.map((c) => (
                                  <option key={c.name} value={c.name}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </>
                        ) : null}

                        {cleanOp === 'case' ? (
                          <label>
                            Case Mode
                            <select
                              value={cleanCaseMode}
                              onChange={(e) =>
                                setCleanCaseMode(e.target.value as 'lower' | 'upper' | 'title')
                              }
                            >
                              <option value="lower">lowercase</option>
                              <option value="upper">UPPERCASE</option>
                              <option value="title">Title Case</option>
                            </select>
                          </label>
                        ) : null}

                        {cleanOp === 'cast' ? (
                          <label>
                            Target Type
                            <select
                              value={cleanCastType}
                              onChange={(e) => setCleanCastType(e.target.value as LogicalType)}
                            >
                              {LOGICAL_TYPES.map((lt) => (
                                <option key={lt} value={lt}>
                                  {lt}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        {cleanOp === 'derive' ? (
                          <>
                            <label>
                              New Column Name
                              <input
                                type="text"
                                value={cleanDeriveCol}
                                onChange={(e) => setCleanDeriveCol(e.target.value)}
                              />
                            </label>
                            <label>
                              SQL Expression
                              <input
                                type="text"
                                value={cleanDeriveExpr}
                                onChange={(e) => setCleanDeriveExpr(e.target.value)}
                              />
                            </label>
                          </>
                        ) : null}

                        {cleanOp === 'filter' ? (
                          <>
                            <label>
                              Operator
                              <select
                                value={cleanFilterOp}
                                onChange={(e) =>
                                  setCleanFilterOp(
                                    e.target.value as 'not_null' | 'eq' | 'contains' | 'gt',
                                  )
                                }
                              >
                                <option value="not_null">IS NOT NULL</option>
                                <option value="eq">Equals</option>
                                <option value="contains">Contains (case-insensitive)</option>
                                <option value="gt">Greater than (&gt;)</option>
                              </select>
                            </label>
                            {cleanFilterOp !== 'not_null' ? (
                              <label>
                                Value
                                <input
                                  type="text"
                                  value={cleanFilterVal}
                                  placeholder="e.g. Treasury or 1000"
                                  onChange={(e) => setCleanFilterVal(e.target.value)}
                                />
                              </label>
                            ) : null}
                          </>
                        ) : null}

                        {cleanOp === 'rename' ? (
                          <label>
                            New Column Name
                            <input
                              type="text"
                              value={cleanRenameTo}
                              onChange={(e) => setCleanRenameTo(e.target.value)}
                            />
                          </label>
                        ) : null}

                        {cleanOp === 'reorder' ? (
                          <label>
                            Column Order (comma-separated)
                            <input
                              type="text"
                              placeholder={userColumns.map((c) => c.name).join(', ')}
                              value={cleanReorderCsv}
                              onChange={(e) => setCleanReorderCsv(e.target.value)}
                            />
                          </label>
                        ) : null}

                        {cleanOp === 'replace' ? (
                          <>
                            <label>
                              Find
                              <input
                                type="text"
                                value={cleanReplaceSearch}
                                onChange={(e) => setCleanReplaceSearch(e.target.value)}
                              />
                            </label>
                            <label>
                              Replace With
                              <input
                                type="text"
                                value={cleanReplaceWith}
                                onChange={(e) => setCleanReplaceWith(e.target.value)}
                              />
                            </label>
                          </>
                        ) : null}

                        {cleanOp === 'regexExtract' ? (
                          <>
                            <label>
                              Regex Pattern
                              <input
                                type="text"
                                value={cleanRegexPattern}
                                onChange={(e) => setCleanRegexPattern(e.target.value)}
                              />
                            </label>
                            <label>
                              Output Column
                              <input
                                type="text"
                                value={cleanRegexInto}
                                onChange={(e) => setCleanRegexInto(e.target.value)}
                              />
                            </label>
                          </>
                        ) : null}

                        {cleanOp === 'split' ? (
                          <>
                            <label>
                              Delimiter
                              <input
                                type="text"
                                value={cleanSplitDelim}
                                onChange={(e) => setCleanSplitDelim(e.target.value)}
                              />
                            </label>
                            <label>
                              Output Columns (comma-separated)
                              <input
                                type="text"
                                value={cleanSplitInto}
                                onChange={(e) => setCleanSplitInto(e.target.value)}
                              />
                            </label>
                          </>
                        ) : null}

                        {cleanOp === 'merge' ? (
                          <>
                            <label>
                              Columns (comma-separated)
                              <input
                                type="text"
                                placeholder={userColumns
                                  .slice(0, 2)
                                  .map((c) => c.name)
                                  .join(', ')}
                                value={cleanMergeCols}
                                onChange={(e) => setCleanMergeCols(e.target.value)}
                              />
                            </label>
                            <label>
                              Separator
                              <input
                                type="text"
                                value={cleanMergeSep}
                                onChange={(e) => setCleanMergeSep(e.target.value)}
                              />
                            </label>
                            <label>
                              Output Column
                              <input
                                type="text"
                                value={cleanMergeInto}
                                onChange={(e) => setCleanMergeInto(e.target.value)}
                              />
                            </label>
                          </>
                        ) : null}

                        {cleanOp === 'fillNulls' ? (
                          <>
                            <label>
                              Strategy
                              <select
                                value={cleanFillStrategy}
                                onChange={(e) =>
                                  setCleanFillStrategy(
                                    e.target.value as 'value' | 'mean' | 'median' | 'ffill',
                                  )
                                }
                              >
                                <option value="value">Constant Value</option>
                                <option value="mean">Column Mean</option>
                                <option value="median">Column Median</option>
                                <option value="ffill">Forward Fill (__rid ASC)</option>
                              </select>
                            </label>
                            {cleanFillStrategy === 'value' ? (
                              <label>
                                Fill Value
                                <input
                                  type="text"
                                  value={cleanFillVal}
                                  onChange={(e) => setCleanFillVal(e.target.value)}
                                />
                              </label>
                            ) : null}
                          </>
                        ) : null}

                        {cleanOp === 'parseDate' ? (
                          <label>
                            Date Order
                            <select
                              value={cleanDateFmt}
                              onChange={(e) =>
                                setCleanDateFmt(e.target.value as 'DMY' | 'MDY' | 'ISO')
                              }
                            >
                              <option value="DMY">DMY (DD/MM/YYYY)</option>
                              <option value="MDY">MDY (MM/DD/YYYY)</option>
                              <option value="ISO">ISO (YYYY-MM-DD)</option>
                            </select>
                          </label>
                        ) : null}

                        {cleanOp === 'parseNumber' ? (
                          <label>
                            Number Locale
                            <select
                              value={cleanNumLocale}
                              onChange={(e) =>
                                setCleanNumLocale(e.target.value as 'us_currency' | 'eu_decimal')
                              }
                            >
                              <option value="us_currency">US / NG Currency (1,250.50)</option>
                              <option value="eu_decimal">EU Decimal (1.250,50)</option>
                            </select>
                          </label>
                        ) : null}

                        {cleanOp === 'fuzzyDedupe' ? (
                          <>
                            <label>
                              Blocking Key
                              <select
                                value={fuzzyBlockMode}
                                onChange={(e) => setFuzzyBlockMode(e.target.value as BlockingMode)}
                              >
                                <option value="prefix_3">First 3 chars</option>
                                <option value="first_token">First token</option>
                                <option value="none">No blocking (small tables)</option>
                              </select>
                            </label>
                            <label>
                              Min Similarity
                              <input
                                type="number"
                                step={0.05}
                                min={0.5}
                                max={1}
                                value={fuzzyMinSim}
                                onChange={(e) => setFuzzyMinSim(Number(e.target.value) || 0.85)}
                              />
                            </label>
                            <label>
                              Numeric Tolerance Col
                              <select
                                value={fuzzyTolCol}
                                onChange={(e) => setFuzzyTolCol(e.target.value)}
                              >
                                <option value="">None</option>
                                {userColumns.map((c) => (
                                  <option key={c.name} value={c.name}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {fuzzyTolCol ? (
                              <label>
                                Max Delta (±)
                                <input
                                  type="number"
                                  value={fuzzyTolDelta}
                                  onChange={(e) => setFuzzyTolDelta(e.target.value)}
                                />
                              </label>
                            ) : null}
                            <button
                              type="button"
                              className="wb-btn wb-btn-outline"
                              disabled={isBusy}
                              onClick={() => void handleFindFuzzyCandidates()}
                            >
                              Find Fuzzy Candidates
                            </button>
                            <button
                              type="button"
                              className="wb-btn wb-btn-primary"
                              disabled={fuzzyApprovedDrops.length === 0 || isBusy}
                              onClick={() => void handleCommitFuzzyMerges()}
                            >
                              Commit Approved ({fuzzyApprovedDrops.length})
                            </button>
                          </>
                        ) : cleanOp === 'pivot' ? (
                          <>
                            <label>
                              Pivot Column (ON)
                              <select
                                value={pivotOnCol || userColumns[0]?.name || ''}
                                onChange={(e) => setPivotOnCol(e.target.value)}
                              >
                                {userColumns.map((c) => (
                                  <option key={c.name} value={c.name}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Value Column (USING)
                              <select
                                value={pivotValueCol || userColumns[0]?.name || ''}
                                onChange={(e) => setPivotValueCol(e.target.value)}
                              >
                                {userColumns.map((c) => (
                                  <option key={c.name} value={c.name}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Aggregate
                              <select
                                value={pivotAgg}
                                onChange={(e) => setPivotAgg(e.target.value as PivotAggFn)}
                              >
                                <option value="SUM">SUM</option>
                                <option value="COUNT">COUNT</option>
                                <option value="AVG">AVG</option>
                                <option value="MIN">MIN</option>
                                <option value="MAX">MAX</option>
                                <option value="FIRST">FIRST</option>
                              </select>
                            </label>
                            <label>
                              Cardinality Cap (Max Cols)
                              <input
                                type="number"
                                min={2}
                                max={200}
                                value={pivotMaxCols}
                                onChange={(e) => setPivotMaxCols(Number(e.target.value) || 40)}
                              />
                            </label>
                            <div className="wb-field-group">
                              <span>Row Index (GROUP BY)</span>
                              <div className="wb-pill-row">
                                {userColumns.map((c) => {
                                  const selected = pivotIndexCols.includes(c.name);
                                  return (
                                    <button
                                      key={c.name}
                                      type="button"
                                      className={selected ? 'wb-pill active' : 'wb-pill'}
                                      onClick={() =>
                                        setPivotIndexCols((prev) =>
                                          prev.includes(c.name)
                                            ? prev.filter((x) => x !== c.name)
                                            : [...prev, c.name],
                                        )
                                      }
                                    >
                                      {c.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="wb-btn wb-btn-primary"
                              disabled={isBusy}
                              onClick={() => void handleApplyPivot()}
                            >
                              Apply Pivot
                            </button>
                          </>
                        ) : cleanOp === 'unpivot' ? (
                          <>
                            <label>
                              Name Column
                              <input
                                type="text"
                                value={unpivotNameCol}
                                onChange={(e) => setUnpivotNameCol(e.target.value)}
                                placeholder="attribute"
                              />
                            </label>
                            <label>
                              Value Column
                              <input
                                type="text"
                                value={unpivotValueCol}
                                onChange={(e) => setUnpivotValueCol(e.target.value)}
                                placeholder="value"
                              />
                            </label>
                            <div className="wb-field-group">
                              <span>Columns to Unpivot (ON)</span>
                              <div className="wb-pill-row">
                                {userColumns.map((c) => {
                                  const selected = unpivotCols.includes(c.name);
                                  return (
                                    <button
                                      key={c.name}
                                      type="button"
                                      className={selected ? 'wb-pill active' : 'wb-pill'}
                                      onClick={() =>
                                        setUnpivotCols((prev) =>
                                          prev.includes(c.name)
                                            ? prev.filter((x) => x !== c.name)
                                            : [...prev, c.name],
                                        )
                                      }
                                    >
                                      {c.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="wb-btn wb-btn-primary"
                              disabled={unpivotCols.length === 0 || isBusy}
                              onClick={() => void handleApplyUnpivot()}
                            >
                              Apply Unpivot ({unpivotCols.length})
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="wb-btn wb-btn-primary"
                            disabled={isBusy}
                            onClick={() => void handleApplyCleanStep()}
                          >
                            Apply Clean Step
                          </button>
                        )}
                      </div>

                      {cleanOp === 'fuzzyDedupe' && fuzzyQueue.length > 0 ? (
                        <div className="wb-review-table-wrap">
                          <table className="wb-mini-table">
                            <thead>
                              <tr>
                                <th>Approve Drop</th>
                                <th>Keep</th>
                                <th>Drop Candidate</th>
                                <th>Similarity</th>
                                <th>Edit Dist</th>
                              </tr>
                            </thead>
                            <tbody>
                              {fuzzyQueue.map((item) => {
                                const checked = fuzzyApprovedDrops.includes(item.dropRid);
                                return (
                                  <tr key={`${item.keepRid}-${item.dropRid}`}>
                                    <td>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) =>
                                          setFuzzyApprovedDrops(
                                            e.target.checked
                                              ? [...new Set([...fuzzyApprovedDrops, item.dropRid])]
                                              : fuzzyApprovedDrops.filter(
                                                  (id) => id !== item.dropRid,
                                                ),
                                          )
                                        }
                                      />
                                    </td>
                                    <td>
                                      <code>#{item.keepRid}</code> {item.leftValue}
                                    </td>
                                    <td>
                                      <code>#{item.dropRid}</code> {item.rightValue}
                                    </td>
                                    <td className="wb-mono">{item.similarity}</td>
                                    <td className="wb-mono">{item.editDist}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      {candidateCleanPreview ? (
                        <div className="wb-live-sql">
                          <div className="wb-section-title">
                            LIVE COMPILED SQL PREVIEW{' '}
                            {candidateCleanPreview.checkpoint ? '(CHECKPOINT TABLE)' : '(VIEW)'}
                          </div>
                          <pre className="wb-sql-mini">
                            <code>{candidateCleanPreview.compiled.sql}</code>
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              {activeFeature === 'charts' ? (
                <div>
                  <div className="wb-stage-header">
                    <div>
                      <h1>Charts &amp; Visual Exploration</h1>
                      <p>
                        Aggregated directly in DuckDB-WASM (never plotting 100k+ raw rows in the
                        DOM). Click any bar or point to filter in Clean.
                      </p>
                    </div>
                  </div>

                  {!activeTable ? (
                    <p className="wb-empty-note">Load a table first to build charts.</p>
                  ) : (
                    <>
                      <div className="wb-form-row">
                        <label>
                          Chart Type
                          <select
                            value={chartType}
                            onChange={(e) => setChartType(e.target.value as ChartType)}
                          >
                            <option value="bar">Bar (Top-N)</option>
                            <option value="histogram">Histogram (Distribution)</option>
                            <option value="line">Line / Time Series</option>
                            <option value="scatter">Scatter (X vs Y)</option>
                            <option value="box">Box / Outlier Summary</option>
                          </select>
                        </label>
                        <label>
                          {chartType === 'histogram' ? 'Numeric Column' : 'X Axis / Category'}
                          <select
                            value={chartXCol || userColumns[0]?.name || ''}
                            onChange={(e) => setChartXCol(e.target.value)}
                          >
                            {userColumns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name} ({c.type})
                              </option>
                            ))}
                          </select>
                        </label>
                        {chartType !== 'histogram' ? (
                          <label>
                            Y Axis / Value
                            <select
                              value={
                                chartYCol || userColumns[1]?.name || userColumns[0]?.name || ''
                              }
                              onChange={(e) => setChartYCol(e.target.value)}
                            >
                              {userColumns.map((c) => (
                                <option key={c.name} value={c.name}>
                                  {c.name} ({c.type})
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {chartType === 'bar' || chartType === 'line' ? (
                          <label>
                            Aggregation
                            <select
                              value={chartAgg}
                              onChange={(e) => setChartAgg(e.target.value as ChartAggFn)}
                            >
                              <option value="COUNT">COUNT</option>
                              <option value="SUM">SUM</option>
                              <option value="AVG">AVG</option>
                              <option value="MIN">MIN</option>
                              <option value="MAX">MAX</option>
                            </select>
                          </label>
                        ) : null}
                        {chartType === 'line' ? (
                          <label>
                            Time Grain
                            <select
                              value={chartTimeGrain}
                              onChange={(e) => setChartTimeGrain(e.target.value as ChartTimeGrain)}
                            >
                              <option value="none">Raw / Exact</option>
                              <option value="day">Day</option>
                              <option value="week">Week</option>
                              <option value="month">Month</option>
                            </select>
                          </label>
                        ) : null}
                        {chartType === 'histogram' ? (
                          <label>
                            Bins
                            <input
                              type="number"
                              min={3}
                              max={40}
                              value={chartBins}
                              onChange={(e) => setChartBins(Number(e.target.value) || 12)}
                            />
                          </label>
                        ) : null}
                        {chartType === 'bar' ? (
                          <>
                            <label>
                              Group / Series Split
                              <select
                                value={chartSeriesCol}
                                onChange={(e) => setChartSeriesCol(e.target.value)}
                              >
                                <option value="">None</option>
                                {userColumns.map((c) => (
                                  <option key={c.name} value={c.name}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Top-N Cap
                              <input
                                type="number"
                                min={2}
                                max={60}
                                value={chartTopN}
                                onChange={(e) => setChartTopN(Number(e.target.value) || 20)}
                              />
                            </label>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="wb-btn wb-btn-primary"
                          disabled={isBusy}
                          onClick={() => void handleBuildChart()}
                        >
                          Render Chart
                        </button>
                      </div>

                      <ChartRenderer
                        chartType={chartType}
                        title={chartTitle}
                        xLabel={chartXCol || userColumns[0]?.name || 'X'}
                        yLabel={
                          chartType === 'histogram'
                            ? 'Count'
                            : chartType === 'scatter' || chartType === 'box'
                              ? chartYCol || userColumns[1]?.name || 'Y'
                              : `${chartAgg}(${chartYCol || '*'})`
                        }
                        categoryData={chartCategoryData}
                        scatterData={chartScatterData}
                        boxData={chartBoxData}
                        onSelectCategory={(pt) => {
                          const xCol = chartXCol || userColumns[0]?.name || '';
                          if (!xCol) return;
                          setCleanOp('filter');
                          setCleanPrimaryCol(xCol);
                          if (pt.binMin !== undefined) {
                            setCleanFilterOp('gt');
                            setCleanFilterVal(String(pt.binMin));
                          } else {
                            setCleanFilterOp('eq');
                            setCleanFilterVal(pt.label === '(null)' ? '' : pt.label);
                          }
                          navigateFeature('clean');
                          setStatusNote(
                            `Staged Clean filter for ${xCol} = "${pt.label}". Click Apply Clean Step to commit.`,
                          );
                        }}
                        onPinReport={(t, svgMarkup) => {
                          setPinnedReportCharts((prev) => [...prev, { title: t, svgMarkup }]);
                          setStatusNote(`Pinned "${t}" to Self-Contained HTML Report.`);
                        }}
                      />
                    </>
                  )}
                </div>
              ) : null}

              {activeFeature === 'query' ? (
                <div>
                  <div className="wb-stage-header">
                    <div>
                      <h1>SQL Query Workbench</h1>
                      <p>
                        Press <code>Ctrl+Enter</code> / <code>Cmd+Enter</code> to execute local
                        DuckDB SQL. Validated by <code>@dewpond/sqlkit</code>.
                      </p>
                    </div>
                    <div className="wb-query-actions">
                      <span className={sqlSafety.ok ? 'wb-tag wb-tag-ok' : 'wb-tag wb-tag-warn'}>
                        {sqlSafety.ok ? 'Read-Only Safe SQL' : `Guarded: ${sqlSafety.reasons[0]}`}
                      </span>
                      <div className="wb-pill-row">
                        <button
                          type="button"
                          className={queryViewMode === 'table' ? 'wb-pill active' : 'wb-pill'}
                          onClick={() => setQueryViewMode('table')}
                        >
                          Table
                        </button>
                        <button
                          type="button"
                          className={queryViewMode === 'chart' ? 'wb-pill active' : 'wb-pill'}
                          onClick={() => setQueryViewMode('chart')}
                        >
                          Chart
                        </button>
                      </div>
                      <button
                        type="button"
                        className="wb-btn wb-btn-primary"
                        disabled={isBusy}
                        onClick={() => void handleRunSql()}
                      >
                        <IconPlay className="wb-ico-xs" /> Run Query
                      </button>
                    </div>
                  </div>

                  {activeTable ? (
                    <div className="wb-pill-row">
                      <button
                        type="button"
                        className="wb-pill"
                        onClick={() =>
                          setSqlDraft(`SELECT * FROM ${ident(activeTable.alias)} LIMIT 200;`)
                        }
                      >
                        Preview 200
                      </button>
                      <button
                        type="button"
                        className="wb-pill"
                        onClick={() =>
                          setSqlDraft(
                            `SELECT\n  "department",\n  count(*) AS tx_count,\n  round(sum("amount"), 2) AS total_amount\nFROM ${ident(activeTable.alias)}\nGROUP BY "department"\nORDER BY total_amount DESC;`,
                          )
                        }
                      >
                        Department Totals
                      </button>
                      <button
                        type="button"
                        className="wb-pill"
                        onClick={() => setSqlDraft(`SUMMARIZE ${ident(activeTable.alias)};`)}
                      >
                        SUMMARIZE
                      </button>
                      <label className="wb-check-inline">
                        <input
                          type="checkbox"
                          checked={allowTrustedDdl}
                          onChange={(e) => setAllowTrustedDdl(e.target.checked)}
                        />
                        Allow local non-URI DDL (e.g. SUMMARIZE / CREATE TEMP)
                      </label>
                    </div>
                  ) : null}

                  <SqlEditor
                    value={sqlDraft}
                    schema={sqlSchema}
                    onChange={setSqlDraft}
                    onRun={() => void handleRunSql()}
                  />

                  {queryViewMode === 'chart' && queryResult ? (
                    <ChartRenderer
                      chartType="bar"
                      title="SQL Query Result Chart"
                      xLabel={queryResult.columns[0]?.name ?? 'Category'}
                      yLabel={queryResult.columns[1]?.name ?? 'Value'}
                      categoryData={queryResult.rows.slice(0, 30).map((r) => ({
                        label: String(r[0] ?? '(null)'),
                        value: Number(r[1] ?? 0) || 0,
                      }))}
                      scatterData={[]}
                      onPinReport={(t, svgMarkup) => {
                        setPinnedReportCharts((prev) => [...prev, { title: t, svgMarkup }]);
                        setStatusNote(`Pinned "${t}" to Self-Contained HTML Report.`);
                      }}
                    />
                  ) : null}

                  {activeTable ? (
                    <div className="wb-nl-card">
                      <div className="wb-nl-head">
                        <div>
                          <strong>Schema-Only NL&rarr;SQL Assistant</strong>
                          <span className="wb-export-pill wb-export-pill-safe">
                            Schema-only · 0 data rows included
                          </span>
                        </div>
                        <div className="wb-pill-row">
                          <button
                            type="button"
                            className={nlMode === 'local' ? 'wb-pill active' : 'wb-pill'}
                            onClick={() => setNlMode('local')}
                          >
                            Local Heuristic (0 network)
                          </button>
                          <button
                            type="button"
                            className={nlMode === 'byo' ? 'wb-pill active' : 'wb-pill'}
                            onClick={() => setNlMode('byo')}
                          >
                            Opt-in BYO-Key / Local LLM
                          </button>
                        </div>
                      </div>

                      <div className="wb-form-row">
                        <label style={{ flex: 1 }}>
                          Ask in Plain English
                          <input
                            type="text"
                            value={nlPrompt}
                            onChange={(e) => {
                              setNlPrompt(e.target.value);
                              setNlPayloadApproved(false);
                            }}
                            placeholder="e.g. top 10 total amount by department"
                          />
                        </label>
                        {nlMode === 'local' ? (
                          <button
                            type="button"
                            className="wb-btn wb-btn-primary"
                            disabled={!nlPrompt.trim() || isBusy}
                            onClick={() => {
                              try {
                                const generated = compileLocalNlToSql(
                                  activeTable.alias,
                                  activeTable.columns,
                                  nlPrompt,
                                );
                                setSqlDraft(generated);
                                setStatusNote(
                                  'Generated local schema-only SQL (0 network requests).',
                                );
                              } catch (err) {
                                setStatusNote(err instanceof Error ? err.message : String(err));
                              }
                            }}
                          >
                            Generate SQL (Local)
                          </button>
                        ) : null}
                      </div>

                      <details className="wb-nl-preview">
                        <summary>Exact-Payload Preview (verified zero row values)</summary>
                        <pre>
                          {JSON.stringify(
                            buildSchemaOnlyNlPayload(
                              activeTable.alias,
                              activeTable.columns,
                              nlPrompt,
                            ),
                            null,
                            2,
                          )}
                        </pre>
                        <button
                          type="button"
                          className="wb-btn-mini"
                          onClick={() => {
                            const payloadJson = JSON.stringify(
                              buildSchemaOnlyNlPayload(
                                activeTable.alias,
                                activeTable.columns,
                                nlPrompt,
                              ),
                              null,
                              2,
                            );
                            void navigator.clipboard?.writeText(payloadJson);
                            setStatusNote('Copied exact schema-only payload to clipboard.');
                          }}
                        >
                          Copy Exact Payload
                        </button>
                      </details>

                      {nlMode === 'byo' ? (
                        <div className="wb-nl-byo">
                          <div className="wb-form-row">
                            <label className="wb-check-inline">
                              <input
                                type="checkbox"
                                checked={nlPayloadApproved}
                                onChange={(e) => setNlPayloadApproved(e.target.checked)}
                              />
                              I reviewed the exact schema-only payload above (0 data rows)
                            </label>
                            <button
                              type="button"
                              className="wb-btn wb-btn-outline"
                              disabled={!nlPayloadApproved}
                              onClick={() => {
                                const payloadJson = JSON.stringify(
                                  buildSchemaOnlyNlPayload(
                                    activeTable.alias,
                                    activeTable.columns,
                                    nlPrompt,
                                  ),
                                  null,
                                  2,
                                );
                                void navigator.clipboard?.writeText(
                                  `Return a single read-only DuckDB SELECT SQL query for this schema-only JSON payload:\n\n${payloadJson}`,
                                );
                                setStatusNote(
                                  'Copied schema-only prompt to clipboard. Paste the model SQL response below.',
                                );
                              }}
                            >
                              Copy Schema-Only Prompt
                            </button>
                          </div>
                          <div className="wb-form-row">
                            <label style={{ flex: 1 }}>
                              Paste External Model SQL Response (validated by @dewpond/sqlkit)
                              <input
                                type="text"
                                value={nlExternalResponse}
                                onChange={(e) => setNlExternalResponse(e.target.value)}
                                placeholder='e.g. ```sql SELECT "department", sum("amount") FROM "..." GROUP BY 1 ```'
                              />
                            </label>
                            <button
                              type="button"
                              className="wb-btn wb-btn-primary"
                              disabled={!nlExternalResponse.trim() || isBusy}
                              onClick={() => {
                                try {
                                  const safeSql = extractSqlFromLlmResponse(nlExternalResponse);
                                  setSqlDraft(safeSql);
                                  setStatusNote(
                                    'Validated external SQL with @dewpond/sqlkit and loaded into editor.',
                                  );
                                } catch (err) {
                                  setStatusNote(err instanceof Error ? err.message : String(err));
                                }
                              }}
                            >
                              Validate &amp; Load SQL
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeFeature === 'redact' ? (
                <div>
                  <div className="wb-stage-header">
                    <div>
                      <h1>Redact PII (v1 Headline Workflow)</h1>
                      <p>
                        Scans samples locally with <code>@dewpond/pii</code>, applies deterministic
                        salted <code>sha256</code> / masking / generalization / hash-shuffle, and
                        checks residual k-anonymity cohorts.
                      </p>
                    </div>
                    <div className="wb-review-actions">
                      <button
                        type="button"
                        className="wb-btn wb-btn-outline"
                        disabled={!activeTable || isBusy}
                        onClick={() => void handleScanPii()}
                      >
                        <IconShieldCheck className="wb-ico-sm" /> Scan PII Columns
                      </button>
                      <button
                        type="button"
                        className="wb-btn wb-btn-primary"
                        disabled={!activeTable || isBusy}
                        onClick={() => void handleApplyRedaction()}
                      >
                        Apply Redaction
                      </button>
                    </div>
                  </div>

                  {!activeTable ? (
                    <p className="wb-empty-note">Load a table first to scan and redact PII.</p>
                  ) : (
                    <div className="wb-redact-grid">
                      <div className="wb-redact-left">
                        <div className="wb-form-row">
                          <label>
                            Session Salt (`sha256`)
                            <input
                              type="text"
                              value={redactSalt}
                              onChange={(e) => setRedactSalt(e.target.value)}
                            />
                          </label>
                          <label>
                            Shuffle Seed
                            <input
                              type="text"
                              value={shuffleSeed}
                              onChange={(e) => setShuffleSeed(e.target.value)}
                            />
                          </label>
                        </div>

                        <div className="wb-review-table-wrap">
                          <table className="wb-mini-table">
                            <thead>
                              <tr>
                                <th>Column</th>
                                <th>Detected PII</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {userColumns.map((col) => {
                                const colFindings = piiFindings.filter(
                                  (f) => f.columnName === col.name,
                                );
                                const mode = redactPlans[col.name] ?? 'keep';
                                return (
                                  <tr key={col.name}>
                                    <td>
                                      <strong>{col.name}</strong>
                                    </td>
                                    <td>
                                      {colFindings.length === 0 ? (
                                        <span className="wb-muted">none scanned</span>
                                      ) : (
                                        colFindings.map((f) => (
                                          <span key={f.detector} className="wb-tag wb-tag-warn">
                                            {f.detector} ({Math.round(f.matchRate * 100)}% ·{' '}
                                            {f.confidence})
                                          </span>
                                        ))
                                      )}
                                    </td>
                                    <td>
                                      <select
                                        aria-label={`Redaction mode for ${col.name}`}
                                        value={mode}
                                        onChange={(e) =>
                                          setRedactPlans({
                                            ...redactPlans,
                                            [col.name]: e.target.value as RedactColumnPlan['mode'],
                                          })
                                        }
                                      >
                                        <option value="keep">Keep as-is</option>
                                        <option value="mask">Mask (keep ends)</option>
                                        <option value="hash_sha256">Salted sha256 Hash</option>
                                        <option value="generalize">
                                          Generalize (Month / 1k Band)
                                        </option>
                                        <option value="shuffle">Deterministic Hash-Shuffle</option>
                                        <option value="drop">Drop Column</option>
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <aside className="wb-kanon-card">
                        <strong>k-Anonymity Residual Risk Check</strong>
                        <p>
                          Checks <code>GROUP BY</code> cohort sizes over selected quasi-identifiers.
                        </p>
                        <div className="wb-qi-list">
                          {userColumns.map((col) => {
                            const checked = qiColumns.includes(col.name);
                            return (
                              <label key={col.name} className="wb-check-inline">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setQiColumns(
                                      e.target.checked
                                        ? [...qiColumns, col.name]
                                        : qiColumns.filter((x) => x !== col.name),
                                    )
                                  }
                                />
                                {col.name}
                              </label>
                            );
                          })}
                        </div>

                        <div className="wb-form-row">
                          <label>
                            Min Cohort (k)
                            <input
                              type="number"
                              min={2}
                              max={100}
                              value={kThreshold}
                              onChange={(e) => setKThreshold(Number(e.target.value) || 5)}
                            />
                          </label>
                          <button
                            type="button"
                            className="wb-btn wb-btn-outline"
                            disabled={qiColumns.length === 0 || isBusy}
                            onClick={() => void handleCheckKAnonymity()}
                          >
                            Check Risk
                          </button>
                        </div>

                        {kAnonResult ? (
                          <div className="wb-kanon-status">
                            <span
                              className={
                                kAnonResult.rows.length === 0
                                  ? 'wb-tag wb-tag-ok'
                                  : 'wb-tag wb-tag-warn'
                              }
                            >
                              {kAnonResult.rows.length === 0
                                ? `Pass: zero cohorts < ${kThreshold}`
                                : `${kAnonResult.rows.length} small cohort(s) < ${kThreshold}`}
                            </span>
                          </div>
                        ) : null}

                        <div className="wb-drop-buttons">
                          <button
                            type="button"
                            className="wb-btn wb-btn-outline"
                            onClick={() => handleDownloadRedactReport('json')}
                          >
                            <IconDownload className="wb-ico-xs" /> Report (.json)
                          </button>
                          <button
                            type="button"
                            className="wb-btn wb-btn-outline"
                            onClick={() => handleDownloadRedactReport('md')}
                          >
                            <IconDownload className="wb-ico-xs" /> Report (.md)
                          </button>
                        </div>
                      </aside>
                    </div>
                  )}
                </div>
              ) : null}

              {activeFeature === 'compare' ? (
                <div>
                  <div className="wb-stage-header">
                    <div>
                      <h1>Compare (Diff) — v1.1 Headline Workflow</h1>
                      <p>
                        Key uniqueness check + deterministic <code>FULL OUTER JOIN</code> &amp;{' '}
                        <code>IS DISTINCT FROM</code> diffing with schema diff and CSV/XLSX export.
                      </p>
                    </div>
                    <div className="wb-review-actions">
                      <button
                        type="button"
                        className={compareMode === 'exact' ? 'wb-pill active' : 'wb-pill'}
                        onClick={() => setCompareMode('exact')}
                      >
                        Exact Key Diff
                      </button>
                      <button
                        type="button"
                        className={compareMode === 'fuzzy' ? 'wb-pill active' : 'wb-pill'}
                        onClick={() => setCompareMode('fuzzy')}
                      >
                        Fuzzy Reconcile
                      </button>
                      <button
                        type="button"
                        className="wb-btn wb-btn-outline"
                        disabled={!compareLastResult || isBusy}
                        onClick={() => handleExportDiff('csv')}
                      >
                        <IconDownload className="wb-ico-xs" /> Export Diff CSV
                      </button>
                      <button
                        type="button"
                        className="wb-btn wb-btn-outline"
                        disabled={!compareLastResult || isBusy}
                        onClick={() => handleExportDiff('xlsx')}
                      >
                        <IconDownload className="wb-ico-xs" /> Export Diff XLSX
                      </button>
                      <button
                        type="button"
                        className="wb-btn wb-btn-primary"
                        disabled={compareCandidates.length === 0 || isBusy}
                        onClick={() =>
                          void (compareMode === 'fuzzy'
                            ? handleRunFuzzyReconcile()
                            : handleRunCompare())
                        }
                      >
                        {compareMode === 'fuzzy' ? 'Run Fuzzy Reconcile' : 'Run Compare (Diff)'}
                      </button>
                    </div>
                  </div>

                  {compareCandidates.length === 0 ? (
                    <p className="wb-empty-note">
                      Load at least one dataset (or create a cleaned/redacted step) to compare
                      tables.
                    </p>
                  ) : (
                    <div className="wb-clean-builder">
                      <div className="wb-form-row">
                        <label>
                          Baseline (Left)
                          <select
                            aria-label="Compare baseline table"
                            value={resolvedLeftAlias}
                            onChange={(e) => setCompareLeftAlias(e.target.value)}
                          >
                            {compareCandidates.map((c) => (
                              <option key={c.alias} value={c.alias}>
                                {c.alias}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Target (Right)
                          <select
                            aria-label="Compare target table"
                            value={resolvedRightAlias}
                            onChange={(e) => setCompareRightAlias(e.target.value)}
                          >
                            {compareCandidates.map((c) => (
                              <option key={c.alias} value={c.alias}>
                                {c.alias}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="wb-qi-list">
                        <span className="wb-muted">Join Keys:</span>
                        {compareSchemaDiff.shared.map((colName) => {
                          const checked =
                            compareKeys.length > 0
                              ? compareKeys.includes(colName)
                              : colName === compareSchemaDiff.shared[0];
                          return (
                            <label key={colName} className="wb-check-inline">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const base =
                                    compareKeys.length > 0
                                      ? compareKeys
                                      : compareSchemaDiff.shared[0]
                                        ? [compareSchemaDiff.shared[0]]
                                        : [];
                                  setCompareKeys(
                                    e.target.checked
                                      ? [...new Set([...base, colName])]
                                      : base.filter((k) => k !== colName),
                                  );
                                }}
                              />
                              {colName}
                            </label>
                          );
                        })}
                      </div>

                      <div className="wb-pill-row">
                        <span className="wb-tag">
                          Shared cols: {compareSchemaDiff.shared.length}
                        </span>
                        {compareSchemaDiff.addedInRight.length > 0 ? (
                          <span className="wb-tag wb-tag-ok">
                            + Added cols: {compareSchemaDiff.addedInRight.join(', ')}
                          </span>
                        ) : null}
                        {compareSchemaDiff.removedFromLeft.length > 0 ? (
                          <span className="wb-tag wb-tag-warn">
                            - Removed cols: {compareSchemaDiff.removedFromLeft.join(', ')}
                          </span>
                        ) : null}
                        {compareSchemaDiff.typeChanges.length > 0 ? (
                          <span className="wb-tag wb-tag-warn">
                            Type drift:{' '}
                            {compareSchemaDiff.typeChanges
                              .map((t) => `${t.column} (${t.leftType}→${t.rightType})`)
                              .join(', ')}
                          </span>
                        ) : null}
                      </div>

                      {compareSummary ? (
                        <div className="wb-pill-row">
                          {(
                            [
                              ['all', 'All'],
                              ['changed', `Changed (${compareSummary.changed})`],
                              ['added', `Added (${compareSummary.added})`],
                              ['removed', `Removed (${compareSummary.removed})`],
                              ['unchanged', `Unchanged (${compareSummary.unchanged})`],
                            ] as const
                          ).map(([status, label]) => (
                            <button
                              key={status}
                              type="button"
                              className={
                                compareStatusFilter === status ? 'wb-pill active' : 'wb-pill'
                              }
                              onClick={() => void handleRunCompare(status)}
                            >
                              {label}
                            </button>
                          ))}
                          <span
                            className={
                              compareSummary.leftDuplicates === 0 &&
                              compareSummary.rightDuplicates === 0
                                ? 'wb-tag wb-tag-ok'
                                : 'wb-tag wb-tag-warn'
                            }
                          >
                            Key uniqueness: L {compareSummary.leftDuplicates} dup / R{' '}
                            {compareSummary.rightDuplicates} dup
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              {activeFeature === 'export' ? (
                <div className="wb-export-studio">
                  <div className="wb-stage-header">
                    <div>
                      <h1>Local Export &amp; Share-Safe Recipes</h1>
                      <p>
                        All downloads are generated locally in browser memory via Blob URLs—zero
                        server endpoints involved.
                      </p>
                    </div>
                  </div>

                  <div className="wb-export-summary">
                    <div className="wb-export-stat">
                      <span>Active Target</span>
                      <strong>{activeTable ? activeTable.alias : 'None loaded'}</strong>
                      <small>
                        {activeTable
                          ? `${activeTable.rowCount.toLocaleString('en-US')} rows · ${userColumns.length} cols`
                          : 'Load a dataset first'}
                      </small>
                    </div>
                    <div className="wb-export-stat">
                      <span>Recipe Pipeline</span>
                      <strong>
                        {recipe.head} active step{recipe.head === 1 ? '' : 's'}
                      </strong>
                      <small>{stepSnapshots.length} total recorded</small>
                    </div>
                    <div className="wb-export-stat">
                      <span>Share-Safety Audit</span>
                      <strong>
                        <span
                          className={
                            shareFindings.length === 0
                              ? 'wb-export-pill wb-export-pill-safe'
                              : 'wb-export-pill wb-export-pill-warn'
                          }
                        >
                          {shareFindings.length === 0
                            ? 'Share-safe (0 warnings)'
                            : `${shareFindings.length} warning(s)`}
                        </span>
                      </strong>
                      <small>No raw literals or salts leaked</small>
                    </div>
                    <div className="wb-export-stat">
                      <span>Tokenized Columns</span>
                      <strong>
                        {Object.values(redactPlans).filter((mode) => mode === 'hash_sha256').length}{' '}
                        SHA-256 col(s)
                      </strong>
                      <small>Reversible via local key map</small>
                    </div>
                  </div>

                  <div className="wb-export-grid">
                    <div className="wb-export-card">
                      <div className="wb-export-card-body">
                        <div className="wb-export-card-head">
                          <strong>Cleaned Data Files</strong>
                          <span className="wb-export-tag">Tabular &amp; DB</span>
                        </div>
                        <p>
                          Export the active table in standard analytics formats. Parquet uses{' '}
                          <code>hyparquet-writer</code>; XLSX preserves text IDs up to 50 MB.
                        </p>
                        <label className="wb-check-inline">
                          <input
                            type="checkbox"
                            checked={neutralizeFormulas}
                            onChange={(e) => setNeutralizeFormulas(e.target.checked)}
                          />
                          Neutralize spreadsheet formulas (<code>=</code>, <code>+</code>,{' '}
                          <code>-</code>, <code>@</code>) in CSV &amp; XLSX
                        </label>
                      </div>
                      <div className="wb-export-actions">
                        <button
                          type="button"
                          className="wb-btn wb-btn-primary"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportData('csv')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export CSV
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportData('json')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export JSON
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportData('ndjson')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export NDJSON
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportData('parquet')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export Parquet
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportData('xlsx')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export XLSX (&le; 50 MB)
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportData('duckdb')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export .duckdb
                        </button>
                      </div>
                    </div>

                    <div className="wb-export-card">
                      <div className="wb-export-card-body">
                        <div className="wb-export-card-head">
                          <strong>Self-Contained HTML Report</strong>
                          <span className="wb-export-tag">Offline Audit</span>
                        </div>
                        <p>
                          Generates a single zero-dependency <code>.html</code> audit report with
                          schema types, redaction modes, profile issues, recipe SQL, and a 50-row
                          preview.
                        </p>
                      </div>
                      <div className="wb-export-actions">
                        <button
                          type="button"
                          className="wb-btn wb-btn-primary"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportHtmlReport()}
                        >
                          <IconDownload className="wb-ico-xs" /> Export .html Report
                        </button>
                      </div>
                    </div>

                    <div className="wb-export-card">
                      <div className="wb-export-card-body">
                        <div className="wb-export-card-head">
                          <strong>Reproducible Pipeline</strong>
                          <span className="wb-export-tag">Share-Safe</span>
                        </div>
                        <p>
                          Download the portable <code>.dew.json</code> recipe or full deterministic
                          DuckDB <code>.sql</code> script for headless replay.
                        </p>
                      </div>
                      <div className="wb-export-actions">
                        <button
                          type="button"
                          className="wb-btn wb-btn-primary"
                          onClick={() =>
                            triggerBlobDownload(
                              `${recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.dew.json`,
                              JSON.stringify(recipe, null, 2),
                              'application/json',
                            )
                          }
                        >
                          <IconDownload className="wb-ico-xs" /> Export .dew.json
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          onClick={() =>
                            triggerBlobDownload(
                              'dewpond_pipeline.sql',
                              compileFullRecipeSql(stepSnapshots.slice(0, recipe.head)),
                              'text/plain;charset=utf-8',
                            )
                          }
                        >
                          <IconDownload className="wb-ico-xs" /> Export .sql Script
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          onClick={() =>
                            triggerBlobDownload(
                              'dewpond_pandas.py',
                              buildPythonPipelineExport(
                                'pandas',
                                recipe.name,
                                activeTable?.alias ?? 'dataset',
                                stepSnapshots.slice(0, recipe.head).map((s) => ({
                                  stepId: s.stepId,
                                  label: s.label,
                                  sql: s.sql,
                                })),
                              ),
                              'text/x-python;charset=utf-8',
                            )
                          }
                        >
                          <IconDownload className="wb-ico-xs" /> Export pandas (.py)
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          onClick={() =>
                            triggerBlobDownload(
                              'dewpond_polars.py',
                              buildPythonPipelineExport(
                                'polars',
                                recipe.name,
                                activeTable?.alias ?? 'dataset',
                                stepSnapshots.slice(0, recipe.head).map((s) => ({
                                  stepId: s.stepId,
                                  label: s.label,
                                  sql: s.sql,
                                })),
                              ),
                              'text/x-python;charset=utf-8',
                            )
                          }
                        >
                          <IconDownload className="wb-ico-xs" /> Export Polars (.py)
                        </button>
                      </div>
                    </div>

                    <div className="wb-export-card">
                      <div className="wb-export-card-body">
                        <div className="wb-export-card-head">
                          <strong>Reversible Tokenization Key Map</strong>
                          <span className="wb-export-tag wb-export-tag-warn">Local Only</span>
                        </div>
                        <p>
                          Exports the <code>original_value ↔ sha256 token</code> lookup table for
                          columns set to <code>hash_sha256</code> in Redact. Never included in{' '}
                          <code>#r=</code> share links.
                        </p>
                      </div>
                      <div className="wb-export-actions">
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportTokenKeyMap('json')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export Key Map (.json)
                        </button>
                        <button
                          type="button"
                          className="wb-btn wb-btn-outline"
                          disabled={!activeTable || isBusy}
                          onClick={() => void handleExportTokenKeyMap('csv')}
                        >
                          <IconDownload className="wb-ico-xs" /> Export Key Map (.csv)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {(activeFeature === 'data' && tables.length > 0) ||
          activeFeature === 'clean' ||
          (activeFeature === 'query' && queryViewMode === 'table') ||
          activeFeature === 'compare' ? (
            <DataGrid
              title={activeTable ? `Grid · ${activeTable.alias}` : 'Data Grid'}
              result={queryResult}
              error={queryError ?? engineError}
              pageNav={gridPageNav}
              editable={
                activeFeature === 'data' && Boolean(activeTable && activeTable.id !== '_rejects')
              }
              onEditCell={handleEditCell}
              onInsertRowAfter={handleInsertRowAfter}
              onDeleteRow={handleDeleteRow}
            />
          ) : null}
        </main>

        {/* Right Recipe & Audit Drawer */}
        <aside className="wb-drawer" aria-label="Recipe timeline and SQL audit drawer">
          <div className="wb-drawer-head">
            <div>
              <div className="wb-section-title">RECIPE TIMELINE</div>
              <strong>
                Head: {recipe.head} / {recipe.steps.length}
              </strong>
            </div>
            <div className="wb-undo-redo">
              <button
                type="button"
                className="wb-btn-mini"
                title="Undo step (move head backward)"
                disabled={recipe.head <= 0 || isBusy}
                onClick={() => void handleMoveHead(recipe.head - 1)}
              >
                <IconUndo className="wb-ico-xs" />
              </button>
              <button
                type="button"
                className="wb-btn-mini"
                title="Redo step (move head forward)"
                disabled={recipe.head >= recipe.steps.length || isBusy}
                onClick={() => void handleMoveHead(recipe.head + 1)}
              >
                <IconRedo className="wb-ico-xs" />
              </button>
            </div>
          </div>

          <div className="wb-timeline-list">
            <button
              type="button"
              className={recipe.head === 0 ? 'wb-tl-item active' : 'wb-tl-item'}
              onClick={() => void handleMoveHead(0)}
            >
              <span>0 · Source</span>
              <small>{activeTable ? activeTable.baseAlias : 'Base loaded table'}</small>
            </button>

            {stepSnapshots.map((snap, idx) => {
              const stepNum = idx + 1;
              const isHead = recipe.head === stepNum;
              const isUndone = stepNum > recipe.head;
              return (
                <button
                  key={snap.stepId}
                  type="button"
                  className={
                    isHead ? 'wb-tl-item active' : isUndone ? 'wb-tl-item undone' : 'wb-tl-item'
                  }
                  onClick={() => void handleMoveHead(stepNum)}
                >
                  <span>
                    {stepNum} · {snap.label}
                  </span>
                  <small>
                    {snap.targetAlias} · {snap.rowCount.toLocaleString('en-US')} rows
                  </small>
                </button>
              );
            })}
          </div>

          <div className="wb-drawer-audit">
            <div className="wb-section-title">SHARE-SAFETY AUDIT</div>
            <p className={shareFindings.length === 0 ? 'wb-audit-ok' : 'wb-audit-warn'}>
              {shareFindings.length === 0
                ? 'Zero embedded filter literals or raw SQL detected.'
                : `${shareFindings.length} step(s) contain reviewable literals/salts before link sharing.`}
            </p>
          </div>

          <div className="wb-drawer-sql">
            <div className="wb-section-title">ACTIVE STEP SQL</div>
            <pre className="wb-sql-mini">
              <code>
                {recipe.head > 0 && stepSnapshots[recipe.head - 1]
                  ? stepSnapshots[recipe.head - 1]!.sql
                  : '-- Active table reflects initial typed ingest.'}
              </code>
            </pre>
          </div>

          <div className="wb-drawer-persistence">
            <div className="wb-section-title">RECIPE SHARE &amp; LOCAL STORAGE</div>
            {!opfsCap.available ? (
              <p className="wb-audit-warn">{opfsCap.reason}</p>
            ) : (
              <p className="wb-audit-ok">
                OPFS snapshot storage ready · IndexedDB autosave active.
              </p>
            )}
            <div className="wb-drawer-actions">
              <button
                type="button"
                className="wb-btn-mini"
                disabled={isBusy}
                onClick={() => recipeImportInputRef.current?.click()}
              >
                Import .dew.json
              </button>
              <button
                type="button"
                className="wb-btn-mini"
                disabled={recipe.steps.length === 0 || isBusy}
                onClick={() => void handleCopyShareLink()}
              >
                {shareLinkCopied ? 'Copied #r= Link' : 'Copy #r= Link'}
              </button>
              <button
                type="button"
                className="wb-btn-mini"
                disabled={!opfsCap.available || recipe.steps.length === 0 || isBusy}
                onClick={() => void handleSaveOpfsSnapshot()}
              >
                Save OPFS Snapshot
              </button>
              <button
                type="button"
                className="wb-btn-mini"
                disabled={!opfsCap.available || isBusy}
                onClick={() => void handleRestoreOpfsSnapshot()}
              >
                Restore OPFS Snapshot
              </button>
              {savedSnapshot && recipe.steps.length === 0 ? (
                <button
                  type="button"
                  className="wb-btn-mini wb-btn-primary"
                  disabled={isBusy}
                  onClick={() => {
                    setDriftMap({});
                    setImportedRecipe(savedSnapshot.recipe);
                  }}
                >
                  Restore Autosaved Recipe ({savedSnapshot.recipe.steps.length} steps)
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      {/* On-demand Unmess & Type-Veto Modal */}
      {ingestModalOpen || stagedReview ? (
        <div
          className="wb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Unmess & Type-Guarded Ingest"
        >
          <div className="wb-modal-dialog">
            <div className="wb-modal-head">
              <div>
                <h2>Load Local Dataset</h2>
                <p>
                  Normalizes encoding &amp; messy headers in a local worker, then applies strict ID
                  &amp; type-veto scoring before loading.
                </p>
              </div>
              <button
                type="button"
                className="wb-btn wb-btn-outline"
                disabled={isBusy}
                onClick={() => {
                  setStagedReview(null);
                  setIngestModalOpen(false);
                }}
              >
                Close
              </button>
            </div>

            {!stagedReview ? (
              <div
                className={dragOver ? 'wb-dropzone dragover' : 'wb-dropzone'}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <div className="wb-drop-icon-wrap" aria-hidden="true">
                  <IconUpload className="wb-drop-icon" />
                </div>
                <strong>Drop a file here, or choose from your computer</strong>
                <div className="wb-format-pills" aria-label="Supported file formats">
                  <span>CSV</span>
                  <span>TSV</span>
                  <span>XLSX ≤ 50 MB</span>
                  <span>Parquet</span>
                  <span>JSON</span>
                  <span>NDJSON</span>
                  <span>.duckdb</span>
                  <span>.sqlite</span>
                </div>
                <div className="wb-drop-buttons">
                  <button
                    type="button"
                    className="wb-btn wb-btn-primary"
                    disabled={isBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose File…
                  </button>
                  <button
                    type="button"
                    className="wb-btn wb-btn-outline"
                    disabled={isBusy}
                    onClick={() => void handleLoadMessyDemo()}
                  >
                    Try Messy Fintech Demo (1,200 rows)
                  </button>
                </div>
              </div>
            ) : (
              <div className="wb-review-box">
                <div className="wb-review-top">
                  <div>
                    <strong>
                      Type Veto Review: <code>{stagedReview.displayName}</code>
                    </strong>
                    <span className="wb-review-meta">
                      Target: <code>{stagedReview.targetTableName}</code> ·{' '}
                      {formatBytes(stagedReview.bytes)}
                      {stagedReview.kind === 'xlsx'
                        ? ` · ${stagedReview.date1904 ? '1904' : '1900'} UTC · ${stagedReview.rowCount} rows`
                        : stagedReview.normInfo
                          ? ` · ${stagedReview.normInfo.encoding} · delim "${stagedReview.normInfo.delimiter === '\t' ? '\\t' : stagedReview.normInfo.delimiter}"`
                          : ' · Streaming direct read_csv'}
                    </span>
                  </div>
                  <div className="wb-review-actions">
                    <button
                      type="button"
                      className="wb-btn wb-btn-outline"
                      onClick={() => {
                        setStagedReview(null);
                        setIngestModalOpen(false);
                      }}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      className="wb-btn wb-btn-primary"
                      disabled={isBusy}
                      onClick={() => void commitStagedReview()}
                    >
                      Commit Typed Load into DuckDB
                    </button>
                  </div>
                </div>

                {/* Normalization / XLSX Chips & Controls */}
                {stagedReview.kind === 'csv' && stagedReview.normInfo ? (
                  <div className="wb-pill-row">
                    <span className="wb-tag">{stagedReview.normInfo.encoding}</span>
                    {stagedReview.normInfo.hadMixedLineEndings ? (
                      <span className="wb-tag wb-tag-ok">CRLF/CR normalized</span>
                    ) : null}
                    {stagedReview.normInfo.skippedBannerRows.length > 0 ? (
                      <span className="wb-tag wb-tag-warn">
                        Skipped {stagedReview.normInfo.skippedBannerRows.length} banner row(s)
                      </span>
                    ) : null}
                    {stagedReview.normInfo.paddedShortRows > 0 ||
                    stagedReview.normInfo.raggedRowAlerts.length > 0 ? (
                      <span className="wb-tag wb-tag-warn">
                        Aligned {stagedReview.normInfo.paddedShortRows} short /{' '}
                        {stagedReview.normInfo.raggedRowAlerts.length} overflow ragged row(s)
                      </span>
                    ) : null}
                    {stagedReview.normInfo.excludedFooterRows.length > 0 ||
                    !stagedReview.excludeFooter ? (
                      <button
                        type="button"
                        className="wb-pill"
                        onClick={() =>
                          void stageCsvTextOrFile({
                            displayName: stagedReview.displayName,
                            virtualName: stagedReview.virtualName,
                            bytes: stagedReview.bytes,
                            rawBytes: stagedReview.rawBytes,
                            excludeFooter: !stagedReview.excludeFooter,
                          })
                        }
                      >
                        {stagedReview.excludeFooter
                          ? `Excluded ${stagedReview.normInfo.excludedFooterRows.length} totals footer(s) (Restore)`
                          : 'Restoring totals footer(s) (Exclude)'}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {stagedReview.kind === 'xlsx' ? (
                  <div className="wb-pill-row">
                    <label className="wb-inline-label">
                      Worksheet:
                      <select
                        aria-label="XLSX worksheet selector"
                        value={stagedReview.selectedSheet}
                        onChange={(e) => void switchStagedXlsxSheet(e.target.value)}
                      >
                        {stagedReview.sheets.map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.name}
                            {s.state !== 'visible' ? ` (${s.state})` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {stagedReview.mergedCells.length > 0 ? (
                      <span className="wb-tag">
                        {stagedReview.mergedCells.length} merged range(s)
                      </span>
                    ) : null}
                    {stagedReview.hiddenRowCount > 0 ? (
                      <span className="wb-tag wb-tag-warn">
                        {stagedReview.hiddenRowCount} hidden row(s)
                      </span>
                    ) : null}
                    {stagedReview.warnings.map((w) => (
                      <span key={w} className="wb-tag wb-tag-warn">
                        {w}
                      </span>
                    ))}
                  </div>
                ) : null}

                {stagedReview.hasDateAmbiguity ? (
                  <div className="wb-date-resolver">
                    <div className="wb-amber-banner">
                      <IconAlertTriangle className="wb-ico-sm" />
                      <div>
                        <strong>Ambiguous slash dates detected</strong> — choose how dates parse:
                      </div>
                      <select
                        aria-label="Date interpretation order"
                        value={stagedReview.dateOrder}
                        onChange={(e) =>
                          setStagedReview({
                            ...stagedReview,
                            dateOrder: e.target.value as 'DMY' | 'MDY' | 'ISO',
                          })
                        }
                      >
                        <option value="DMY">Day-First (DD/MM/YYYY)</option>
                        <option value="MDY">Month-First (MM/DD/YYYY)</option>
                        <option value="ISO">Keep VARCHAR / ISO</option>
                      </select>
                    </div>

                    {ambiguousCols[0]?.ambiguousDatePreviews ? (
                      <div className="wb-dual-preview">
                        {ambiguousCols[0].ambiguousDatePreviews.slice(0, 3).map((p) => (
                          <span key={p.raw} className="wb-tag">
                            <code>{p.raw}</code> → DMY: <strong>{p.asDmy}</strong> | MDY:{' '}
                            <strong>{p.asMdy}</strong>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="wb-review-table-wrap">
                  <table className="wb-mini-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Strict Type</th>
                        <th>Confidence</th>
                        <th>Override Type</th>
                        <th>Veto / Locale Guards</th>
                        <th>Sample Values (up to 5)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stagedReview.inferences.map((inf) => {
                        const selected = stagedReview.overrides[inf.columnName] ?? inf.type;
                        return (
                          <tr key={inf.columnName}>
                            <td>
                              <strong>{inf.columnName}</strong>
                            </td>
                            <td>
                              <span className="wb-tag">{inf.type}</span>
                            </td>
                            <td className="wb-mono">{Math.round(inf.confidence * 100)}%</td>
                            <td>
                              <select
                                aria-label={`Type override for ${inf.columnName}`}
                                value={selected}
                                onChange={(e) =>
                                  setStagedReview({
                                    ...stagedReview,
                                    overrides: {
                                      ...stagedReview.overrides,
                                      [inf.columnName]: e.target.value as LogicalType,
                                    },
                                  })
                                }
                              >
                                {LOGICAL_TYPES.map((lt) => (
                                  <option key={lt} value={lt}>
                                    {lt}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              {inf.localeNumberFormat ? (
                                <span className="wb-tag wb-tag-ok">{inf.localeNumberFormat}</span>
                              ) : null}
                              {inf.vetoReasons.length === 0 && !inf.localeNumberFormat ? (
                                <span className="wb-muted">none</span>
                              ) : (
                                inf.vetoReasons.map((r) => (
                                  <span key={r} className="wb-tag wb-tag-warn">
                                    {r}
                                  </span>
                                ))
                              )}
                            </td>
                            <td className="wb-mono">{inf.sampleValues.join(' | ')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Imported Recipe & Schema-Drift Mapper Modal */}
      {importedRecipe ? (
        <div
          className="wb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Import & Replay Recipe"
        >
          <div className="wb-modal-dialog">
            <div className="wb-modal-head">
              <div>
                <h2>Import &amp; Replay Recipe: {importedRecipe.name}</h2>
                <p>
                  {importedRecipe.steps.length} step(s) · Head {importedRecipe.head} · Validated
                  against v1 JSON Schema.
                </p>
              </div>
              <button
                type="button"
                className="wb-btn wb-btn-outline"
                disabled={isBusy}
                onClick={() => {
                  setImportedRecipe(null);
                  setDriftMap({});
                }}
              >
                Close
              </button>
            </div>

            {(() => {
              const importFindings = findShareUnsafeLiterals(importedRecipe);
              const missingCols = activeTable
                ? detectSchemaDrift(
                    importedRecipe,
                    userColumns.map((c) => c.name),
                  )
                : [];

              return (
                <div className="wb-review-box">
                  {importFindings.length > 0 ? (
                    <div className="wb-amber-banner">
                      <IconAlertTriangle className="wb-ico-sm" />
                      <div>
                        <strong>Review required:</strong> {importFindings.length} step(s) contain
                        user literals or raw SQL ({importFindings.map((f) => f.op).join(', ')}).
                      </div>
                    </div>
                  ) : null}

                  {!activeTable ? (
                    <p className="wb-empty-note">
                      Load a dataset first (e.g. Open Local File or Load Messy Demo), then replay
                      this Recipe onto it.
                    </p>
                  ) : missingCols.length > 0 ? (
                    <div className="wb-drift-box">
                      <strong>Schema-Drift Column Mapper</strong>
                      <p>
                        Map {missingCols.length} missing column(s) from the Recipe to columns in{' '}
                        <code>{activeTable.alias}</code>:
                      </p>
                      <div className="wb-form-row">
                        {missingCols.map((missing) => (
                          <label key={missing}>
                            Missing: <code>{missing}</code>
                            <select
                              aria-label={`Map missing column ${missing}`}
                              value={driftMap[missing] ?? ''}
                              onChange={(e) =>
                                setDriftMap({ ...driftMap, [missing]: e.target.value })
                              }
                            >
                              <option value="">Select column…</option>
                              {userColumns.map((c) => (
                                <option key={c.name} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="wb-audit-ok">
                      All referenced columns match <code>{activeTable.alias}</code> cleanly.
                    </p>
                  )}

                  <div className="wb-review-actions">
                    <button
                      type="button"
                      className="wb-btn wb-btn-primary"
                      disabled={!activeTable || isBusy || missingCols.some((col) => !driftMap[col])}
                      onClick={() => void handleReplayImportedRecipe(importedRecipe)}
                    >
                      Replay Imported Recipe
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {/* Bottom Status Bar */}
      <footer className="wb-statusbar">
        <span>{busyLabel ?? statusNote}</span>
        <div className="wb-status-right">
          <span
            className="wb-sw-pill"
            title="Convenience Service Worker indicator — verify authoritatively via DevTools Network & Offline toggle"
          >
            {swStatus.ready
              ? `Offline Cache: ${swStatus.cachedCount} assets · SW net: ${swStatus.netFetchCount} · blocked: ${swStatus.externalBlockedCount}`
              : swStatus.supported
                ? 'Offline Cache: priming…'
                : 'Offline Cache: unavailable'}
          </span>
          <span>All data stays in tab (:memory: DuckDB-WASM 1.32.0)</span>
          <button type="button" className="wb-wipe-link" onClick={handleWipeSession}>
            Wipe all local data
          </button>
        </div>
      </footer>
    </div>
  );
}
