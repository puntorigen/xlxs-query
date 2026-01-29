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
}

// ============================================================================
// Configuration
// ============================================================================

/** Common period/time patterns in headers */
const PERIOD_PATTERNS = [
  /^Q[1-4]\b/i, // Q1, Q2, Q3, Q4
  /^H[1-2]\b/i, // H1, H2
  /\bQ[1-4]\b/i, // Contains Q1-Q4
  /\bH[1-2]\b/i, // Contains H1, H2
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i, // Month names
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  /^\d{4}$/, // Year like 2024
  /^FY\d{2,4}/i, // Fiscal year
  /budget/i, // Budget column
  /actual/i, // Actual column
  /forecast/i, // Forecast column
  /total/i, // Total column (in matrix context)
];

/** Department/section markers (typically all caps or specific patterns) */
const SECTION_MARKER_PATTERNS = [
  /^[A-Z]{2,}$/, // All caps words (SALES, MARKETING)
  /^[A-Z][a-z]+\s+Department$/i, // "Sales Department"
  /^Department:/i, // "Department: Sales"
];

// ============================================================================
// Main Classifier
// ============================================================================

/**
 * Classify a sheet as table or matrix format
 */
export function classifySheet(
  data: CellValue[][],
  headerRow: number
): ClassificationResult {
  if (data.length === 0) {
    return { sheetType: 'unknown', confidence: 0 };
  }

  // Get header row and data below
  const headers = data[headerRow] || [];
  const dataRows = data.slice(headerRow + 1);

  // Check for matrix characteristics
  const matrixScore = scoreAsMatrix(headers, dataRows, data, headerRow);
  const tableScore = scoreAsTable(headers, dataRows);

  // Determine classification
  if (matrixScore.score > tableScore.score && matrixScore.score > 20) {
    return {
      sheetType: 'matrix',
      confidence: Math.min(100, matrixScore.score * 2),
      periodHeaders: matrixScore.periodHeaders,
      labelColumnCount: matrixScore.labelColumnCount,
    };
  }

  if (tableScore.score > 10) {
    return {
      sheetType: 'table',
      confidence: Math.min(100, tableScore.score * 3),
    };
  }

  return { sheetType: 'unknown', confidence: 0 };
}

// ============================================================================
// Matrix Scoring
// ============================================================================

interface MatrixScoreResult {
  score: number;
  periodHeaders: string[];
  labelColumnCount: number;
}

/**
 * Score how well the sheet matches matrix/report format
 */
function scoreAsMatrix(
  headers: CellValue[],
  dataRows: CellValue[][],
  allData: CellValue[][],
  headerRow: number
): MatrixScoreResult {
  let score = 0;
  const periodHeaders: string[] = [];
  let labelColumnCount = 0;

  // 1. Check for period-like headers
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (typeof header === 'string' && isPeriodHeader(header)) {
      score += 5;
      periodHeaders.push(header);
    }
  }

  // Multiple period headers is strong indicator
  if (periodHeaders.length >= 2) {
    score += 10;
  }

  // 2. Check for sparse first column (section markers pattern)
  const firstColumnValues = dataRows.map((row) => row[0]);
  const sectionMarkers = countSectionMarkers(firstColumnValues);
  if (sectionMarkers > 0 && sectionMarkers < dataRows.length * 0.3) {
    score += 10;
    labelColumnCount = 1;
  }

  // 3. Check second column for labels (if first column has markers)
  if (labelColumnCount === 1) {
    const secondColumnValues = dataRows.map((row) => row[1]);
    const nonEmptySecond = secondColumnValues.filter(
      (v) => v !== null && v !== ''
    ).length;
    if (nonEmptySecond > dataRows.length * 0.6) {
      labelColumnCount = 2;
      score += 5;
    }
  }

  // 4. Check for numeric columns after label columns
  const numericColumnCount = countNumericColumns(headers, dataRows, labelColumnCount);
  if (numericColumnCount >= 2) {
    score += 5;
  }

  // 5. Check for "Total" rows
  const hasTotalRows = dataRows.some((row) =>
    row.some(
      (cell) =>
        typeof cell === 'string' && /\b(total|subtotal)\b/i.test(cell)
    )
  );
  if (hasTotalRows) {
    score += 5;
  }

  // 6. Check if header row is not the first row (common in matrix sheets)
  if (headerRow >= 2) {
    score += 3;
  }

  return { score, periodHeaders, labelColumnCount: labelColumnCount || 1 };
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a header looks like a period/time header
 */
function isPeriodHeader(header: string): boolean {
  return PERIOD_PATTERNS.some((pattern) => pattern.test(header.trim()));
}

/**
 * Count section markers in first column
 */
function countSectionMarkers(values: CellValue[]): number {
  return values.filter((value) => {
    if (typeof value !== 'string' || value === '') return false;
    return SECTION_MARKER_PATTERNS.some((pattern) => pattern.test(value));
  }).length;
}

/**
 * Count columns that are predominantly numeric
 */
function countNumericColumns(
  headers: CellValue[],
  dataRows: CellValue[][],
  skipColumns: number
): number {
  let count = 0;

  for (let col = skipColumns; col < headers.length; col++) {
    const columnValues = dataRows.map((row) => row[col]);
    const numericCount = columnValues.filter(
      (v) => typeof v === 'number'
    ).length;

    if (numericCount > columnValues.length * 0.5) {
      count++;
    }
  }

  return count;
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
