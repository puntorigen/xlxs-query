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
      const rawRows = reader.getRows();
      
      // Convert BigInt values to numbers (DuckDB returns BigInt for COUNT, SUM, etc.)
      const rows = rawRows.map((row) =>
        (row as CellValue[]).map((cell) => convertBigInt(cell))
      );

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
 * Insert data into a table using batch INSERT statements
 */
async function insertData(
  conn: any,
  tableName: string,
  columns: ColumnInfo[],
  data: CellValue[][]
): Promise<void> {
  if (data.length === 0) return;

  const columnNames = columns.map((c) => `"${c.name}"`).join(', ');
  
  // Insert in batches of 100 rows for efficiency
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    
    // Build VALUES clauses for batch
    const valuesClauses = batch.map((row) => {
      const values = columns.map((col, colIdx) => {
        const value = colIdx < row.length ? row[colIdx] : null;
        return formatValueForSql(value, col.type);
      });
      return `(${values.join(', ')})`;
    });
    
    const insertSql = `INSERT INTO "${tableName}" (${columnNames}) VALUES ${valuesClauses.join(', ')}`;
    await conn.run(insertSql);
  }
}

/**
 * Format a value for SQL INSERT statement
 */
function formatValueForSql(value: CellValue, colType: string): string {
  if (value === null || value === undefined || value === '') {
    return 'NULL';
  }

  switch (colType) {
    case 'INTEGER':
      const intVal = Number(value);
      return isNaN(intVal) ? 'NULL' : String(Math.round(intVal));
    
    case 'DOUBLE':
      const numVal = Number(value);
      return isNaN(numVal) ? 'NULL' : String(numVal);
    
    case 'BOOLEAN':
      return value ? 'TRUE' : 'FALSE';
    
    case 'DATE':
    case 'TIMESTAMP':
      if (value instanceof Date) {
        return `'${value.toISOString().split('T')[0]}'`;
      }
      return `'${escapeSqlString(String(value))}'`;
    
    default:
      // VARCHAR - escape single quotes
      return `'${escapeSqlString(String(value))}'`;
  }
}

/**
 * Escape single quotes in SQL strings
 */
function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Convert BigInt values to numbers (DuckDB returns BigInt for aggregations)
 * JSON.stringify can't handle BigInt, so we need to convert
 */
function convertBigInt(value: unknown): CellValue {
  if (typeof value === 'bigint') {
    // Check if value fits in a safe integer range
    if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
      return Number(value);
    }
    // For very large numbers, convert to string to preserve precision
    return value.toString();
  }
  return value as CellValue;
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
