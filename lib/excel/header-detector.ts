/**
 * Header row detection for Excel sheets
 * Uses heuristics to find the most likely header row
 */

import type { CellValue, ColumnInfo } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface HeaderDetectionResult {
  /** Detected header row index (0-based) */
  headerRow: number;
  /** Confidence score (0-100) */
  confidence: number;
  /** Detected columns */
  columns: ColumnInfo[];
}

interface RowScore {
  row: number;
  score: number;
  reasons: string[];
}

// ============================================================================
// Configuration
// ============================================================================

/** Maximum rows to scan for headers */
const MAX_SCAN_ROWS = 25;

/** Minimum score to consider a row as header */
const MIN_CONFIDENCE_SCORE = 10;

// ============================================================================
// Main Detector
// ============================================================================

/**
 * Detect the header row in sheet data
 * Returns the best candidate row and extracted column information
 */
export function detectHeaderRow(data: CellValue[][]): HeaderDetectionResult {
  if (data.length === 0) {
    return { headerRow: 0, confidence: 0, columns: [] };
  }

  const rowsToScan = Math.min(data.length, MAX_SCAN_ROWS);
  const scores: RowScore[] = [];

  // Score each candidate row
  for (let i = 0; i < rowsToScan; i++) {
    const score = scoreRow(data, i);
    scores.push(score);
  }

  // Find best candidate
  const bestCandidate = scores.reduce((best, current) =>
    current.score > best.score ? current : best
  );

  // Extract columns from the best header row
  const columns = extractColumns(data, bestCandidate.row);

  // Calculate confidence as percentage of max possible score
  const maxPossibleScore = 25; // Rough estimate of max score
  const confidence = Math.min(
    100,
    Math.round((bestCandidate.score / maxPossibleScore) * 100)
  );

  return {
    headerRow: bestCandidate.row,
    confidence,
    columns,
  };
}

// ============================================================================
// Row Scoring
// ============================================================================

/**
 * Score a row as a potential header
 */
function scoreRow(data: CellValue[][], rowIndex: number): RowScore {
  const row = data[rowIndex];
  if (!row) {
    return { row: rowIndex, score: -100, reasons: ['Empty row'] };
  }

  let score = 0;
  const reasons: string[] = [];

  // Count non-empty cells
  const nonEmptyCells = row.filter((cell) => cell !== null && cell !== '').length;
  const totalCells = row.length;

  // 1. Reward rows with multiple non-empty cells
  if (nonEmptyCells >= 3) {
    score += nonEmptyCells * 2;
    reasons.push(`${nonEmptyCells} non-empty cells (+${nonEmptyCells * 2})`);
  }

  // 2. Penalize single-cell rows (likely titles)
  if (nonEmptyCells === 1 && totalCells > 1) {
    score -= 15;
    reasons.push('Single cell in row (likely title) (-15)');
  }

  // 3. Check if all non-empty cells are strings
  const stringCells = row.filter(
    (cell) => typeof cell === 'string' && cell !== ''
  ).length;
  if (stringCells === nonEmptyCells && nonEmptyCells > 0) {
    score += 5;
    reasons.push('All cells are strings (+5)');
  }

  // 4. Check for unique values (headers should be unique)
  const uniqueValues = new Set(
    row.filter((cell) => cell !== null && cell !== '')
  );
  if (uniqueValues.size === nonEmptyCells && nonEmptyCells > 1) {
    score += 3;
    reasons.push('All values unique (+3)');
  }

  // 5. Check if next row exists and has same column structure
  if (rowIndex < data.length - 1) {
    const nextRow = data[rowIndex + 1];
    const nextNonEmpty = nextRow?.filter(
      (cell) => cell !== null && cell !== ''
    ).length || 0;

    if (nextNonEmpty >= nonEmptyCells * 0.7 && nextNonEmpty > 0) {
      score += 2;
      reasons.push('Next row has similar structure (+2)');
    }

    // Check if data below contains different types (indicating data vs header)
    const hasNumericBelow = nextRow?.some(
      (cell) => typeof cell === 'number'
    );
    if (hasNumericBelow && stringCells === nonEmptyCells) {
      score += 3;
      reasons.push('Numeric data below string header (+3)');
    }
  }

  // 6. Penalize rows that look like totals or subtotals
  const hasTotal = row.some(
    (cell) =>
      typeof cell === 'string' &&
      /\b(total|subtotal|sum|grand)\b/i.test(cell)
  );
  if (hasTotal) {
    score -= 10;
    reasons.push('Contains "total" keyword (-10)');
  }

  // 7. Penalize very early rows (row 0-1 often titles)
  if (rowIndex === 0 && nonEmptyCells <= 2) {
    score -= 3;
    reasons.push('First row with few cells (-3)');
  }

  // 8. Bonus for typical header patterns
  const hasTypicalHeader = row.some(
    (cell) =>
      typeof cell === 'string' &&
      /\b(id|name|date|amount|price|quantity|category|type|status|region|department)\b/i.test(
        cell
      )
  );
  if (hasTypicalHeader) {
    score += 4;
    reasons.push('Contains typical header keywords (+4)');
  }

  return { row: rowIndex, score, reasons };
}

