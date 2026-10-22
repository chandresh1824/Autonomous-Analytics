import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SemanticModelNavState } from '@/components/settings/semantic-model/SemanticModelPanel';
import { AutoColumnPicker, type ColumnSelection } from '@/components/settings/AutoColumnPicker';
import type { Dimension, KPI, Measure, Metric, RelationshipSuggestion, SemanticModel } from '@/types/api';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { TagInput } from '@/components/common/TagInput';
import { useToast } from '@/components/common/Toast';
import { useConnections } from '@/features/connections/hooks';
import {
  useDatasourceTables,
  useGenerateSemanticModel,
  useImportSemanticModel,
  useSemanticModel,
  useSemanticModelVersions,
  useSuggestRelationships,
  useSuggestSynonyms,
} from '@/features/semantic-model/hooks';
import {
  clearWizardDraftMark,
  isWizardDraft,
  readWizardDraftMark,
  writeWizardDraftMark,
} from '@/features/semantic-model/wizardDraft';
import { getApiErrorMessage } from '@/services/apiClient';
import { getPublishBlockers } from '@/utils/semanticFields';
import {
  AGGREGATION_OPTIONS,
  CARDINALITY_OPTIONS,
  CROSS_FILTER_OPTIONS,
  DATATYPE_OPTIONS,
} from '@/components/settings/semantic-model/shared/options';
import { DatabaseSelect } from '@/components/settings/semantic-model/DatabaseSelect';
import { KpisStep } from '@/components/settings/semantic-model/wizard/KpisStep';
import { MetricsStep } from '@/components/settings/semantic-model/wizard/MetricsStep';
import { findBrokenReferences } from '@/components/settings/semantic-model/wizard/modelReferences';
import { WizardShell } from '@/components/settings/semantic-model/wizard/WizardShell';
import { WIZARD_STEPS, type WizardStep } from '@/components/settings/semantic-model/wizard/wizardSteps';

