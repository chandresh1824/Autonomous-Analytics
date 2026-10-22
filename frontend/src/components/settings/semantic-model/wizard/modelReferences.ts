import type { KPI, Metric, SemanticModel } from '@/types/api';

export interface BrokenMetric {
  metric: Metric;
  /** The base measure the metric names, which no entity has. */
  missingMeasure: string;
}

export interface BrokenKpi {
  kpi: KPI;
  /** Metric ids the KPI references that aren't in the model. */
  missingMetricIds: string[];
}

/**
 * Metrics and KPIs carried into a rebuilt model can point at things the new
 * model no longer has (a measure that wasn't regenerated, a deleted metric).
 * Listed so the Publish step can flag them before they go live.
 */
export function findBrokenReferences(model: SemanticModel | null | undefined): {
  metrics: BrokenMetric[];
  kpis: BrokenKpi[];
} {
  if (!model) return { metrics: [], kpis: [] };
  const measureNames = new Set(model.entities.flatMap((e) => e.measures.map((m) => m.name)));
  const metricIds = new Set((model.metrics ?? []).map((m) => m.id));
  return {
    metrics: (model.metrics ?? [])
      .filter((metric) => !measureNames.has(metric.base_measure))
      .map((metric) => ({ metric, missingMeasure: metric.base_measure })),
    kpis: (model.kpis ?? [])
      .map((kpi) => ({ kpi, missingMetricIds: kpi.metric_ids.filter((id) => !metricIds.has(id)) }))
      .filter((entry) => entry.missingMetricIds.length > 0),
  };
}
