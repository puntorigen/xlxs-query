/**
 * Main Excel file processor
 * Orchestrates parsing, formula evaluation, header detection, and normalization
 */

import { parseExcelBuffer } from './parser';
import { evaluateFormulas } from './formula-evaluator';
import { detectHeaderRow } from './header-detector';
import { classifySheet } from './sheet-classifier';
import { normalizeMatrix } from './matrix-normalizer';
import type { ProcessedSheet, ProcessedWorkbook, CellValue } from '@/lib/types';
import { generateId } from '@/lib/utils';

// ============================================================================
// Configuration
// ============================================================================

/** Maximum rows to include in preview */
const MAX_PREVIEW_ROWS = 100;

// ============================================================================
// Main Processor
// ============================================================================

/**
 * Process an Excel file buffer into a structured workbook
 * 
 * Pipeline:
 * 1. Parse with SheetJS (extract formulas)
 * 2. Evaluate formulas with HyperFormula
 * 3. Detect header rows
 * 4. Classify sheets (table vs matrix)
 * 5. Normalize matrix sheets
 * 6. Return processed workbook
 */
export async function processExcelFile(
  buffer: ArrayBuffer,
  fileName: string
): Promise<ProcessedWorkbook> {
  // Step 1: Parse Excel file
  console.log('[Processor] Parsing Excel file...');
  const rawWorkbook = parseExcelBuffer(buffer);

  // Step 2: Evaluate all formulas
  console.log('[Processor] Evaluating formulas...');
  const evaluatedWorkbook = evaluateFormulas(rawWorkbook);

  // Step 3-5: Process each sheet
  console.log('[Processor] Processing sheets...');
  const processedSheets: ProcessedSheet[] = [];

  for (const sheet of evaluatedWorkbook.sheets) {
    const processedSheet = processSheet(sheet.name, sheet.data);
    processedSheets.push(processedSheet);
  }

  // Generate upload ID
  const uploadId = generateId();

  return {
    uploadId,
    fileName,
    sheets: processedSheets,
    relationships: [], // Will be populated by relationship detector
    createdAt: new Date(),
  };
}

/**
 * Process a single sheet
 */
function processSheet(name: string, data: CellValue[][]): ProcessedSheet {
  // Handle empty sheets
  if (data.length === 0) {
    return createEmptySheet(name);
  }

  // Step 3: Detect header row
  const headerDetection = detectHeaderRow(data);
  console.log(
    `[Processor] Sheet "${name}": Header row ${headerDetection.headerRow} (confidence: ${headerDetection.confidence}%)`
  );

  // Step 4: Classify sheet type
  const classification = classifySheet(data, headerDetection.headerRow);
  console.log(
    `[Processor] Sheet "${name}": Type "${classification.sheetType}" (confidence: ${classification.confidence}%)`
  );

  // Step 5: Normalize if matrix
  if (classification.sheetType === 'matrix') {
    return processMatrixSheet(name, data, headerDetection, classification);
  }

  // Process as regular table
  return processTableSheet(name, data, headerDetection);
}

/**
 * Process a regular table sheet
 */
function processTableSheet(
  name: string,
  data: CellValue[][],
  headerDetection: { headerRow: number; columns: any[] }
): ProcessedSheet {
  const { headerRow, columns } = headerDetection;

  // Extract data rows (after header)
  const dataRows = data.slice(headerRow + 1);

  // Create preview (first N rows including header)
  const previewData = [
    data[headerRow], // Header row
    ...dataRows.slice(0, MAX_PREVIEW_ROWS - 1),
  ];

  // Sanitize sheet name for SQL
  const sanitizedName = sanitizeTableName(name);

  return {
    name: sanitizedName,
    originalName: name,
    sheetType: 'table',
    headerRow,
    columns,
    data: dataRows,
    rowCount: dataRows.length,
    previewData,
  };
}

/**
 * Process a matrix/report sheet
 */
function processMatrixSheet(
  name: string,
  data: CellValue[][],
  headerDetection: { headerRow: number },
  classification: { 
    periodHeaders?: string[]; 
    labelColumnCount?: number;
    periodHeaderRow?: number;
  }
): ProcessedSheet {
  // Use periodHeaderRow from classifier if available, otherwise fall back to headerDetection
  const headerRow = classification.periodHeaderRow ?? headerDetection.headerRow;

  console.log(
    `[Processor] Matrix "${name}": Using header row ${headerRow}, periods: ${classification.periodHeaders?.join(', ')}`
  );

  // Store original preview data (for display in UI)
  const originalPreviewData = data.slice(0, MAX_PREVIEW_ROWS);

  // Normalize matrix to long format (for querying)
  const normalized = normalizeMatrix(data, {
    periodHeaderRow: headerRow,
    labelColumnCount: classification.labelColumnCount || 2,
    periodHeaders: classification.periodHeaders || [],
  });

  // Create normalized preview (for schema display)
  const headerRowData = normalized.columns.map((c) => c.originalName);
  const previewData = [
    headerRowData,
    ...normalized.data.slice(0, MAX_PREVIEW_ROWS - 1),
  ];

  // Sanitize sheet name
  const sanitizedName = sanitizeTableName(name);

  return {
    name: sanitizedName,
    originalName: name,
    sheetType: 'matrix',
    headerRow: 0, // Normalized data has header at row 0
    columns: normalized.columns,
    data: normalized.data,
    rowCount: normalized.data.length,
    previewData,
    originalPreviewData, // Keep original layout for display
  };
}

/**
 * Create an empty sheet placeholder
 */
function createEmptySheet(name: string): ProcessedSheet {
  return {
    name: sanitizeTableName(name),
    originalName: name,
    sheetType: 'unknown',
    headerRow: 0,
    columns: [],
    data: [],
    rowCount: 0,
    previewData: [],
  };
}

/**
 * Sanitize table name for SQL compatibility
 */
function sanitizeTableName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .replace(/^\d/, '_$&') // Prefix with _ if starts with digit
    .substring(0, 64);
}
