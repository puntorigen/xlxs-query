/**
 * Sheet type classification
 * Determines if a sheet is a regular table or a matrix/report format
 */

import type { CellValue, SheetType } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface ClassificationResult {
  sheetType: SheetType;
  confidence: number;
  /** For matrix sheets: detected period headers */
  periodHeaders?: string[];
  /** For matrix sheets: detected label columns count */
  labelColumnCount?: number;
  /** For matrix sheets: the row index containing period headers */
  periodHeaderRow?: number;
}

// ============================================================================
// Configuration
// ============================================================================

/** Common period/time patterns in headers */
const PERIOD_PATTERNS = [
  /^Q[1-4]\s/i, // Q1 , Q2 , etc.
  /^Q[1-4]$/i, // Q1, Q2, etc.
  /^H[1-2]\s/i, // H1 , H2
  /^H[1-2]$/i, // H1, H2
  /\bQ[1-4]\b/i, // Contains Q1-Q4
  /\bH[1-2]\b/i, // Contains H1, H2
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i,
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  /^\d{4}$/, // Year like 2024
  /^FY\d{2,4}/i, // Fiscal year
  /budget/i, // Budget column
  /actual/i, // Actual column
  /forecast/i, // Forecast column
];

/** Department/section markers (typically all caps) */
const SECTION_MARKER_PATTERNS = [
  /^[A-Z]{2,}$/, // All caps words (SALES, MARKETING)
  /^[A-Z][a-z]+\s+Total$/i, // "Sales Total"
];

// ============================================================================
// Main Classifier
// ============================================================================

/**
 * Classify a sheet as table or matrix format
 * This version scans for matrix patterns BEFORE relying on header detection
 */
export function classifySheet(
  data: CellValue[][],
  suggestedHeaderRow: number
): ClassificationResult {
  if (data.length === 0) {
    return { sheetType: 'unknown', confidence: 0 };
  }

  // First: Check if this looks like a matrix by scanning for period headers
  const matrixScan = scanForMatrixPattern(data);
  
  if (matrixScan.isMatrix && matrixScan.confidence > 60) {
    return {
      sheetType: 'matrix',
      confidence: matrixScan.confidence,
      periodHeaders: matrixScan.periodHeaders,
      labelColumnCount: matrixScan.labelColumnCount,
      periodHeaderRow: matrixScan.headerRow,
    };
  }

  // Fall back to standard classification using suggested header
  const headers = data[suggestedHeaderRow] || [];
  const dataRows = data.slice(suggestedHeaderRow + 1);

  const tableScore = scoreAsTable(headers, dataRows);

  if (tableScore.score > 10) {
    return {
      sheetType: 'table',
      confidence: Math.min(100, tableScore.score * 3),
    };
  }

  return { sheetType: 'unknown', confidence: 0 };
}

// ============================================================================
// Matrix Pattern Scanner
// ============================================================================

interface MatrixScanResult {
  isMatrix: boolean;
  confidence: number;
  headerRow: number;
  periodHeaders: string[];
  labelColumnCount: number;
}

/**
 * Scan sheet for matrix/report patterns
 * Looks for period headers and section markers
 */
function scanForMatrixPattern(data: CellValue[][]): MatrixScanResult {
  const result: MatrixScanResult = {
    isMatrix: false,
    confidence: 0,
    headerRow: 0,
    periodHeaders: [],
    labelColumnCount: 2,
  };

  // Scan first 10 rows for period-like headers
  const scanRows = Math.min(10, data.length);
  
  for (let rowIdx = 0; rowIdx < scanRows; rowIdx++) {
    const row = data[rowIdx];
    const periodCells: string[] = [];
    
    for (const cell of row) {
      if (typeof cell === 'string' && cell.trim() !== '') {
        if (isPeriodHeader(cell)) {
          periodCells.push(cell);
        }
      }
    }
    
    // If we found 2+ period headers in this row, likely a matrix
    if (periodCells.length >= 2) {
      result.headerRow = rowIdx;
      result.periodHeaders = periodCells;
      result.confidence += 40;
      break;
    }
  }

  // No period headers found
  if (result.periodHeaders.length === 0) {
    return result;
  }

  // Check for section markers in first column (after header row)
  const dataStartRow = result.headerRow + 1;
  let sectionMarkerCount = 0;
  let emptyFirstColumnCount = 0;
  
  for (let rowIdx = dataStartRow; rowIdx < Math.min(dataStartRow + 20, data.length); rowIdx++) {
    const row = data[rowIdx];
    const firstCell = row[0];
    
    if (firstCell === null || firstCell === '' || firstCell === undefined) {
      emptyFirstColumnCount++;
    } else if (typeof firstCell === 'string') {
      if (SECTION_MARKER_PATTERNS.some(p => p.test(firstCell))) {
        sectionMarkerCount++;
      }
    }
  }

  // Sparse first column with some section markers = matrix pattern
  const rowsChecked = Math.min(20, data.length - dataStartRow);
  if (rowsChecked > 0) {
    const emptyRatio = emptyFirstColumnCount / rowsChecked;
    if (emptyRatio > 0.5 && sectionMarkerCount >= 1) {
      result.confidence += 30;
    }
  }

  // Check for numeric values in columns after labels
  const numericColCount = countNumericColumnsInData(data, result.headerRow, 2);
  if (numericColCount >= 2) {
    result.confidence += 20;
  }

  result.isMatrix = result.confidence >= 50;
  return result;
}

