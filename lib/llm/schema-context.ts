/**
 * Schema context builder for LLM prompts
 * Creates a compact but informative schema representation
 */

import type { SchemaInfo, TableSchema, ColumnInfo, Relationship } from '@/lib/types';

// ============================================================================
// Main Builder
// ============================================================================

/**
 * Build a schema context string for LLM prompts
 */
export function buildSchemaContext(schema: SchemaInfo): string {
  const parts: string[] = [];

  // Tables section
  parts.push('### Tables\n');
  for (const table of schema.tables) {
    parts.push(formatTable(table));
  }

  // Relationships section
  if (schema.relationships.length > 0) {
    parts.push('\n### Relationships\n');
    for (const rel of schema.relationships) {
      parts.push(formatRelationship(rel));
    }
  }

  // Sample values section (if available)
  const samplesSection = buildSamplesSection(schema.tables);
  if (samplesSection) {
    parts.push('\n### Sample Values\n');
    parts.push(samplesSection);
  }

  return parts.join('\n');
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format a table definition
 */
function formatTable(table: TableSchema): string {
  const columns = table.columns
    .map((col) => `${col.name} ${col.type}${col.nullable ? '' : ' NOT NULL'}`)
    .join(', ');

  return `- **${table.name}** (${columns}) — ${table.rowCount} rows`;
}

/**
 * Format a relationship
 */
function formatRelationship(rel: Relationship): string {
  return `- ${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn}`;
}

/**
 * Build sample values section
 */
function buildSamplesSection(tables: TableSchema[]): string | null {
  const samples: string[] = [];

  for (const table of tables) {
    for (const column of table.columns) {
      if (column.sampleValues && column.sampleValues.length > 0) {
        const values = column.sampleValues
          .slice(0, 4)
          .map((v) => formatSampleValue(v))
          .join(', ');
        samples.push(`- ${table.name}.${column.name}: ${values}`);
      }
    }
  }

  return samples.length > 0 ? samples.join('\n') : null;
}

/**
 * Format a sample value for display
 */
function formatSampleValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    // Truncate long strings
    const truncated = value.length > 20 ? value.substring(0, 17) + '...' : value;
    return `"${truncated}"`;
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  return String(value);
}

// ============================================================================
// Compact Format (for API responses)
// ============================================================================

/**
 * Create a compact schema representation for API responses
 */
export function compactSchema(schema: SchemaInfo): object {
  return {
    tables: schema.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
      })),
      rowCount: t.rowCount,
    })),
    relationships: schema.relationships.map((r) => ({
      from: `${r.fromTable}.${r.fromColumn}`,
      to: `${r.toTable}.${r.toColumn}`,
    })),
  };
}
