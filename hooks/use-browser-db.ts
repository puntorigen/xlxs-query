/**
 * React hook for managing browser-side DuckDB-WASM
 * Handles initialization, data loading, and query execution
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  CellValue,
  ColumnInfo,
  SchemaInfo,
  ConversationEntry,
  ProcessedSheet,
  SqlGenerationRequest,
  SqlGenerationResponse,
  AnswerGenerationRequest,
  AnswerGenerationResponse,
} from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

interface QueryResult {
  success: boolean;
  answer?: string;
  sql?: string;
  tablesUsed?: string[];
  resultPreview?: CellValue[][];
  columnNames?: string[];
  error?: string;
  assumptions?: string;
}

interface BrowserDbState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
}

interface SheetLoadData {
  name: string;
  columns: ColumnInfo[];
  data: CellValue[][];
}

// We'll import duckdb-wasm dynamically to avoid SSR issues
type DuckDB = typeof import('@duckdb/duckdb-wasm');
type AsyncDuckDB = import('@duckdb/duckdb-wasm').AsyncDuckDB;
type AsyncDuckDBConnection = import('@duckdb/duckdb-wasm').AsyncDuckDBConnection;

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAY = 500;

// ============================================================================
// Hook
// ============================================================================

export function useBrowserDb() {
  const [state, setState] = useState<BrowserDbState>({
    isInitialized: false,
    isLoading: false,
    error: null,
  });

  const dbRef = useRef<AsyncDuckDB | null>(null);
  const connRef = useRef<AsyncDuckDBConnection | null>(null);
  const schemaRef = useRef<SchemaInfo | null>(null);
  const conversationRef = useRef<ConversationEntry[]>([]);

  /**
   * Initialize DuckDB-WASM in the browser
   */
  const initialize = useCallback(async () => {
    if (state.isInitialized || state.isLoading) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Dynamic import to avoid SSR issues
      const duckdb: DuckDB = await import('@duckdb/duckdb-wasm');

      console.log('[BrowserDB] Initializing DuckDB-WASM...');

      // Use CDN bundles
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      // Create Web Worker
      const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {
          type: 'text/javascript',
        })
      );

      const worker = new Worker(worker_url);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);

      // Instantiate database
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(worker_url);

      // Create connection
      const conn = await db.connect();

      dbRef.current = db;
      connRef.current = conn;

      setState({ isInitialized: true, isLoading: false, error: null });
      console.log('[BrowserDB] Initialized successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Initialization failed';
      console.error('[BrowserDB] Initialization error:', error);
      setState({ isInitialized: false, isLoading: false, error: message });
    }
  }, [state.isInitialized, state.isLoading]);

  /**
   * Load sheets into the database
   */
  const loadSheets = useCallback(
    async (sheets: SheetLoadData[], schema: SchemaInfo) => {
      if (!connRef.current) {
        throw new Error('Database not initialized');
      }

      console.log('[BrowserDB] Loading sheets...');
      const conn = connRef.current;

      // Drop any existing tables
      const existingTables = await getTableNames();
      for (const table of existingTables) {
        await conn.query(`DROP TABLE IF EXISTS "${table}"`);
      }

      // Load each sheet
      for (const sheet of sheets) {
        if (sheet.columns.length === 0 || sheet.data.length === 0) {
          console.log(`[BrowserDB] Skipping empty sheet: ${sheet.name}`);
          continue;
        }

        // Create table
        const columnDefs = sheet.columns
          .map((col) => `"${col.name}" ${col.type}`)
          .join(',\n  ');
        const createSql = `CREATE TABLE "${sheet.name}" (\n  ${columnDefs}\n)`;
        await conn.query(createSql);
        console.log(`[BrowserDB] Created table: ${sheet.name}`);

        // Insert data in batches
        const BATCH_SIZE = 100;
        for (let i = 0; i < sheet.data.length; i += BATCH_SIZE) {
          const batch = sheet.data.slice(i, i + BATCH_SIZE);
          const columnNames = sheet.columns.map((c) => `"${c.name}"`).join(', ');

          const valuesClauses = batch.map((row) => {
            const values = sheet.columns.map((col, colIdx) => {
              const value = colIdx < row.length ? row[colIdx] : null;
              return formatValueForSql(value, col.type);
            });
            return `(${values.join(', ')})`;
          });

          const insertSql = `INSERT INTO "${sheet.name}" (${columnNames}) VALUES ${valuesClauses.join(', ')}`;
          await conn.query(insertSql);
        }
        console.log(`[BrowserDB] Inserted ${sheet.data.length} rows into ${sheet.name}`);
      }

      // Store schema
      schemaRef.current = schema;
      // Reset conversation
      conversationRef.current = [];

      console.log('[BrowserDB] All sheets loaded');
    },
    []
  );

  /**
   * Execute a SQL query
   */
  const executeSql = useCallback(async (sql: string) => {
    if (!connRef.current) {
      throw new Error('Database not initialized');
    }

    const result = await connRef.current.query(sql);
    const columns = result.schema.fields.map((f) => f.name);

    // Convert Arrow result to array of arrays
    const rows: CellValue[][] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row: CellValue[] = [];
      for (let j = 0; j < columns.length; j++) {
        const value = result.getChildAt(j)?.get(i);
        row.push(convertValue(value));
      }
      rows.push(row);
    }

    return {
      columns,
      rows,
      rowCount: result.numRows,
    };
  }, []);

  /**
   * Get list of table names
   */
  const getTableNames = useCallback(async (): Promise<string[]> => {
    if (!connRef.current) return [];
    const result = await connRef.current.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    );
    const names: string[] = [];
    for (let i = 0; i < result.numRows; i++) {
      const value = result.getChildAt(0)?.get(i);
      if (value) names.push(String(value));
    }
    return names;
  }, []);

  /**
   * Execute a natural language query
   */
  const executeQuery = useCallback(
    async (question: string): Promise<QueryResult> => {
      if (!schemaRef.current) {
        return { success: false, error: 'No schema loaded' };
      }

      let lastSql: string | null = null;
      let lastError: string | null = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await sleep(RETRY_DELAY);
          console.log(`[BrowserDB] Retry attempt ${attempt + 1}/${MAX_RETRIES}`);
        }

        try {
          // Step 1: Generate SQL via API
          const sqlRequest: SqlGenerationRequest = {
            question,
            schema: schemaRef.current,
            conversationHistory: conversationRef.current,
            previousSql: lastSql || undefined,
            previousError: lastError || undefined,
          };

          const sqlResponse = await fetch('/api/sql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sqlRequest),
          });

          const sqlResult: SqlGenerationResponse = await sqlResponse.json();

          if (!sqlResult.success || !sqlResult.sql) {
            lastError = sqlResult.error || 'Could not generate SQL';
            continue;
          }

          lastSql = sqlResult.sql;

          // Step 2: Execute SQL in browser DuckDB
          const queryResult = await executeSql(sqlResult.sql);

          // Step 3: Generate natural language answer via API
          const answerRequest: AnswerGenerationRequest = {
            question,
            columns: queryResult.columns,
            rows: queryResult.rows,
            rowCount: queryResult.rowCount,
          };

          const answerResponse = await fetch('/api/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(answerRequest),
          });

          const answerResult: AnswerGenerationResponse = await answerResponse.json();

          const answer = answerResult.success
            ? answerResult.answer || 'No answer generated'
            : 'Could not generate answer';

          // Step 4: Add to conversation history
          const entry: ConversationEntry = {
            id: crypto.randomUUID(),
            question,
            sql: sqlResult.sql,
            answer,
            tablesUsed: sqlResult.tablesUsed || [],
            timestamp: new Date(),
          };
          conversationRef.current = [...conversationRef.current, entry];

          return {
            success: true,
            answer,
            sql: sqlResult.sql,
            tablesUsed: sqlResult.tablesUsed,
            resultPreview: queryResult.rows.slice(0, 100),
            columnNames: queryResult.columns,
            assumptions: sqlResult.assumptions,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[BrowserDB] Attempt ${attempt + 1} failed:`, lastError);
        }
      }

      // Add failed entry to conversation
      const failedEntry: ConversationEntry = {
        id: crypto.randomUUID(),
        question,
        sql: lastSql,
        answer: simplifyError(lastError),
        tablesUsed: [],
        timestamp: new Date(),
        error: lastError || undefined,
      };
      conversationRef.current = [...conversationRef.current, failedEntry];

      return {
        success: false,
        error: simplifyError(lastError),
        sql: lastSql || undefined,
      };
    },
    [executeSql]
  );

  /**
   * Reset the database (clear all data)
   */
  const reset = useCallback(async () => {
    schemaRef.current = null;
    conversationRef.current = [];

    if (connRef.current) {
      const tables = await getTableNames();
      for (const table of tables) {
        await connRef.current.query(`DROP TABLE IF EXISTS "${table}"`);
      }
    }
  }, [getTableNames]);

  /**
   * Close and clean up
   */
  const close = useCallback(async () => {
    if (connRef.current) {
      await connRef.current.close();
      connRef.current = null;
    }
    if (dbRef.current) {
      await dbRef.current.terminate();
      dbRef.current = null;
    }
    schemaRef.current = null;
    conversationRef.current = [];
    setState({ isInitialized: false, isLoading: false, error: null });
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  return {
    ...state,
    initialize,
    loadSheets,
    executeQuery,
    reset,
    close,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

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
      return `'${escapeSqlString(String(value))}'`;
  }
}

function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

function convertValue(value: unknown): CellValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'bigint') {
    if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
      return Number(value);
    }
    return value.toString();
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return String(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simplifyError(error: string | null): string {
  if (!error) {
    return 'An unexpected error occurred. Please try rephrasing your question.';
  }

  if (error.includes('does not exist')) {
    const match = error.match(/Table with name (\w+) does not exist/);
    if (match) {
      return `Table "${match[1]}" was not found.`;
    }
    const colMatch = error.match(/column "(\w+)" not found/i);
    if (colMatch) {
      return `Column "${colMatch[1]}" was not found.`;
    }
  }

  if (error.includes('syntax error')) {
    return 'There was a syntax error in the generated query. Please try rephrasing.';
  }

  return 'Could not execute the query. Please try rephrasing your question.';
}
