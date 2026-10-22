import { Pool } from "mysql2/promise";
import { NotFoundError } from "../core/exceptions";
import { Metric, SemanticModel } from "../schemas/semantic";
import { SemanticValidationResult, validateSemanticModel } from "../services/semantic/validator";
import { SemanticModelRepository } from "./semanticRepository";

/**
 * Metric definitions are part of the semantic model hierarchy (a Metric
 * wraps a base Measure with filters/formatting, and a KPI references one or
 * more Metrics), so Metric CRUD is implemented as structured edits to the
 * working semantic model version - the same pattern `KPIRepository` uses for
 * KPIs, and scoped to a single data source the same way.
 */
export class MetricRepository {
  private readonly semanticRepository: SemanticModelRepository;

  constructor(private readonly db: Pool) {
    this.semanticRepository = new SemanticModelRepository(db);
  }

  private async currentModel(dataSourceId: string): Promise<SemanticModel> {
    const model = await this.semanticRepository.getWorking(dataSourceId);
    if (!model) throw new NotFoundError("No semantic model has been loaded yet for this data source");
    return model;
  }

  async list(dataSourceId: string): Promise<Metric[]> {
    const model = await this.currentModel(dataSourceId);
    return model.metrics;
  }

  async get(dataSourceId: string, metricId: string): Promise<Metric | null> {
    const model = await this.currentModel(dataSourceId);
    return model.getMetricById(metricId);
  }

  async create(dataSourceId: string, metric: Metric): Promise<[Metric, SemanticValidationResult]> {
    const model = await this.currentModel(dataSourceId);
    if (model.getMetricById(metric.id)) throw new Error(`Metric id '${metric.id}' already exists`);
    const newModel = model.copyWith({ metrics: [...model.metrics, metric] });
    const validation = validateSemanticModel(newModel);
    await this.semanticRepository.saveDraft(newModel, dataSourceId);
    return [metric, validation];
  }

  async update(dataSourceId: string, metricId: string, metric: Metric): Promise<[Metric, SemanticValidationResult]> {
    const model = await this.currentModel(dataSourceId);
    if (!model.getMetricById(metricId)) throw new NotFoundError(`Metric '${metricId}' not found`);
    const updatedMetrics = model.metrics.map((m) => (m.id === metricId ? metric : m));
    const newModel = model.copyWith({ metrics: updatedMetrics });
    const validation = validateSemanticModel(newModel);
    await this.semanticRepository.saveDraft(newModel, dataSourceId);
    return [metric, validation];
  }

  async delete(dataSourceId: string, metricId: string): Promise<void> {
    const model = await this.currentModel(dataSourceId);
    if (!model.getMetricById(metricId)) throw new NotFoundError(`Metric '${metricId}' not found`);
    const blockingKpis = model.kpis.filter((k) => k.metric_ids.includes(metricId)).map((k) => k.name);
    if (blockingKpis.length) {
      throw new Error(`Metric '${metricId}' is still referenced by KPI(s): ${blockingKpis.join(", ")}`);
    }
    const remaining = model.metrics.filter((m) => m.id !== metricId);
    const newModel = model.copyWith({ metrics: remaining });
    await this.semanticRepository.saveDraft(newModel, dataSourceId);
  }
}