/** Bare, lower-cased column name ("`orders`.`order_total`" -> "order_total"). */
function bareColumn(name: string): string {
  return (name.split('.').pop() ?? name).replace(/[`"[\]]/g, '').trim().toLowerCase();
}

/** Lower-cased identifiers a measure expression uses ("SUM(order_total)" ->
 * ["sum", "order_total"]) - only ever compared against real column names. */
function expressionColumns(expression: string): string[] {
  return expression.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? [];
}

function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** A first-guess semantic datatype from the raw database type string (e.g.
 * "VARCHAR(255)", "INTEGER", "DATETIME") for a manually-added dimension -
 * purely a starting point, always overridable via the same datatype field
 * used everywhere else in the model, never written back to the database. */
function normalizeDbDatatype(dbType: string): string {
  const t = dbType.toUpperCase();
  if (t.includes('BOOL')) return 'boolean';
  if (t.includes('DATETIME') || t.includes('TIMESTAMP')) return 'datetime';
  if (t.includes('DATE')) return 'date';
  if (t.includes('DEC') || t.includes('NUMERIC') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('REAL')) {
    return 'decimal';
  }
  if (t.includes('INT')) return 'int';
  if (t.includes('TEXT') || t.includes('CLOB')) return 'text';
  return 'varchar';
}

interface DimensionDraftRow {
  key: string;
  table: string;
  column: string;
  name: string;
  datatype: string;
  description: string;
  synonyms: string[];
  isKey: boolean;
}

interface MeasureDraftRow {
  key: string;
  table: string;
  column: string;
  name: string;
  aggregation: string;
  datatype: string;
  format: string;
  description: string;
  synonyms: string[];
}

interface PendingRelationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: string;
  crossFilterDirection: string;
  source: 'database' | 'llm' | 'manual';
}

function relationshipId(fromTable: string, fromColumn: string, toTable: string, toColumn: string): string {
  return `${fromTable}.${fromColumn}->${toTable}.${toColumn}`;
}

/** A blank model for the chosen tables. When editing an existing model,
 * its metrics and KPIs are carried over from `carryFrom` so changing the
 * table selection doesn't drop them - any that end up pointing at something
 * the new model lacks are flagged on Publish. */
function buildInitialModel(connectionId: string, tables: string[], carryFrom?: SemanticModel | null): SemanticModel {
  return {
    version: '1.0.0',
    data_source_id: connectionId,
    entities: tables.map((t) => ({
      name: titleCase(t),
      table_name: t,
      description: '',
      primary_keys: [],
      dimensions: [],
      measures: [],
    })),
    metrics: carryFrom?.metrics ?? [],
    kpis: carryFrom?.kpis ?? [],
  };
}

/** Attaches every pending relationship onto the dimension whose column
 * matches its source (the only way this schema can express a relationship -
 * see `Dimension.reference`). Dimensions are never created here - a
 * relationship whose source or target column isn't already modeled as a
 * dimension (or, for the target side, a primary key) is left unresolved and
 * reported back so the Preview step can warn about it, prompting the user to
 * add that dimension explicitly (via the Dimensions step) rather than having
 * one appear implicitly just because a relationship mentioned the column. */
function applyPendingRelationships(
  model: SemanticModel,
  pending: PendingRelationship[],
): { model: SemanticModel; unresolved: PendingRelationship[] } {
  const unresolved: PendingRelationship[] = [];
  const entities = model.entities.map((e) => ({ ...e, dimensions: e.dimensions.map((d) => ({ ...d })) }));

  for (const rel of pending) {
    const sourceEntity = entities.find((e) => e.table_name === rel.fromTable);
    const targetEntity = entities.find((e) => e.table_name === rel.toTable);
    if (!sourceEntity || !targetEntity) {
      unresolved.push(rel);
      continue;
    }
    const sourceDim = sourceEntity.dimensions.find((d) => d.column_name === rel.fromColumn);
    const targetKeyExists =
      targetEntity.primary_keys.includes(rel.toColumn) ||
      targetEntity.dimensions.some((d) => d.column_name === rel.toColumn);
    if (!sourceDim || !targetKeyExists) {
      unresolved.push(rel);
      continue;
    }
    sourceDim.reference = {
      target_entity: targetEntity.name,
      target_key: rel.toColumn,
      cardinality: rel.cardinality,
      cross_filter_direction: rel.crossFilterDirection,
    };
  }
  return { model: { ...model, entities }, unresolved };
}

/** The inverse of `applyPendingRelationships` - reconstructs the
 * Relationships step's review list from a model's own `Dimension.reference`
 * fields. Needed when resuming a saved draft: the draft's dimensions/
 * measures already carry their real references (nothing is lost there),
 * but the Relationships step's list is separate, ephemeral wizard state
 * that would otherwise come back empty, making already-configured
 * relationships invisible to review/edit even though they're still intact
 * in the model underneath. */
function extractPendingRelationships(model: SemanticModel): PendingRelationship[] {
  const relationships: PendingRelationship[] = [];
  for (const entity of model.entities) {
    for (const dim of entity.dimensions) {
      if (!dim.reference) continue;
      const targetEntity = model.entities.find((e) => e.name === dim.reference!.target_entity);
      if (!targetEntity) continue;
      relationships.push({
        id: relationshipId(entity.table_name, dim.column_name, targetEntity.table_name, dim.reference.target_key),
        fromTable: entity.table_name,
        fromColumn: dim.column_name,
        toTable: targetEntity.table_name,
        toColumn: dim.reference.target_key,
        cardinality: dim.reference.cardinality,
        crossFilterDirection: dim.reference.cross_filter_direction,
        source: 'manual',
      });
    }
  }
  return relationships;
}

/* Unsaved wizard progress is kept in memory only: it survives moving to other
   pages and back, but a manual page refresh starts fresh. Progress saved with
   "Save as draft" is reopened from the server draft instead (see
   features/semantic-model/wizardDraft). */
let wizardMemory: WizardSnapshot | null = null;

interface WizardSnapshot {
  step: WizardStep;
  connectionId: string;
  selectedTables: string[];
  workingModel: SemanticModel | null;
  pendingRelationships: PendingRelationship[];
  dimensionCreationMode: 'manual' | 'auto' | null;
  manualDimTables: string[];
  manualDimDrafts: DimensionDraftRow[];
  autoDimColumns: ColumnSelection;
  measureCreationMode: 'manual' | 'auto' | null;
  manualMeasureTables: string[];
  manualMeasureDrafts: MeasureDraftRow[];
  autoMeasureColumns: ColumnSelection;
  suggestions: RelationshipSuggestion[];
  suggestionsFetched: boolean;
  manualRel: { fromTable: string; fromColumn: string; toTable: string; toColumn: string };
}

/** The saved wizard progress, unless it belongs to a different database
 * than the one the user just asked to model. */
function loadWizardSnapshot(requestedConnectionId?: string): WizardSnapshot | null {
  const snapshot = wizardMemory;
  if (!snapshot?.connectionId) return null;
  if (requestedConnectionId && requestedConnectionId !== snapshot.connectionId) return null;
  return snapshot;
}

function saveWizardSnapshot(snapshot: WizardSnapshot) {
  wizardMemory = snapshot;
}

function clearWizardSnapshot() {
  wizardMemory = null;
}

export function GenerateSemanticModelPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const connectionsQuery = useConnections();
  const connections = connectionsQuery.data ?? [];
  const requestedConnectionId = (location.state as SemanticModelNavState | null)?.connectionId;

  // Progress from an earlier visit in this page load (read once, on mount).
  const [restored] = useState(() => loadWizardSnapshot(requestedConnectionId));
  // Otherwise, a draft this wizard saved before a refresh is reopened.
  const [draftMark] = useState(() => {
    if (restored) return null;
    const mark = readWizardDraftMark();
    if (!mark || (requestedConnectionId && requestedConnectionId !== mark.connectionId)) return null;
    return mark;
  });
  const [draftHydrated, setDraftHydrated] = useState(!draftMark);

  const [step, setStep] = useState<WizardStep>(restored?.step ?? 'tables');
  const [connectionId, setConnectionId] = useState(restored?.connectionId ?? draftMark?.connectionId ?? '');
  const [connectionInitialized, setConnectionInitialized] = useState(!!restored || !!draftMark);
  const [selectedTables, setSelectedTables] = useState<string[]>(restored?.selectedTables ?? []);
  const [workingModel, setWorkingModel] = useState<SemanticModel | null>(restored?.workingModel ?? null);
  const [pendingRelationships, setPendingRelationships] = useState<PendingRelationship[]>(
    restored?.pendingRelationships ?? [],
  );
  // The Dimensions step asks for one global choice up front (Manual vs Auto
  // Generate using LLM) rather than a per-table toggle - the user must pick
  // before the rest of the step's content (and "Next") is available.
  const [dimensionCreationMode, setDimensionCreationMode] = useState<'manual' | 'auto' | null>(
    restored?.dimensionCreationMode ?? null,
  );
  const [manualDimTables, setManualDimTables] = useState<string[]>(restored?.manualDimTables ?? []);
  const [manualDimDrafts, setManualDimDrafts] = useState<DimensionDraftRow[]>(restored?.manualDimDrafts ?? []);
  const [autoDimColumns, setAutoDimColumns] = useState<ColumnSelection>(restored?.autoDimColumns ?? {});
  // The Measures step mirrors the Dimensions step's design: one global
  // Manual/Auto choice, gating the rest of the step until picked.
  const [measureCreationMode, setMeasureCreationMode] = useState<'manual' | 'auto' | null>(
    restored?.measureCreationMode ?? null,
  );
  const [manualMeasureTables, setManualMeasureTables] = useState<string[]>(restored?.manualMeasureTables ?? []);
  const [manualMeasureDrafts, setManualMeasureDrafts] = useState<MeasureDraftRow[]>(
    restored?.manualMeasureDrafts ?? [],
  );
  const [autoMeasureColumns, setAutoMeasureColumns] = useState<ColumnSelection>(restored?.autoMeasureColumns ?? {});
  const [suggestions, setSuggestions] = useState<RelationshipSuggestion[]>(restored?.suggestions ?? []);
  const [suggestionsFetched, setSuggestionsFetched] = useState(restored?.suggestionsFetched ?? false);
  const [manualRel, setManualRel] = useState<{ fromTable: string; fromColumn: string; toTable: string; toColumn: string }>(
    restored?.manualRel ?? { fromTable: '', fromColumn: '', toTable: '', toColumn: '' },
  );

  // Defaults to the connection the user came from (passed in navigation state)
  // once the connection list has loaded, falling back to whichever
  // connection is marked default - never re-runs after that first pick, so
  // it doesn't fight the user's own selection on this page.
  useEffect(() => {
    if (connectionInitialized || connections.length === 0) return;
    const preferred =
      connections.find((c) => c.id === requestedConnectionId) ?? connections.find((c) => c.is_default) ?? connections[0];
    setConnectionId(preferred.id);
    setConnectionInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, connectionInitialized]);

  const tablesQuery = useDatasourceTables(connectionId);
  const generateModel = useGenerateSemanticModel();
  const suggestRelationships = useSuggestRelationships();
  const suggestSynonyms = useSuggestSynonyms();
  const importModel = useImportSemanticModel();

  // A new semantic model starts empty and is saved as the database's draft;
  // nothing from the published model is carried into it.
  const existingVersionsQuery = useSemanticModelVersions(connectionId || undefined);
  // The draft this wizard saved (if any) can be saved over again; any other
  // pending draft must be published or discarded on the Semantic Model page
  // first - one draft per database.
  const ownsDraft = isWizardDraft(connectionId, existingVersionsQuery.data);
  const hasPendingDraft = !ownsDraft && !!existingVersionsQuery.data?.some((v) => v.status === 'draft');
  // Draft content, only needed to reopen the wizard after a refresh.
  const savedDraftQuery = useSemanticModel(draftHydrated ? undefined : connectionId || undefined);

  // Tracks which connection's tables `selectedTables` was last auto-populated
  // for - NOT just "is selectedTables empty", since that's also true right
  // after the user deliberately unchecks everything, and can't be
  // distinguished from "not initialized yet" that way. Comparing against
  // `connectionId` instead means this still fires correctly even when
  // `tablesQuery.data` was already cached from an earlier visit to this same
  // connection (a plain "did the data object change" check misses that case
  // entirely, since React Query returns the exact same cached reference and
  // the effect never re-runs - leaving every checkbox stuck unchecked and
  // "Next" permanently disabled).
  // A restored selection is already initialized for its connection.
  const [tablesInitializedFor, setTablesInitializedFor] = useState(
    restored?.connectionId ?? draftMark?.connectionId ?? '',
  );

  // Reopen the wizard from its saved draft once that draft has loaded. If
  // the draft is gone (published or discarded since), start fresh instead.
  useEffect(() => {
    if (draftHydrated || !draftMark || !existingVersionsQuery.data) return;
    if (!ownsDraft) {
      clearWizardDraftMark();
      setTablesInitializedFor('');
      setDraftHydrated(true);
      return;
    }
    const draft = savedDraftQuery.data;
    if (!draft) return;
    setWorkingModel(draft);
    setSelectedTables(draft.entities.map((e) => e.table_name));
    setPendingRelationships(extractPendingRelationships(draft));
    // Saved dimensions/measures stay reachable under Manual, which always
    // shows the review list.
    setDimensionCreationMode(draft.entities.some((e) => e.dimensions.length > 0) ? 'manual' : null);
    setMeasureCreationMode(draft.entities.some((e) => e.measures.length > 0) ? 'manual' : null);
    if (WIZARD_STEPS.some((st) => st.key === draftMark.step)) setStep(draftMark.step as WizardStep);
    setDraftHydrated(true);
  }, [draftHydrated, draftMark, existingVersionsQuery.data, ownsDraft, savedDraftQuery.data]);

  // Save progress on every change, so leaving the page or a reload resumes here.
  useEffect(() => {
    if (!connectionId) return;
    saveWizardSnapshot({
      step,
      connectionId,
      selectedTables,
      workingModel,
      pendingRelationships,
      dimensionCreationMode,
      manualDimTables,
      manualDimDrafts,
      autoDimColumns,
      measureCreationMode,
      manualMeasureTables,
      manualMeasureDrafts,
      autoMeasureColumns,
      suggestions,
      suggestionsFetched,
      manualRel,
    });
  }, [
    step,
    connectionId,
    selectedTables,
    workingModel,
    pendingRelationships,
    dimensionCreationMode,
    manualDimTables,
    manualDimDrafts,
    autoDimColumns,
    measureCreationMode,
    manualMeasureTables,
    manualMeasureDrafts,
    autoMeasureColumns,
    suggestions,
    suggestionsFetched,
    manualRel,
  ]);

  useEffect(() => {
    if (tablesQuery.data && tablesInitializedFor !== connectionId) {
      setSelectedTables(tablesQuery.data.map((t) => t.table_name));
      setTablesInitializedFor(connectionId);
    }
  }, [tablesQuery.data, connectionId, tablesInitializedFor]);

  // Changing the connection mid-page restarts table selection - the
  // previous connection's tables/columns don't exist on the new one. The
  // effect above repopulates it as soon as the new connection's tables are
  // available (immediately, if already cached from an earlier visit).
  // Guarded to an actual change: re-selecting the already-selected
  // connection (a `<select>` re-firing onChange with an unchanged value)
  // must not wipe out a selection already in progress for it.
  const changeConnection = (nextConnectionId: string) => {
    if (nextConnectionId === connectionId) return;
    setConnectionId(nextConnectionId);
    setSelectedTables([]);
  };

  const tableColumns = (tableName: string): string[] =>
    (tablesQuery.data ?? []).find((t) => t.table_name === tableName)?.columns.map((c) => c.name) ?? [];

  const isBusy = generateModel.isPending || importModel.isPending;

  const cancel = () => {
    if (isBusy) return;
    // A draft already saved stays; it's edited and published from the page.
    clearWizardSnapshot();
    clearWizardDraftMark();
    navigate('/settings/semantic-model');
  };

  const goToRelationships = () => {
    if (!connectionId || selectedTables.length === 0) return;
    // Going Tables -> Next must not blow away progress already modeled -
    // whether resumed from a saved draft or built earlier this session -
    // just because the user stepped Back to Tables and forward again
    // without actually changing which tables are selected. Only rebuild a
    // blank model when there's none yet, or the table selection actually
    // changed (added/removed a table changes what needs modeling).
    const existingTables = workingModel ? new Set(workingModel.entities.map((e) => e.table_name)) : null;
    const unchanged =
      !!existingTables && existingTables.size === selectedTables.length && selectedTables.every((t) => existingTables.has(t));
    if (!unchanged) {
      // The new parts start empty; the existing model is added back on save.
      setWorkingModel(buildInitialModel(connectionId, selectedTables));
      setPendingRelationships([]);
      setSuggestions([]);
      setSuggestionsFetched(false);
      setDimensionCreationMode(null);
      setManualDimTables([]);
      setManualDimDrafts([]);
      setAutoDimColumns({});
      setMeasureCreationMode(null);
      setManualMeasureTables([]);
      setManualMeasureDrafts([]);
      setAutoMeasureColumns({});
    }
    setStep('relationships');
  };

  // The wizard only ever saves a draft. It goes live from the Semantic Model
  // page's "Publish changes", after review.
  // Available on every step. Before the last step it saves and stays, so a
  // refresh reopens the wizard here; on the last step it finishes and goes
  // back to the Semantic Model page to review and publish.
  const saveDraft = () => {
    if (!modelToSave || hasPendingDraft) return;
    const finishing = step === 'preview';
    importModel.mutate(
      { model: modelToSave, connectionId },
      {
        onSuccess: (result) => {
          if (finishing) {
            toast.success('Saved as a draft. Review and publish it from the Semantic Model page.');
            clearWizardSnapshot();
            clearWizardDraftMark();
            navigate('/settings/semantic-model', { state: { connectionId } satisfies SemanticModelNavState });
            return;
          }
          if (result.version_id) writeWizardDraftMark({ connectionId, versionId: result.version_id, step });
          toast.success('Draft saved.');
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save draft.')),
      },
    );
  };

  // ---- Relationships ------------------------------------------------------

  const fetchSuggestions = async () => {
    try {
      const result = await suggestRelationships.mutateAsync({ connectionId, tables: selectedTables });
      setSuggestions(result);
      setSuggestionsFetched(true);
      if (result.length === 0) toast.info('No relationships found - the database declares no foreign keys here, and nothing plausible was inferred from column names.');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to fetch relationship suggestions.'));
    }
  };

  const isAccepted = (s: RelationshipSuggestion) =>
    pendingRelationships.some((p) => p.id === relationshipId(s.from_table, s.from_column, s.to_table, s.to_column));

  const acceptSuggestion = (s: RelationshipSuggestion) => {
    const id = relationshipId(s.from_table, s.from_column, s.to_table, s.to_column);
    if (pendingRelationships.some((p) => p.id === id)) return;
    setPendingRelationships((prev) => [
      ...prev,
      {
        id,
        fromTable: s.from_table,
        fromColumn: s.from_column,
        toTable: s.to_table,
        toColumn: s.to_column,
        cardinality: s.cardinality,
        crossFilterDirection: 'single',
        source: s.source,
      },
    ]);
  };

  const removeRelationship = (id: string) => setPendingRelationships((prev) => prev.filter((p) => p.id !== id));

  const updateRelationship = (id: string, patch: Partial<PendingRelationship>) =>
    setPendingRelationships((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addManualRelationship = () => {
    const { fromTable, fromColumn, toTable, toColumn } = manualRel;
    if (!fromTable || !fromColumn || !toTable || !toColumn) return;
    const id = relationshipId(fromTable, fromColumn, toTable, toColumn);
    if (pendingRelationships.some((p) => p.id === id)) {
      toast.error('That relationship is already in the list.');
      return;
    }
    setPendingRelationships((prev) => [
      ...prev,
      { id, fromTable, fromColumn, toTable, toColumn, cardinality: 'many_to_one', crossFilterDirection: 'single', source: 'manual' },
    ]);
    setManualRel({ fromTable: '', fromColumn: '', toTable: '', toColumn: '' });
  };

  // ---- Dimensions / Measures generation ------------------------------------

  const setEntityDimensions = (table: string, dimensions: Dimension[]) =>
    setWorkingModel((prev) =>
      prev ? { ...prev, entities: prev.entities.map((e) => (e.table_name === table ? { ...e, dimensions } : e)) } : prev,
    );

  const setEntityMeasures = (table: string, measures: Measure[]) =>
    setWorkingModel((prev) =>
      prev ? { ...prev, entities: prev.entities.map((e) => (e.table_name === table ? { ...e, measures } : e)) } : prev,
    );

  // ---- Dimensions step: Manual mode (Select tables -> Select columns ->
  // Configure -> Add) ---------------------------------------------------------

  const toggleManualDimTable = (table: string) =>
    setManualDimTables((prev) => (prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]));

  /** Selecting a column stages it as an editable draft row rather than
   * writing it into the model immediately - "Configure Dimension" is a
   * distinct step from "Add Dimension" so name/type/key/description/synonyms
   * can be set before anything is committed. */
  const addDraftColumn = (table: string, columnName: string, dbType: string) => {
    const key = `${table}::${columnName}`;
    setManualDimDrafts((prev) => {
      if (prev.some((r) => r.key === key)) return prev;
      return [
        ...prev,
        { key, table, column: columnName, name: titleCase(columnName), datatype: normalizeDbDatatype(dbType), description: '', synonyms: [], isKey: false },
      ];
    });
  };

  const updateDraftRow = (key: string, patch: Partial<DimensionDraftRow>) =>
    setManualDimDrafts((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeDraftRow = (key: string) => setManualDimDrafts((prev) => prev.filter((r) => r.key !== key));

  const commitManualDrafts = () => {
    if (manualDimDrafts.length === 0) return;
    setWorkingModel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entities: prev.entities.map((e) => {
          const rows = manualDimDrafts.filter((r) => r.table === e.table_name);
          if (rows.length === 0) return e;
          const newDims: Dimension[] = rows.map((r) => ({
            name: r.name,
            column_name: r.column,
            datatype: r.datatype,
            description: r.description,
            synonyms: r.synonyms,
            reference: null,
          }));
          const newKeys = rows.filter((r) => r.isKey).map((r) => r.column);
          return {
            ...e,
            dimensions: [...e.dimensions, ...newDims],
            primary_keys: Array.from(new Set([...e.primary_keys, ...newKeys])),
          };
        }),
      };
    });
    toast.success(`Added ${manualDimDrafts.length} dimension(s).`);
    setManualDimDrafts([]);
  };

  // ---- Dimensions step: Auto Generate using LLM mode -------------------------

  /** Generates dimensions for the chosen columns of each chosen table and
   * writes the result straight into the working model for review/edit below
   * - nothing is published here, publishing only ever happens from the
   * final Preview step. Only the chosen columns' dimensions are replaced;
   * dimensions for other columns are kept. A table regenerated with all its
   * columns also takes the generated name, description and primary keys. */
  const generateDimensionsForTables = async (selection: ColumnSelection) => {
    const tables = Object.keys(selection);
    if (tables.length === 0) return;
    try {
      const result = await generateModel.mutateAsync({ connectionId, tables, columns: selection });
      setWorkingModel((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entities: prev.entities.map((e) => {
            const generated = result.entities.find((r) => r.table_name === e.table_name);
            const chosen = selection[e.table_name];
            if (!generated || !chosen) return e;
            const chosenSet = new Set(chosen.map((c) => c.toLowerCase()));
            const wholeTable = chosen.length === tableColumns(e.table_name).length;
            return {
              ...e,
              name: wholeTable ? generated.name || e.name : e.name,
              description: wholeTable ? generated.description || e.description : e.description,
              primary_keys: wholeTable
                ? generated.primary_keys
                : Array.from(new Set([...e.primary_keys, ...generated.primary_keys])),
              dimensions: [
                ...e.dimensions.filter((d) => !chosenSet.has(bareColumn(d.column_name))),
                ...generated.dimensions,
              ],
            };
          }),
        };
      });
      toast.success(`Generated dimensions for ${tables.length} table(s) - review before publishing.`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to generate dimensions.'));
    }
  };

  /** Toggles whether `column` is one of `table`'s primary/key columns - the
   * Dimensions step's per-row "Key" checkbox, backing `Entity.primary_keys`
   * (used elsewhere to validate relationship targets). */
  const toggleEntityKey = (table: string, column: string) =>
    setWorkingModel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entities: prev.entities.map((e) => {
          if (e.table_name !== table) return e;
          const isKey = e.primary_keys.includes(column);
          return { ...e, primary_keys: isKey ? e.primary_keys.filter((k) => k !== column) : [...e.primary_keys, column] };
        }),
      };
    });

  // ---- Measures step: Manual mode (Select tables -> Select columns ->
  // Configure -> Add) ---------------------------------------------------------

  const toggleManualMeasureTable = (table: string) =>
    setManualMeasureTables((prev) => (prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]));

  const addMeasureDraftColumn = (table: string, columnName: string, dbType: string) => {
    const key = `${table}::${columnName}`;
    setManualMeasureDrafts((prev) => {
      if (prev.some((r) => r.key === key)) return prev;
      return [
        ...prev,
        {
          key,
          table,
          column: columnName,
          name: titleCase(columnName),
          aggregation: 'sum',
          datatype: normalizeDbDatatype(dbType),
          format: '',
          description: '',
          synonyms: [],
        },
      ];
    });
  };

  const updateMeasureDraftRow = (key: string, patch: Partial<MeasureDraftRow>) =>
    setManualMeasureDrafts((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeMeasureDraftRow = (key: string) => setManualMeasureDrafts((prev) => prev.filter((r) => r.key !== key));

  const commitManualMeasureDrafts = () => {
    if (manualMeasureDrafts.length === 0) return;
    setWorkingModel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entities: prev.entities.map((e) => {
          const rows = manualMeasureDrafts.filter((r) => r.table === e.table_name);
          if (rows.length === 0) return e;
          const newMeasures: Measure[] = rows.map((r) => ({
            name: r.name,
            expression: r.column,
            aggregation: r.aggregation,
            datatype: r.datatype,
            format: r.format || null,
            description: r.description,
            synonyms: r.synonyms,
          }));
          return { ...e, measures: [...e.measures, ...newMeasures] };
        }),
      };
    });
    toast.success(`Added ${manualMeasureDrafts.length} measure(s).`);
    setManualMeasureDrafts([]);
  };

  // ---- Measures step: Auto Generate using LLM mode ---------------------------

  /** Generates measures for the chosen columns of each chosen table and
   * writes the result straight into the working model for review/edit below
   * - nothing is published here. Only measures built on the chosen columns
   * are replaced; measures on other columns are kept, matching the
   * Dimensions step's Auto Generate behavior. */
  const generateMeasuresForTables = async (selection: ColumnSelection) => {
    const tables = Object.keys(selection);
    if (tables.length === 0) return;
    try {
      const result = await generateModel.mutateAsync({ connectionId, tables, columns: selection });
      setWorkingModel((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entities: prev.entities.map((e) => {
            const generated = result.entities.find((r) => r.table_name === e.table_name);
            const chosen = selection[e.table_name];
            if (!generated || !chosen) return e;
            const chosenSet = new Set(chosen.map((c) => c.toLowerCase()));
            const wholeTable = chosen.length === tableColumns(e.table_name).length;
            return {
              ...e,
              name: wholeTable ? generated.name || e.name : e.name,
              description: wholeTable ? generated.description || e.description : e.description,
              measures: [
                ...e.measures.filter((m) => !expressionColumns(m.expression).some((c) => chosenSet.has(c))),
                ...generated.measures,
              ],
            };
          }),
        };
      });
      toast.success(`Generated measures for ${tables.length} table(s) - review before publishing.`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to generate measures.'));
    }
  };

  // ---- Synonyms -------------------------------------------------------------

  type SynField = { entityName: string; kind: 'dimension' | 'measure'; fieldName: string; description: string; synonyms: string[] };
  const synonymFields: SynField[] = useMemo(() => {
    if (!workingModel) return [];
    return workingModel.entities.flatMap((entity) => [
      ...entity.dimensions.map((d) => ({ entityName: entity.name, kind: 'dimension' as const, fieldName: d.name, description: d.description, synonyms: d.synonyms })),
      ...entity.measures.map((m) => ({ entityName: entity.name, kind: 'measure' as const, fieldName: m.name, description: m.description ?? '', synonyms: m.synonyms })),
    ]);
  }, [workingModel]);

  const setFieldSynonyms = (entityName: string, kind: 'dimension' | 'measure', fieldName: string, synonyms: string[]) => {
    setWorkingModel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        entities: prev.entities.map((e) => {
          if (e.name !== entityName) return e;
          if (kind === 'dimension') {
            return { ...e, dimensions: e.dimensions.map((d) => (d.name === fieldName ? { ...d, synonyms } : d)) };
          }
          return { ...e, measures: e.measures.map((m) => (m.name === fieldName ? { ...m, synonyms } : m)) };
        }),
      };
    });
  };

  const [generatingAllSynonyms, setGeneratingAllSynonyms] = useState(false);

  const generateOneSynonym = async (field: SynField) => {
    try {
      const generated = await suggestSynonyms.mutateAsync({ entity_name: field.entityName, field_name: field.fieldName, description: field.description });
      setFieldSynonyms(field.entityName, field.kind, field.fieldName, Array.from(new Set([...field.synonyms, ...generated])));
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Failed to generate synonyms for "${field.fieldName}".`));
    }
  };

  const generateAllSynonyms = async () => {
    setGeneratingAllSynonyms(true);
    try {
      for (const field of synonymFields) {
        if (field.synonyms.length > 0) continue;
        // eslint-disable-next-line no-await-in-loop
        await generateOneSynonym(field);
      }
      toast.success('Generated synonyms for every field that had none.');
    } finally {
      setGeneratingAllSynonyms(false);
    }
  };

  // ---- Metrics / KPIs -------------------------------------------------------

  const setModelMetrics = (metrics: Metric[]) => setWorkingModel((prev) => (prev ? { ...prev, metrics } : prev));
  const setModelKpis = (kpis: KPI[]) => setWorkingModel((prev) => (prev ? { ...prev, kpis } : prev));
  const addModelMetric = useCallback(
    (metric: Metric) => setWorkingModel((prev) => (prev ? { ...prev, metrics: [...(prev.metrics ?? []), metric] } : prev)),
    [],
  );

  // ---- Preview / Publish ----------------------------------------------------

  const { model: previewModel, unresolved: unresolvedRelationships } = useMemo(() => {
    if (!workingModel) return { model: null as SemanticModel | null, unresolved: [] as PendingRelationship[] };
    return applyPendingRelationships(workingModel, pendingRelationships);
  }, [workingModel, pendingRelationships]);

  const totalDimensions = previewModel?.entities.reduce((sum, e) => sum + e.dimensions.length, 0) ?? 0;
  const totalMeasures = previewModel?.entities.reduce((sum, e) => sum + e.measures.length, 0) ?? 0;
  const totalRelationships = previewModel?.entities.reduce((sum, e) => sum + e.dimensions.filter((d) => d.reference).length, 0) ?? 0;
  const totalSynonymFields = synonymFields.filter((f) => f.synonyms.length > 0).length;

  // The draft holds only what was added here.
  const modelToSave = previewModel;

  const publishBlockers = getPublishBlockers(modelToSave);
  const brokenReferences = useMemo(() => findBrokenReferences(modelToSave), [modelToSave]);
  const totalMetrics = previewModel?.metrics?.length ?? 0;
  const totalKpis = previewModel?.kpis?.length ?? 0;

  const steps: Record<WizardStep, () => JSX.Element> = {
    tables: () => (
      <div className="form-grid">
        <DatabaseSelect connections={connections} value={connectionId} onChange={changeConnection} />
        {hasPendingDraft && (
          <div className="test-result test-result-error">
            <strong>This database has unpublished changes.</strong> Publish or discard them on the Semantic Model
            page before adding a new semantic model.
          </div>
        )}
        <div className="form-field">
          <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
            <label>Tables</label>
            {(tablesQuery.data ?? []).length > 0 && (
              <div className="form-actions-right">
                <Button variant="ghost" size="sm" onClick={() => setSelectedTables((tablesQuery.data ?? []).map((t) => t.table_name))}>
                  Select all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedTables([])}>
                  Select none
                </Button>
              </div>
            )}
          </div>
          {tablesQuery.isLoading ? (
            <Spinner size={16} />
          ) : (tablesQuery.data ?? []).length === 0 ? (
            <p className="settings-panel-subtitle">No tables found for this connection.</p>
          ) : (
            <ul className="table-select-list">
              {(tablesQuery.data ?? []).map((t) => (
                <li key={t.table_name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedTables.includes(t.table_name)}
                      onChange={() =>
                        setSelectedTables((prev) =>
                          prev.includes(t.table_name) ? prev.filter((x) => x !== t.table_name) : [...prev, t.table_name],
                        )
                      }
                    />
                    {t.table_name}
                    <span className="settings-panel-subtitle"> ({t.column_count} columns)</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    ),

    relationships: () => (
      <div className="form-grid">
        <p className="settings-panel-subtitle">
          Configure relationships between the selected tables first - dimensions and measures are
          modeled afterward.
        </p>
        <Button variant="secondary" size="sm" loading={suggestRelationships.isPending} onClick={fetchSuggestions}>
          {suggestionsFetched ? 'Refresh suggestions' : 'Suggest relationships'}
        </Button>
        {suggestions.length > 0 && (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Source</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const accepted = isAccepted(s);
                  return (
                    <tr key={relationshipId(s.from_table, s.from_column, s.to_table, s.to_column)}>
                      <td className="mono-cell">
                        {s.from_table}.{s.from_column}
                      </td>
                      <td className="mono-cell">
                        {s.to_table}.{s.to_column}
                      </td>
                      <td>
                        <Badge tone={s.source === 'database' ? 'success' : 'neutral'}>
                          {s.source === 'database' ? 'declared FK' : 'LLM guess'}
                        </Badge>
                      </td>
                      <td className="settings-table-muted">{s.reason}</td>
                      <td>
                        <Button variant={accepted ? 'ghost' : 'secondary'} size="sm" disabled={accepted} onClick={() => acceptSuggestion(s)}>
                          {accepted ? 'Added' : 'Accept'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <h4>Relationships</h4>
        {pendingRelationships.length === 0 ? (
          <EmptyState title="No relationships yet" description="Accept a suggestion above, or add one manually below." />
        ) : (
          <ul className="relationship-list">
            {pendingRelationships.map((rel) => (
              <li key={rel.id} className="relationship-item">
                <span className="mono-cell">
                  {rel.fromTable}.{rel.fromColumn}
                </span>
                <span className="relationship-arrow">&rarr;</span>
                <span className="mono-cell">
                  {rel.toTable}.{rel.toColumn}
                </span>
                <select value={rel.cardinality} onChange={(e) => updateRelationship(rel.id, { cardinality: e.target.value })}>
                  {CARDINALITY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={rel.crossFilterDirection}
                  onChange={(e) => updateRelationship(rel.id, { crossFilterDirection: e.target.value })}
                >
                  {CROSS_FILTER_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <IconButton
                  icon="trash"
                  label="Remove relationship"
                  variant="ghost"
                  size="xs"
                  round={false}
                  tone="danger"
                  onClick={() => removeRelationship(rel.id)}
                />
              </li>
            ))}
          </ul>
        )}

        <h4>Add relationship manually</h4>
        <div className="form-row-2">
          <div className="form-field">
            <label>Source table</label>
            <select value={manualRel.fromTable} onChange={(e) => setManualRel({ ...manualRel, fromTable: e.target.value, fromColumn: '' })}>
              <option value="">Select…</option>
              {selectedTables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Source column</label>
            <select value={manualRel.fromColumn} onChange={(e) => setManualRel({ ...manualRel, fromColumn: e.target.value })} disabled={!manualRel.fromTable}>
              <option value="">Select…</option>
              {tableColumns(manualRel.fromTable).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row-2">
          <div className="form-field">
            <label>Target table</label>
            <select value={manualRel.toTable} onChange={(e) => setManualRel({ ...manualRel, toTable: e.target.value, toColumn: '' })}>
              <option value="">Select…</option>
              {selectedTables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Target column</label>
            <select value={manualRel.toColumn} onChange={(e) => setManualRel({ ...manualRel, toColumn: e.target.value })} disabled={!manualRel.toTable}>
              <option value="">Select…</option>
              {tableColumns(manualRel.toTable).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!manualRel.fromTable || !manualRel.fromColumn || !manualRel.toTable || !manualRel.toColumn}
            onClick={addManualRelationship}
          >
            + Add
          </Button>
        </div>
      </div>
    ),

    dimensions: () => (
      <div className="form-grid">
        <div className="form-field">
          <label>How do you want to create dimensions?</label>
          <div className="radio-group" role="radiogroup" aria-label="Dimension creation mode">
            <label>
              <input
                type="radio"
                name="dimension-creation-mode"
                checked={dimensionCreationMode === 'manual'}
                onChange={() => setDimensionCreationMode('manual')}
              />
              Manual
            </label>
            <label>
              <input
                type="radio"
                name="dimension-creation-mode"
                checked={dimensionCreationMode === 'auto'}
                onChange={() => setDimensionCreationMode('auto')}
              />
              Auto Generate using LLM
            </label>
          </div>
        </div>

        {dimensionCreationMode === null && (
          <EmptyState title="Choose Manual or Auto Generate using LLM to continue" />
        )}

        {dimensionCreationMode === 'manual' && (
          <>
            <div className="form-field">
              <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
                <label>Select tables</label>
                <div className="form-actions-right">
                  <Button variant="ghost" size="sm" onClick={() => setManualDimTables(selectedTables)}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setManualDimTables([])}>
                    Select none
                  </Button>
                </div>
              </div>
              <ul className="table-select-list">
                {selectedTables.map((t) => (
                  <li key={t}>
                    <label>
                      <input type="checkbox" checked={manualDimTables.includes(t)} onChange={() => toggleManualDimTable(t)} />
                      {t}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            {manualDimTables.map((table) => {
              const entity = workingModel?.entities.find((e) => e.table_name === table);
              const usedColumns = new Set(entity?.dimensions.map((d) => d.column_name));
              const stagedColumns = new Set(manualDimDrafts.filter((r) => r.table === table).map((r) => r.column));
              const availableColumns = tableColumns(table).filter((c) => !usedColumns.has(c) && !stagedColumns.has(c));
              if (availableColumns.length === 0) return null;
              return (
                <div key={table} className="form-field">
                  <label>Select columns from &quot;{table}&quot;</label>
                  <select
                    value=""
                    onChange={(e) => {
                      const col = tablesQuery.data?.find((t) => t.table_name === table)?.columns.find((c) => c.name === e.target.value);
                      if (col) addDraftColumn(table, col.name, col.datatype);
                    }}
                  >
                    <option value="">Select a column…</option>
                    {availableColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}

            {manualDimDrafts.length > 0 && (
              <div className="grouped-list-section">
                <h4>Configure dimensions</h4>
                <div className="settings-table-wrap">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Table</th>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Key</th>
                        <th>Description</th>
                        <th>Synonyms</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualDimDrafts.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <input value={row.name} onChange={(e) => updateDraftRow(row.key, { name: e.target.value })} />
                          </td>
                          <td className="mono-cell">{row.table}</td>
                          <td className="mono-cell">{row.column}</td>
                          <td style={{ minWidth: 140 }}>
                            <select value={row.datatype} onChange={(e) => updateDraftRow(row.key, { datatype: e.target.value })}>
                              {DATATYPE_OPTIONS.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                              {!DATATYPE_OPTIONS.includes(row.datatype) && <option value={row.datatype}>{row.datatype}</option>}
                            </select>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={row.isKey}
                              onChange={(e) => updateDraftRow(row.key, { isKey: e.target.checked })}
                            />
                          </td>
                          <td>
                            <input value={row.description} onChange={(e) => updateDraftRow(row.key, { description: e.target.value })} />
                          </td>
                          <td style={{ minWidth: 180 }}>
                            <TagInput
                              value={row.synonyms}
                              onChange={(next) => updateDraftRow(row.key, { synonyms: next })}
                              placeholder="Add synonym…"
                            />
                          </td>
                          <td>
                            <IconButton
                              icon="trash"
                              label={`Remove ${row.name}`}
                              variant="ghost"
                              size="xs"
                              round={false}
                              tone="danger"
                              onClick={() => removeDraftRow(row.key)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <Button onClick={commitManualDrafts}>+ Add Dimension{manualDimDrafts.length > 1 ? 's' : ''}</Button>
                </div>
              </div>
            )}
          </>
        )}

        {dimensionCreationMode === 'auto' && (
          <>
            <AutoColumnPicker
              tables={selectedTables}
              columnsOf={tableColumns}
              value={autoDimColumns}
              onChange={setAutoDimColumns}
            />
            <div>
              <Button
                loading={generateModel.isPending}
                disabled={Object.keys(autoDimColumns).length === 0}
                onClick={() => generateDimensionsForTables(autoDimColumns)}
              >
                Generate dimensions
              </Button>
            </div>
          </>
        )}

        {dimensionCreationMode !== null && (
          <div className="grouped-list-section">
            <h4>Review dimensions</h4>
            {selectedTables.every((table) => (workingModel?.entities.find((e) => e.table_name === table)?.dimensions.length ?? 0) === 0) ? (
              <EmptyState title="No dimensions yet" description="Add some manually, or generate them with the LLM above." />
            ) : (
              selectedTables.map((table) => {
                const entity = workingModel?.entities.find((e) => e.table_name === table);
                if (!entity || entity.dimensions.length === 0) return null;
                return (
                  <div key={table} className="grouped-list-section">
                    <h4>{table}</h4>
                    <div className="settings-table-wrap">
                      <table className="settings-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Column</th>
                            <th>Type</th>
                            <th>Key</th>
                            <th>Description</th>
                            <th>Synonyms</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {entity.dimensions.map((dim, i) => (
                            <tr key={dim.column_name}>
                              <td>
                                <input
                                  value={dim.name}
                                  onChange={(e) => {
                                    const next = [...entity.dimensions];
                                    next[i] = { ...dim, name: e.target.value };
                                    setEntityDimensions(table, next);
                                  }}
                                />
                              </td>
                              <td className="mono-cell">{dim.column_name}</td>
                              <td style={{ minWidth: 140 }}>
                                <select
                                  value={dim.datatype}
                                  onChange={(e) => {
                                    const next = [...entity.dimensions];
                                    next[i] = { ...dim, datatype: e.target.value };
                                    setEntityDimensions(table, next);
                                  }}
                                >
                                  {DATATYPE_OPTIONS.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                  {!DATATYPE_OPTIONS.includes(dim.datatype) && <option value={dim.datatype}>{dim.datatype}</option>}
                                </select>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={entity.primary_keys.includes(dim.column_name)}
                                  onChange={() => toggleEntityKey(table, dim.column_name)}
                                />
                              </td>
                              <td>
                                <input
                                  value={dim.description}
                                  onChange={(e) => {
                                    const next = [...entity.dimensions];
                                    next[i] = { ...dim, description: e.target.value };
                                    setEntityDimensions(table, next);
                                  }}
                                />
                              </td>
                              <td style={{ minWidth: 180 }}>
                                <TagInput
                                  value={dim.synonyms}
                                  onChange={(next) => {
                                    const nextDims = [...entity.dimensions];
                                    nextDims[i] = { ...dim, synonyms: next };
                                    setEntityDimensions(table, nextDims);
                                  }}
                                  placeholder="Add synonym…"
                                />
                              </td>
                              <td>
                                <IconButton
                                  icon="trash"
                                  label="Remove dimension"
                                  variant="ghost"
                                  size="xs"
                                  round={false}
                                  tone="danger"
                                  onClick={() => setEntityDimensions(table, entity.dimensions.filter((_, idx) => idx !== i))}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    ),

    measures: () => (
      <div className="form-grid">
        <div className="form-field">
          <label>How do you want to create measures?</label>
          <div className="radio-group" role="radiogroup" aria-label="Measure creation mode">
            <label>
              <input
                type="radio"
                name="measure-creation-mode"
                checked={measureCreationMode === 'manual'}
                onChange={() => setMeasureCreationMode('manual')}
              />
              Manual
            </label>
            <label>
              <input
                type="radio"
                name="measure-creation-mode"
                checked={measureCreationMode === 'auto'}
                onChange={() => setMeasureCreationMode('auto')}
              />
              Auto Generate using LLM
            </label>
          </div>
        </div>

        {measureCreationMode === null && (
          <EmptyState title="Choose Manual or Auto Generate using LLM to continue" />
        )}

        {measureCreationMode === 'manual' && (
          <>
            <div className="form-field">
              <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
                <label>Select tables</label>
                <div className="form-actions-right">
                  <Button variant="ghost" size="sm" onClick={() => setManualMeasureTables(selectedTables)}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setManualMeasureTables([])}>
                    Select none
                  </Button>
                </div>
              </div>
              <ul className="table-select-list">
                {selectedTables.map((t) => (
                  <li key={t}>
                    <label>
                      <input
                        type="checkbox"
                        checked={manualMeasureTables.includes(t)}
                        onChange={() => toggleManualMeasureTable(t)}
                      />
                      {t}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            {manualMeasureTables.map((table) => {
              const entity = workingModel?.entities.find((e) => e.table_name === table);
              const usedColumns = new Set(entity?.measures.map((m) => m.expression));
              const stagedColumns = new Set(manualMeasureDrafts.filter((r) => r.table === table).map((r) => r.column));
              const availableColumns = tableColumns(table).filter((c) => !usedColumns.has(c) && !stagedColumns.has(c));
              if (availableColumns.length === 0) return null;
              return (
                <div key={table} className="form-field">
                  <label>Select columns from &quot;{table}&quot;</label>
                  <select
                    value=""
                    onChange={(e) => {
                      const col = tablesQuery.data?.find((t) => t.table_name === table)?.columns.find((c) => c.name === e.target.value);
                      if (col) addMeasureDraftColumn(table, col.name, col.datatype);
                    }}
                  >
                    <option value="">Select a column…</option>
                    {availableColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}

            {manualMeasureDrafts.length > 0 && (
              <div className="grouped-list-section">
                <h4>Configure measures</h4>
                <div className="settings-table-wrap">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Table</th>
                        <th>Column</th>
                        <th>Aggregation</th>
                        <th>Type</th>
                        <th>Format</th>
                        <th>Description</th>
                        <th>Synonyms</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualMeasureDrafts.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <input value={row.name} onChange={(e) => updateMeasureDraftRow(row.key, { name: e.target.value })} />
                          </td>
                          <td className="mono-cell">{row.table}</td>
                          <td className="mono-cell">{row.column}</td>
                          <td>
                            <select value={row.aggregation} onChange={(e) => updateMeasureDraftRow(row.key, { aggregation: e.target.value })}>
                              {AGGREGATION_OPTIONS.map((a) => (
                                <option key={a} value={a}>
                                  {a}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ minWidth: 140 }}>
                            <select value={row.datatype} onChange={(e) => updateMeasureDraftRow(row.key, { datatype: e.target.value })}>
                              {DATATYPE_OPTIONS.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                              {!DATATYPE_OPTIONS.includes(row.datatype) && <option value={row.datatype}>{row.datatype}</option>}
                            </select>
                          </td>
                          <td>
                            <input value={row.format} onChange={(e) => updateMeasureDraftRow(row.key, { format: e.target.value })} />
                          </td>
                          <td>
                            <input value={row.description} onChange={(e) => updateMeasureDraftRow(row.key, { description: e.target.value })} />
                          </td>
                          <td style={{ minWidth: 180 }}>
                            <TagInput
                              value={row.synonyms}
                              onChange={(next) => updateMeasureDraftRow(row.key, { synonyms: next })}
                              placeholder="Add synonym…"
                            />
                          </td>
                          <td>
                            <IconButton
                              icon="trash"
                              label={`Remove ${row.name}`}
                              variant="ghost"
                              size="xs"
                              round={false}
                              tone="danger"
                              onClick={() => removeMeasureDraftRow(row.key)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <Button onClick={commitManualMeasureDrafts}>+ Add Measure{manualMeasureDrafts.length > 1 ? 's' : ''}</Button>
                </div>
              </div>
            )}
          </>
        )}

        {measureCreationMode === 'auto' && (
          <>
            <AutoColumnPicker
              tables={selectedTables}
              columnsOf={tableColumns}
              value={autoMeasureColumns}
              onChange={setAutoMeasureColumns}
            />
            <div>
              <Button
                loading={generateModel.isPending}
                disabled={Object.keys(autoMeasureColumns).length === 0}
                onClick={() => generateMeasuresForTables(autoMeasureColumns)}
              >
                Generate measures
              </Button>
            </div>
          </>
        )}

        {measureCreationMode !== null && (
          <div className="grouped-list-section">
            <h4>Review measures</h4>
            {selectedTables.every((table) => (workingModel?.entities.find((e) => e.table_name === table)?.measures.length ?? 0) === 0) ? (
              <EmptyState title="No measures yet" description="Add some manually, or generate them with the LLM above." />
            ) : (
              selectedTables.map((table) => {
                const entity = workingModel?.entities.find((e) => e.table_name === table);
                if (!entity || entity.measures.length === 0) return null;
                return (
                  <div key={table} className="grouped-list-section">
                    <h4>{table}</h4>
                    <div className="settings-table-wrap">
                      <table className="settings-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Column</th>
                            <th>Aggregation</th>
                            <th>Type</th>
                            <th>Format</th>
                            <th>Description</th>
                            <th>Synonyms</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {entity.measures.map((measure, i) => (
                            <tr key={measure.expression}>
                              <td>
                                <input
                                  value={measure.name}
                                  onChange={(e) => {
                                    const next = [...entity.measures];
                                    next[i] = { ...measure, name: e.target.value };
                                    setEntityMeasures(table, next);
                                  }}
                                />
                              </td>
                              <td className="mono-cell">{measure.expression}</td>
                              <td>
                                <select
                                  value={measure.aggregation}
                                  onChange={(e) => {
                                    const next = [...entity.measures];
                                    next[i] = { ...measure, aggregation: e.target.value };
                                    setEntityMeasures(table, next);
                                  }}
                                >
                                  {AGGREGATION_OPTIONS.map((a) => (
                                    <option key={a} value={a}>
                                      {a}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ minWidth: 140 }}>
                                <select
                                  value={measure.datatype}
                                  onChange={(e) => {
                                    const next = [...entity.measures];
                                    next[i] = { ...measure, datatype: e.target.value };
                                    setEntityMeasures(table, next);
                                  }}
                                >
                                  {DATATYPE_OPTIONS.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                  {!DATATYPE_OPTIONS.includes(measure.datatype) && (
                                    <option value={measure.datatype}>{measure.datatype}</option>
                                  )}
                                </select>
                              </td>
                              <td>
                                <input
                                  value={measure.format ?? ''}
                                  onChange={(e) => {
                                    const next = [...entity.measures];
                                    next[i] = { ...measure, format: e.target.value || null };
                                    setEntityMeasures(table, next);
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  value={measure.description ?? ''}
                                  onChange={(e) => {
                                    const next = [...entity.measures];
                                    next[i] = { ...measure, description: e.target.value };
                                    setEntityMeasures(table, next);
                                  }}
                                />
                              </td>
                              <td style={{ minWidth: 180 }}>
                                <TagInput
                                  value={measure.synonyms}
                                  onChange={(next) => {
                                    const nextMeasures = [...entity.measures];
                                    nextMeasures[i] = { ...measure, synonyms: next };
                                    setEntityMeasures(table, nextMeasures);
                                  }}
                                  placeholder="Add synonym…"
                                />
                              </td>
                              <td>
                                <IconButton
                                  icon="trash"
                                  label="Remove measure"
                                  variant="ghost"
                                  size="xs"
                                  round={false}
                                  tone="danger"
                                  onClick={() => setEntityMeasures(table, entity.measures.filter((_, idx) => idx !== i))}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    ),

    synonyms: () => (
      <div className="form-grid">
        <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
          <p className="settings-panel-subtitle">
            Business-meaning synonyms for every dimension and measure - generate them, or write your own.
          </p>
          <Button variant="secondary" size="sm" loading={generatingAllSynonyms} onClick={generateAllSynonyms} disabled={synonymFields.length === 0}>
            Generate all missing
          </Button>
        </div>
        {synonymFields.length === 0 ? (
          <EmptyState title="No dimensions or measures yet" description="Go back and add some first." />
        ) : (
          <div className="synonym-group-list">
            {synonymFields.map((field) => (
              <div key={`${field.entityName}::${field.kind}::${field.fieldName}`} className="synonym-group">
                <div className="synonym-group-title">
                  {field.entityName} <span className="synonym-group-dim">/ {field.fieldName}</span>
                  <Badge tone="neutral">{field.kind}</Badge>
                  <Button variant="ghost" size="sm" loading={suggestSynonyms.isPending} onClick={() => generateOneSynonym(field)}>
                    Generate
                  </Button>
                </div>
                <TagInput
                  value={field.synonyms}
                  onChange={(next) => setFieldSynonyms(field.entityName, field.kind, field.fieldName, next)}
                  placeholder="Add synonym…"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    ),

    metrics: () =>
      previewModel ? <MetricsStep model={previewModel} onChange={setModelMetrics} /> : <EmptyState title="Choose tables first" />,

    kpis: () =>
      previewModel ? (
        <KpisStep model={previewModel} onChange={setModelKpis} onCreateMetric={addModelMetric} />
      ) : (
        <EmptyState title="Choose tables first" />
      ),

    preview: () => (
      <div className="form-grid">
        <div className="form-row-2">
          <div className="entity-card-meta">
            <span>{previewModel?.entities.length ?? 0} entities</span>
            <span>{totalDimensions} dimensions</span>
            <span>{totalMeasures} measures</span>
            <span>{totalRelationships} relationships</span>
            <span>{totalSynonymFields} fields with synonyms</span>
            <span>{totalMetrics} metrics</span>
            <span>{totalKpis} KPIs</span>
          </div>
        </div>
        {unresolvedRelationships.length > 0 && (
          <div className="test-result test-result-error">
            <strong>{unresolvedRelationships.length} relationship(s) could not be applied</strong>
            <ul>
              {unresolvedRelationships.map((r) => (
                <li key={r.id}>
                  {r.fromTable}.{r.fromColumn} → {r.toTable}.{r.toColumn} - one side isn't modeled as a
                  dimension yet. Go back to Dimensions and add that column, or remove this relationship.
                </li>
              ))}
            </ul>
          </div>
        )}
        {(brokenReferences.metrics.length > 0 || brokenReferences.kpis.length > 0) && (
          <div className="test-result test-result-error">
            <strong>Some metrics or KPIs point at things this model doesn&rsquo;t have</strong>
            <ul>
              {brokenReferences.metrics.map(({ metric, missingMeasure }) => (
                <li key={metric.id}>
                  Metric &ldquo;{metric.name}&rdquo; uses measure &ldquo;{missingMeasure}&rdquo;, which isn&rsquo;t in
                  the model. Add that measure, or edit/remove the metric in the Metrics step.
                </li>
              ))}
              {brokenReferences.kpis.map(({ kpi, missingMetricIds }) => (
                <li key={kpi.id}>
                  KPI &ldquo;{kpi.name}&rdquo; uses missing metric(s) {missingMetricIds.join(', ')}. Edit or remove it in
                  the KPIs step.
                </li>
              ))}
            </ul>
          </div>
        )}
        {previewModel?.entities.map((entity) => (
          <div key={entity.name} className="grouped-list-section">
            <h4>
              {entity.name} <span className="entity-card-table">{entity.table_name}</span>
            </h4>
            {entity.dimensions.length > 0 && (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Dimension</th>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Reference</th>
                      <th>Synonyms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entity.dimensions.map((dim) => (
                      <tr key={dim.name}>
                        <td className="settings-table-primary">{dim.name}</td>
                        <td className="mono-cell">{dim.column_name}</td>
                        <td>{dim.datatype}</td>
                        <td>
                          {dim.reference ? (
                            <Badge tone="accent">
                              {dim.reference.target_entity}.{dim.reference.target_key}
                            </Badge>
                          ) : (
                            '–'
                          )}
                        </td>
                        <td className="settings-table-muted">{dim.synonyms.join(', ') || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {entity.measures.length > 0 && (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Measure</th>
                      <th>Column</th>
                      <th>Aggregation</th>
                      <th>Synonyms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entity.measures.map((measure) => (
                      <tr key={measure.name}>
                        <td className="settings-table-primary">{measure.name}</td>
                        <td className="mono-cell">{measure.expression}</td>
                        <td>{measure.aggregation}</td>
                        <td className="settings-table-muted">{measure.synonyms.join(', ') || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        {(totalMetrics > 0 || totalKpis > 0) && (
          <div className="grouped-list-section">
            <h4>Business logic</h4>
            {totalMetrics > 0 && (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Base measure</th>
                      <th>Filters</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewModel?.metrics.map((metric) => (
                      <tr key={metric.id}>
                        <td className="settings-table-primary">{metric.name}</td>
                        <td className="mono-cell">{metric.base_measure}</td>
                        <td className="settings-table-muted">{metric.filters.length || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalKpis > 0 && (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>KPI</th>
                      <th>Metrics</th>
                      <th>Enabled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewModel?.kpis.map((kpi) => (
                      <tr key={kpi.id}>
                        <td className="settings-table-primary">{kpi.name}</td>
                        <td className="settings-table-muted">{kpi.metric_ids.join(', ') || '–'}</td>
                        <td>{kpi.enabled ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    ),
  };

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.key === step);
  const goNext = () => {
    if (step === 'tables') return goToRelationships();
    setStep(WIZARD_STEPS[stepIndex + 1].key);
  };
  const goBack = () => setStep(WIZARD_STEPS[stepIndex - 1].key);

  // Running totals for the step header, so progress is visible at a glance.
  const stepSummary: Partial<Record<WizardStep, string>> = {
    tables: `${selectedTables.length} selected`,
    relationships: `${pendingRelationships.length} added`,
    dimensions: `${totalDimensions} total`,
    measures: `${totalMeasures} total`,
    synonyms: `${totalSynonymFields} / ${synonymFields.length} fields`,
    metrics: `${totalMetrics} total`,
    kpis: `${totalKpis} total`,
  };
  const canGoNext =
    step === 'tables'
      ? !!connectionId && selectedTables.length > 0 && !hasPendingDraft
      : step === 'dimensions'
        ? dimensionCreationMode !== null
        : step === 'measures'
          ? measureCreationMode !== null
          : true;

  return (
    <div className="settings-panel">
      <WizardShell
        step={step}
        onSelectStep={setStep}
        busy={isBusy}
        headerAside={stepSummary[step] ? <span className="wz-step-count">{stepSummary[step]}</span> : undefined}
        footer={
          <>
            <div>
              {stepIndex > 0 && (
                <Button variant="ghost" disabled={isBusy} onClick={goBack}>
                  Back
                </Button>
              )}
            </div>
            <div className="form-actions-right">
              <Button variant="ghost" disabled={isBusy} onClick={cancel}>
                Cancel
              </Button>
              {step !== 'preview' && workingModel && (
                <Button
                  variant="secondary"
                  loading={importModel.isPending}
                  disabled={isBusy || hasPendingDraft}
                  title={hasPendingDraft ? 'This database already has unpublished changes.' : undefined}
                  onClick={saveDraft}
                >
                  Save as draft
                </Button>
              )}
              {step === 'preview' ? (
                <Button
                  loading={importModel.isPending}
                  disabled={isBusy || !modelToSave || hasPendingDraft}
                  title={hasPendingDraft ? 'This database already has unpublished changes.' : undefined}
                  onClick={saveDraft}
                >
                  Save as draft
                </Button>
              ) : (
                <Button disabled={!canGoNext || isBusy} onClick={goNext}>
                  Next
                </Button>
              )}
            </div>
          </>
        }
      >
        {steps[step]()}
        {step === 'preview' && publishBlockers.length > 0 && (
          <div className="test-result test-result-error">
            <strong>Needed before this can be published.</strong> {publishBlockers.join(' ')} You can save the
            draft now and add them later, or go back to the Dimensions or Measures step.
          </div>
        )}
      </WizardShell>
    </div>
  );
}
