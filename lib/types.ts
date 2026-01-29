/**
 * Core type definitions for the Spreadsheet Intelligence application
 */

// ============================================================================
// Cell & Sheet Types
// ============================================================================

/** Primitive cell value types */
export type CellValue = string | number | boolean | Date | null;

/** A single cell with optional formula */
export interface Cell {
  value: CellValue;
  formula?: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'empty';
}

/** Raw sheet data as 2D array */
export type SheetData = CellValue[][];

/** Column information */
export interface ColumnInfo {
  name: string;
  originalName: string;
  type: 'VARCHAR' | 'INTEGER' | 'DOUBLE' | 'BOOLEAN' | 'DATE' | 'TIMESTAMP';
  nullable: boolean;
  sampleValues: CellValue[];
}

/** Sheet type classification */
export type SheetType = 'table' | 'matrix' | 'unknown';

// ============================================================================
// Processed Sheet Types
// ============================================================================

/** Processed sheet with metadata */
export interface ProcessedSheet {
  name: string;
  originalName: string;
  sheetType: SheetType;
  headerRow: number;
  columns: ColumnInfo[];
  data: CellValue[][];
  rowCount: number;
  previewData: CellValue[][];
}

/** Complete processed workbook */
export interface ProcessedWorkbook {
  uploadId: string;
  fileName: string;
  sheets: ProcessedSheet[];
  relationships: Relationship[];
  createdAt: Date;
}

// ============================================================================
// Relationship Types
// ============================================================================

/** Foreign key relationship between tables */
export interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  confidence: number;
}

// ============================================================================
// Schema Types
// ============================================================================

/** Table schema for LLM context */
export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

/** Complete schema information */
export interface SchemaInfo {
  tables: TableSchema[];
  relationships: Relationship[];
}

// ============================================================================
// Query Types
// ============================================================================

/** Conversation entry for context */
export interface ConversationEntry {
  id: string;
  question: string;
  sql: string | null;
  answer: string;
  tablesUsed: string[];
  timestamp: Date;
  error?: string;
}

/** Query result */
export interface QueryResult {
  success: boolean;
  answer?: string;
  sql?: string;
  tablesUsed?: string[];
  resultPreview?: CellValue[][];
  columnNames?: string[];
  rowCount?: number;
  error?: string;
  assumptions?: string;
}

// ============================================================================
// Session Types
// ============================================================================

/** Session state */
export interface SessionState {
  uploadId: string;
  workbook: ProcessedWorkbook;
  schema: SchemaInfo;
  conversation: ConversationEntry[];
}

// ============================================================================
// API Types
// ============================================================================

/** Upload API response */
export interface UploadResponse {
  success: boolean;
  uploadId?: string;
  schema?: SchemaInfo;
  sheets?: Array<{
    name: string;
    sheetType: SheetType;
    rowCount: number;
    columns: ColumnInfo[];
    previewData: CellValue[][];
  }>;
  error?: string;
}

/** Query API request */
export interface QueryRequest {
  uploadId: string;
  question: string;
}

/** Query API response */
export interface QueryResponse {
  success: boolean;
  answer?: string;
  sql?: string;
  tablesUsed?: string[];
  resultPreview?: CellValue[][];
  columnNames?: string[];
  assumptions?: string;
  error?: string;
}
