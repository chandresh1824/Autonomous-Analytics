import { FilterGroup, FilterNode, SemanticModel } from "../../schemas/semantic";

export interface SemanticValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  // Only populated by POST /import (the draft version just created) - left
  // null for a plain POST /validate, which never saves anything.
  version_id: string | null;
}

/** Business-rule validation beyond the structural checks already enforced on
 * load (unknown entity/metric references etc.). */
export function validateSemanticModel(model: SemanticModel): SemanticValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const dimensionNames = new Set(model.entities.flatMap((e) => e.dimensions.map((d) => d.name)));

  const seenEntities = new Set<string>();
  for (const entity of model.entities) {
    if (seenEntities.has(entity.name)) {
      errors.push(`Duplicate entity name '${entity.name}'`);
    }
    seenEntities.add(entity.name);

    const seenColumns = new Set<string>();
    for (const dim of entity.dimensions) {
      if (seenColumns.has(dim.column_name)) {
        errors.push(`Duplicate column '${dim.column_name}' on entity '${entity.name}'`);
      }
      seenColumns.add(dim.column_name);

      if (dim.reference) {
        const target = model.getEntity(dim.reference.target_entity);
        if (target) {
          const targetColumns = new Set(target.primary_keys.map((pk) => pk.toLowerCase()));
          for (const d2 of target.dimensions) targetColumns.add(d2.column_name.toLowerCase());
          if (!targetColumns.has(dim.reference.target_key.toLowerCase())) {
            errors.push(
              `Dimension '${dim.name}' on entity '${entity.name}' references ` +
                `'${dim.reference.target_entity}.${dim.reference.target_key}', but ` +
                `'${dim.reference.target_key}' is not a column on '${dim.reference.target_entity}'`
            );
          }
        }
      }
    }
  }

  for (const kpi of model.kpis) {
    if (kpi.metric_ids.length === 0) {
      warnings.push(`KPI '${kpi.name}' does not reference any metric`);
    }
    for (const dimName of kpi.required_grouping_dimensions) {
      if (!dimensionNames.has(dimName)) {
        errors.push(`KPI '${kpi.name}' requires unknown grouping dimension '${dimName}'`);
      } else if (kpi.supported_dimensions.length > 0 && !kpi.supported_dimensions.includes(dimName)) {
        warnings.push(`KPI '${kpi.name}' required dimension '${dimName}' is missing from supported_dimensions`);
      }
    }
    for (const dimName of kpi.supported_dimensions) {
      if (dimName.includes("::")) continue; // cross-entity qualified dimension, validated at resolve time
      if (!dimensionNames.has(dimName)) {
        warnings.push(`KPI '${kpi.name}' supports unknown dimension '${dimName}'`);
      }
    }
  }

  for (const metric of model.metrics) {
    for (const dimName of metric.supported_dimensions) {
      if (dimName.includes("::")) continue;
      if (!dimensionNames.has(dimName)) {
        warnings.push(`Metric '${metric.name}' supports unknown dimension '${dimName}'`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, version_id: null };
}

/**
 * Reasons a model can't be published yet (empty when it can). Separate from
 * `validateSemanticModel` because an incomplete model is still fine to save
 * as a draft - it just mustn't go live, since the agent can't answer
 * anything from a model with nothing to group by or nothing to aggregate.
 */
export function getPublishBlockers(model: SemanticModel): string[] {
  const blockers: string[] = [];
  if (!model.entities.some((e) => e.dimensions.length > 0)) {
    blockers.push("Add at least one dimension before publishing.");
  }
  if (!model.entities.some((e) => e.measures.length > 0)) {
    blockers.push("Add at least one measure before publishing.");
  }
  return blockers;
}
