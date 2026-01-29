/**
 * DuckDB database management
 * Handles in-memory database instances for Excel data querying
 */

import { DuckDBInstance } from '@duckdb/node-api';
import type { CellValue, ProcessedSheet, ColumnInfo } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface QueryResult {
  columns: string[];
  rows: CellValue[][];
  rowCount: number;
}

// ============================================================================
// Database Class
// ============================================================================

/**
 * Session database wrapper for DuckDB
 * Each upload gets its own in-memory database instance
 */
export class SessionDatabase {
  private instance: DuckDBInstance | null = null;
  private initialized = false;

  /**
   * Initialize the database connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.instance = await DuckDBInstance.create(':memory:');
    this.initialized = true;
    console.log('[DuckDB] Database initialized');
  }

  /**
   * Check if database is ready
   */
  isReady(): boolean {
    return this.initialized && this.instance !== null;
  }

  /**
   * Load a processed sheet into the database as a table
   */
  async loadSheet(sheet: ProcessedSheet): Promise<void> {
    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    const conn = await this.instance.connect();

    try {
      // Build CREATE TABLE statement
      const createSql = buildCreateTableSql(sheet.name, sheet.columns);
      await conn.run(createSql);
      console.log(`[DuckDB] Created table: ${sheet.name}`);

      // Insert data using prepared statement for safety
      if (sheet.data.length > 0) {
        await insertData(conn, sheet.name, sheet.columns, sheet.data);
        console.log(`[DuckDB] Inserted ${sheet.data.length} rows into ${sheet.name}`);
      }
    } finally {
      conn.closeSync();
    }
  }

  /**
   * Execute a SQL query
   */
  async execute(sql: string): Promise<QueryResult> {
    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    const conn = await this.instance.connect();

    try {
      const reader = await conn.runAndReadAll(sql);
      const columns = reader.columnNames();
      const rows = reader.getRows() as CellValue[][];

      return {
        columns,
        rows,
        rowCount: rows.length,
      };
    } finally {
      conn.closeSync();
    }
  }

  /**
   * Get list of tables in the database
   */
  async getTables(): Promise<string[]> {
    const result = await this.execute(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    );
    return result.rows.map((row) => row[0] as string);
  }

  /**
   * Get schema for a specific table
   */
  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    const result = await this.execute(`DESCRIBE ${tableName}`);
    return result.rows.map((row) => ({
      name: row[0] as string,
      originalName: row[0] as string,
      type: mapDuckDBType(row[1] as string),
      nullable: row[2] === 'YES',
      sampleValues: [],
    }));
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.instance) {
      this.instance = null;
      this.initialized = false;
      console.log('[DuckDB] Database closed');
    }
  }
}

// ============================================================================
// SQL Building
// ============================================================================

/**
 * Build CREATE TABLE SQL statement
 */
function buildCreateTableSql(tableName: string, columns: ColumnInfo[]): string {
  const columnDefs = columns
    .map((col) => `"${col.name}" ${col.type}`)
    .join(',\n  ');

  return `CREATE TABLE "${tableName}" (\n  ${columnDefs}\n)`;
}

/**
 * Insert data into a table
 */
async function insertData(
  conn: any,
  tableName: string,
  columns: ColumnInfo[],
  data: CellValue[][]
): Promise<void> {
  if (data.length === 0) return;

  // Build INSERT statement with placeholders
  const columnNames = columns.map((c) => `"${c.name}"`).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;

  // Prepare statement
  const stmt = await conn.prepare(insertSql);

  // Insert each row
  for (const row of data) {
    // Bind parameters
    for (let i = 0; i < columns.length; i++) {
      const value = i < row.length ? row[i] : null;
      const colType = columns[i].type;
      bindValue(stmt, i + 1, value, colType);
    }
    await stmt.run();
  }

  stmt.closeSync();
}

/**
 * Bind a value to a prepared statement parameter
 */
function bindValue(
  stmt: any,
  index: number,
  value: CellValue,
  colType: string
): void {
  if (value === null || value === undefined || value === '') {
    stmt.bindNull(index);
    return;
  }

  switch (colType) {
    case 'INTEGER':
      stmt.bindInteger(index, Math.round(Number(value)));
      break;
    case 'DOUBLE':
      stmt.bindDouble(index, Number(value));
      break;
    case 'BOOLEAN':
      stmt.bindBoolean(index, Boolean(value));
      break;
    case 'DATE':
    case 'TIMESTAMP':
      if (value instanceof Date) {
        stmt.bindVarchar(index, value.toISOString().split('T')[0]);
      } else {
        stmt.bindVarchar(index, String(value));
      }
      break;
    default:
      stmt.bindVarchar(index, String(value));
  }
}

/**
 * Map DuckDB type strings to our type enum
 */
function mapDuckDBType(duckType: string): ColumnInfo['type'] {
  const upper = duckType.toUpperCase();

  if (upper.includes('INT')) return 'INTEGER';
  if (upper.includes('DOUBLE') || upper.includes('FLOAT') || upper.includes('DECIMAL')) {
    return 'DOUBLE';
  }
  if (upper.includes('BOOL')) return 'BOOLEAN';
  if (upper.includes('DATE')) return 'DATE';
  if (upper.includes('TIME')) return 'TIMESTAMP';

  return 'VARCHAR';
}
