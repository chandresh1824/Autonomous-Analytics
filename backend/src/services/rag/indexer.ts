import { getLogger } from "../../core/logging";
import { SemanticModel } from "../../schemas/semantic";
import { EmbeddingProvider } from "./embeddings";
import { VectorDocument, VectorStore } from "./vectorStore";

const logger = getLogger("services.rag.indexer");

interface SemanticDoc {
  id: string;
  type: string;
  entity: string;
  name: string;
  text: string;
}

/**
 * Flatten the semantic model into RAG-indexable documents.
 *
 * Only semantic metadata is indexed (entity/dimension/measure/metric/KPI
 * descriptions and synonyms) - never raw database rows. Every document id
 * and metadata entry is namespaced by `model.data_source_id` so documents
 * from different databases never collide or bleed into each other's search
 * results.
 */
export function buildSemanticDocuments(model: SemanticModel): SemanticDoc[] {
  const docs: SemanticDoc[] = [];
  const source = model.data_source_id || "default";

  for (const entity of model.entities) {
    docs.push({
      id: `${source}::entity::${entity.name}`,
      type: "entity",
      entity: entity.name,
      name: entity.name,
      text: `Entity: ${entity.name}. Table: ${entity.table_name}. ${entity.description}`,
    });
    for (const dim of entity.dimensions) {
      const synonyms = dim.synonyms.join(", ");
      docs.push({
        id: `${source}::dimension::${entity.name}::${dim.name}`,
        type: "dimension",
        entity: entity.name,
        name: dim.name,
        text: `Dimension: ${dim.name} on entity ${entity.name}. ${dim.description} Synonyms: ${synonyms}.`,
      });
    }
    for (const measure of entity.measures) {
      docs.push({
        id: `${source}::measure::${entity.name}::${measure.name}`,
        type: "measure",
        entity: entity.name,
        name: measure.name,
        text:
          `Measure: ${measure.name} on entity ${entity.name}. Aggregation: ${measure.aggregation}. ${measure.description || ""}` +
          (measure.synonyms.length ? ` Synonyms: ${measure.synonyms.join(", ")}.` : ""),
      });
    }
  }

  for (const metric of model.metrics) {
    docs.push({
      id: `${source}::metric::${metric.id}`,
      type: "metric",
      entity: "",
      name: metric.name,
      text: `Metric: ${metric.name}. ${metric.description} Base measure: ${metric.base_measure}.`,
    });
  }

  for (const kpi of model.kpis) {
    docs.push({
      id: `${source}::kpi::${kpi.id}`,
      type: "kpi",
      entity: "",
      name: kpi.name,
      text: `KPI: ${kpi.name}. ${kpi.description} Formula: ${kpi.formula}.`,
    });
  }

  return docs;
}

export class SemanticIndexer {
  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    readonly vectorStore: VectorStore
  ) {}

  async indexModel(model: SemanticModel): Promise<number> {
    const source = model.data_source_id || "default";
    const docs = buildSemanticDocuments(model);
    await this.vectorStore.delete(null, { data_source_id: source });
    if (docs.length === 0) return 0;
    const texts = docs.map((d) => d.text);
    const embeddings = await this.embeddingProvider.embed(texts);
    const vectorDocs: VectorDocument[] = docs.map((doc, i) => ({
      id: doc.id,
      text: doc.text,
      embedding: embeddings[i],
      metadata: { type: doc.type, entity: doc.entity, name: doc.name, data_source_id: source },
    }));
    await this.vectorStore.addDocuments(vectorDocs);
    logger.info("semantic_index_built", { document_count: vectorDocs.length, data_source_id: source });
    return vectorDocs.length;
  }
}