/**
 * Check if a header looks like a period/time header
 */
function isPeriodHeader(header: string): boolean {
  return PERIOD_PATTERNS.some((pattern) => pattern.test(header.trim()));
}

/**
 * Count numeric columns in data portion
 */
function countNumericColumnsInData(
  data: CellValue[][],
  headerRow: number,
  skipColumns: number
): number {
  const dataRows = data.slice(headerRow + 1, headerRow + 11);
  if (dataRows.length === 0) return 0;

  const colCount = Math.max(...data.map(r => r.length));
  let numericCols = 0;

  for (let col = skipColumns; col < colCount; col++) {
    const values = dataRows.map(row => row[col]).filter(v => v !== null && v !== undefined);
    const numericCount = values.filter(v => typeof v === 'number').length;
    if (values.length > 0 && numericCount / values.length > 0.5) {
      numericCols++;
    }
  }

  return numericCols;
}

// ============================================================================
// Table Scoring
// ============================================================================

interface TableScoreResult {
  score: number;
}

/**
 * Score how well the sheet matches standard table format
 */
function scoreAsTable(headers: CellValue[], dataRows: CellValue[][]): TableScoreResult {
  let score = 0;

  // 1. Check for unique, descriptive headers
  const nonEmptyHeaders = headers.filter((h) => h !== null && h !== '');
  const uniqueHeaders = new Set(nonEmptyHeaders);

  if (uniqueHeaders.size === nonEmptyHeaders.length && nonEmptyHeaders.length >= 3) {
    score += 10;
  }

  // 2. Check for consistent data density across rows
  if (dataRows.length > 0) {
    const avgNonEmpty = dataRows.reduce((sum, row) => {
      return sum + row.filter((cell) => cell !== null && cell !== '').length;
    }, 0) / dataRows.length;

    if (avgNonEmpty >= nonEmptyHeaders.length * 0.7) {
      score += 10;
    }
  }

  // 3. Check for ID-like columns (common in tables)
  const hasIdColumn = headers.some(
    (h) =>
      typeof h === 'string' &&
      /\b(id|code|number|key)\b/i.test(h)
  );
  if (hasIdColumn) {
    score += 5;
  }

  // 4. Check for no sparse first column (unlike matrix)
  if (dataRows.length > 0) {
    const firstColumnFilled = dataRows.filter(
      (row) => row[0] !== null && row[0] !== ''
    ).length;
    if (firstColumnFilled > dataRows.length * 0.8) {
      score += 5;
    }
  }

  // 5. Check for varied data types across columns
  const columnTypes = analyzeColumnTypes(dataRows, headers.length);
  const uniqueTypes = new Set(columnTypes);
  if (uniqueTypes.size >= 2) {
    score += 5;
  }

  return { score };
}

/**
 * Analyze dominant type in each column
 */
function analyzeColumnTypes(
  dataRows: CellValue[][],
  columnCount: number
): string[] {
  const types: string[] = [];

  for (let col = 0; col < columnCount; col++) {
    const values = dataRows.map((row) => row[col]).filter((v) => v !== null);

    if (values.length === 0) {
      types.push('empty');
      continue;
    }

    const numericCount = values.filter((v) => typeof v === 'number').length;
    const stringCount = values.filter((v) => typeof v === 'string').length;

    if (numericCount > stringCount) {
      types.push('number');
    } else {
      types.push('string');
    }
  }

  return types;
}