// ============================================================================
// Column Extraction
// ============================================================================

/**
 * Extract column information from detected header row
 */
function extractColumns(data: CellValue[][], headerRow: number): ColumnInfo[] {
  const headerRowData = data[headerRow];
  if (!headerRowData) return [];

  const columns: ColumnInfo[] = [];
  const dataRows = data.slice(headerRow + 1, headerRow + 101); // Sample up to 100 rows

  for (let colIndex = 0; colIndex < headerRowData.length; colIndex++) {
    const headerValue = headerRowData[colIndex];

    // Skip empty header cells
    if (headerValue === null || headerValue === '') {
      continue;
    }

    const originalName = String(headerValue);
    const sanitizedName = sanitizeColumnName(originalName);

    // Sample values from data rows
    const sampleValues: CellValue[] = [];
    for (const row of dataRows) {
      if (row[colIndex] !== null && row[colIndex] !== undefined) {
        sampleValues.push(row[colIndex]);
        if (sampleValues.length >= 5) break;
      }
    }

    // Infer column type
    const columnType = inferColumnType(dataRows, colIndex);

    columns.push({
      name: sanitizedName,
      originalName,
      type: columnType,
      nullable: checkNullable(dataRows, colIndex),
      sampleValues,
    });
  }

  return columns;
}

/**
 * Sanitize column name for SQL compatibility
 */
function sanitizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_') // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, '') // Trim leading/trailing underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .substring(0, 64); // Limit length
}

/**
 * Infer the SQL type for a column based on data samples
 */
function inferColumnType(
  dataRows: CellValue[][],
  colIndex: number
): ColumnInfo['type'] {
  const values: CellValue[] = [];

  for (const row of dataRows) {
    const value = row[colIndex];
    if (value !== null && value !== undefined && value !== '') {
      values.push(value);
      if (values.length >= 20) break; // Sample enough values
    }
  }

  if (values.length === 0) return 'VARCHAR';

  // Check types
  const typeCount = {
    number: 0,
    integer: 0,
    string: 0,
    boolean: 0,
    date: 0,
  };

  for (const value of values) {
    if (typeof value === 'boolean') {
      typeCount.boolean++;
    } else if (typeof value === 'number') {
      typeCount.number++;
      if (Number.isInteger(value)) {
        typeCount.integer++;
      }
    } else if (value instanceof Date) {
      typeCount.date++;
    } else if (typeof value === 'string') {
      // Check if string looks like a date
      if (isDateString(value)) {
        typeCount.date++;
      } else {
        typeCount.string++;
      }
    }
  }

  const total = values.length;
  const threshold = 0.7; // 70% of values should be this type

  if (typeCount.boolean / total >= threshold) return 'BOOLEAN';
  if (typeCount.date / total >= threshold) return 'DATE';
  if (typeCount.integer / total >= threshold && typeCount.integer === typeCount.number) {
    return 'INTEGER';
  }
  if (typeCount.number / total >= threshold) return 'DOUBLE';

  return 'VARCHAR';
}

/**
 * Check if a column contains nullable values
 */
function checkNullable(dataRows: CellValue[][], colIndex: number): boolean {
  for (const row of dataRows.slice(0, 50)) {
    const value = row[colIndex];
    if (value === null || value === undefined || value === '') {
      return true;
    }
  }
  return false;
}

/**
 * Check if a string looks like a date
 */
function isDateString(value: string): boolean {
  // Common date patterns
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
    /^\d{2}-\d{2}-\d{4}$/, // DD-MM-YYYY
    /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
  ];

  return datePatterns.some((pattern) => pattern.test(value));
}
