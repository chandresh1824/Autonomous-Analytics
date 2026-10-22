import { Pool } from "mysql2/promise";
import { NotFoundError } from "../core/exceptions";
import { KPI, SemanticModel } from "../schemas/semantic";
import { SemanticValidationResult, validateSemanticModel } from "../services/semantic/validator";
import { SemanticModelRepository } from "./semanticRepository";

/**
 * KPI definitions are part of the semantic model hierarchy (KPI -> Metric ->
 * Measure -> Dimensions -> filters), so KPI CRUD is implemented as
 * structured edits to the working semantic model version rather than a
 * parallel, disconnected KPI table. Every operation is scoped to a single
 * data source's semantic model.
 */
export class KPIRepository {
  private readonly semanticRepository: SemanticModelRepository;

  constructor(private readonly db: Pool) {
    this.semanticRepository = new SemanticModelRepository(db);
  }

  private async currentModel(dataSourceId: string): Promise<SemanticModel> {
    const model = await this.semanticRepository.getWorking(dataSourceId);
    if (!model) throw new NotFoundError("No semantic model has been loaded yet for this data source");
    return model;
  }

  async list(dataSourceId: string): Promise<KPI[]> {
    const model = await this.currentModel(dataSourceId);
    return model.kpis;
  }

  async get(dataSourceId: string, kpiId: string): Promise<KPI | null> {
    const model = await this.currentModel(dataSourceId);
    return model.getKpiById(kpiId);
  }

  async create(dataSourceId: string, kpi: KPI): Promise<[KPI, SemanticValidationResult]> {
    const model = await this.currentModel(dataSourceId);
    if (model.getKpiById(kpi.id)) throw new Error(`KPI id '${kpi.id}' already exists`);
    const newModel = model.copyWith({ kpis: [...model.kpis, kpi] });
    const validation = validateSemanticModel(newModel);
    await this.semanticRepository.saveDraft(newModel, dataSourceId);
    return [kpi, validation];
  }

  async update(dataSourceId: string, kpiId: string, kpi: KPI): Promise<[KPI, SemanticValidationResult]> {
    const model = await this.currentModel(dataSourceId);
    if (!model.getKpiById(kpiId)) throw new NotFoundError(`KPI '${kpiId}' not found`);
    const updatedKpis = model.kpis.map((k) => (k.id === kpiId ? kpi : k));
    const newModel = model.copyWith({ kpis: updatedKpis });
    const validation = validateSemanticModel(newModel);
    await this.semanticRepository.saveDraft(newModel, dataSourceId);
    return [kpi, validation];
  }

  async delete(dataSourceId: string, kpiId: string): Promise<void> {
    const model = await this.currentModel(dataSourceId);
    const remaining = model.kpis.filter((k) => k.id !== kpiId);
    if (remaining.length === model.kpis.length) throw new NotFoundError(`KPI '${kpiId}' not found`);
    const newModel = model.copyWith({ kpis: remaining });
    await this.semanticRepository.saveDraft(newModel, dataSourceId);
  }

  async setEnabled(dataSourceId: string, kpiId: string, enabled: boolean): Promise<KPI> {
    const model = await this.currentModel(dataSourceId);
    const kpi = model.getKpiById(kpiId);
    if (!kpi) throw new NotFoundError(`KPI '${kpiId}' not found`);
    const updated: KPI = { ...kpi, enabled };
    const updatedKpis = model.kpis.map((k) => (k.id === kpiId ? updated : k));
    const newModel = model.copyWith({ kpis: updatedKpis });
    await this.semanticRepository.saveDraft(newModel, dataSourceId);
    return updated;
  }
}
