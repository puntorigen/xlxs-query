/**
 * Data loader for DuckDB
 * Loads processed workbook sheets into the database
 */

import { SessionDatabase } from './duckdb';
import type { ProcessedWorkbook, SchemaInfo, TableSchema } from '@/lib/types';

// ============================================================================
// Main Loader
// ============================================================================

/**
 * Load all sheets from a processed workbook into the database
 * Returns the schema information for LLM context
 */
export async function loadWorkbookIntoDatabase(
  db: SessionDatabase,
  workbook: ProcessedWorkbook
): Promise<SchemaInfo> {
  // Ensure database is initialized
  if (!db.isReady()) {
    await db.initialize();
  }

  const tables: TableSchema[] = [];

  // Load each sheet as a table
  for (const sheet of workbook.sheets) {
    // Skip empty sheets
    if (sheet.columns.length === 0 || sheet.data.length === 0) {
      console.log(`[Loader] Skipping empty sheet: ${sheet.originalName}`);
      continue;
    }

    try {
      await db.loadSheet(sheet);

      // Check if this is a matrix sheet with aggregate detection
      const hasAggregateColumn = sheet.columns.some(col => col.name === 'is_aggregate');

      tables.push({
        name: sheet.name,
        columns: sheet.columns,
        rowCount: sheet.rowCount,
        hasAggregateColumn,
      });
    } catch (error) {
      console.error(`[Loader] Error loading sheet ${sheet.name}:`, error);
      // Continue with other sheets
    }
  }

  return {
    tables,
    relationships: workbook.relationships,
  };
}

/**
 * Get sample values for each column in a table
 * Used to enrich schema context for LLM
 */
export async function enrichSchemaWithSamples(
  db: SessionDatabase,
  schema: SchemaInfo,
  sampleCount: number = 5
): Promise<SchemaInfo> {
  const enrichedTables: TableSchema[] = [];

  for (const table of schema.tables) {
    const enrichedColumns = await Promise.all(
      table.columns.map(async (column) => {
        try {
          // Get distinct non-null sample values
          const result = await db.execute(`
            SELECT DISTINCT "${column.name}"
            FROM "${table.name}"
            WHERE "${column.name}" IS NOT NULL
            LIMIT ${sampleCount}
          `);

          return {
            ...column,
            sampleValues: result.rows.map((row) => row[0]),
          };
        } catch {
          return column;
        }
      })
    );

    enrichedTables.push({
      ...table,
      columns: enrichedColumns,
      // Preserve hasAggregateColumn flag
      hasAggregateColumn: table.hasAggregateColumn,
    });
  }

  return {
    ...schema,
    tables: enrichedTables,
  };
}
