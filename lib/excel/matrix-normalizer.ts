/**
 * Matrix sheet normalizer
 * Converts matrix/report-style sheets into queryable long format
 */

import type { CellValue, ColumnInfo } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface NormalizedMatrix {
  /** Column definitions for the normalized table */
  columns: ColumnInfo[];
  /** Normalized data rows */
  data: CellValue[][];
  /** Original period/measure headers that were unpivoted */
  originalHeaders: string[];
}

interface MatrixConfig {
  /** Number of label columns (typically 1-2) */
  labelColumnCount: number;
  /** Period/measure headers detected */
  periodHeaders: string[];
}

// ============================================================================
// Main Normalizer
// ============================================================================

/**
 * Normalize a matrix sheet into long format
 * 
 * Example transformation:
 * 
 * INPUT:
 * |       |          | Q1 Budget | Q2 Budget |
 * | SALES |          |           |           |
 * |       | Salaries | 180000    | 185000    |
 * 
 * OUTPUT:
 * | department | category | period    | amount |
 * | Sales      | Salaries | Q1 Budget | 180000 |
 * | Sales      | Salaries | Q2 Budget | 185000 |
 */
export function normalizeMatrix(
  data: CellValue[][],
  headerRow: number,
  config: MatrixConfig
): NormalizedMatrix {
  const headers = data[headerRow] || [];
  const dataRows = data.slice(headerRow + 1);

  // Identify period columns (columns with period-like headers)
  const periodColumns = identifyPeriodColumns(headers, config.labelColumnCount);

  if (periodColumns.length === 0) {
    // No period columns found, return as-is with basic structure
    return createBasicNormalization(data, headerRow);
  }

  // Build normalized rows
  const normalizedData: CellValue[][] = [];
  let currentSection: string | null = null;

  for (const row of dataRows) {
    // Check if this is a section marker row
    const sectionMarker = detectSectionMarker(row, config.labelColumnCount);
    if (sectionMarker) {
      currentSection = sectionMarker;
      continue;
    }

    // Skip empty rows and total rows
    if (isEmptyRow(row) || isTotalRow(row)) {
      continue;
    }

    // Get label values
    const labels = extractLabels(row, config.labelColumnCount);
    if (!labels.some((l) => l !== null && l !== '')) {
      continue;
    }

    // Create one row per period column
    for (const periodCol of periodColumns) {
      const value = row[periodCol.index];

      // Skip if value is null/empty
      if (value === null || value === '' || value === undefined) {
        continue;
      }

      const normalizedRow: CellValue[] = [];

      // Add section/department if detected
      if (currentSection) {
        normalizedRow.push(formatSectionName(currentSection));
      }

      // Add labels
      for (const label of labels) {
        normalizedRow.push(label);
      }

      // Add period name
      normalizedRow.push(periodCol.header);

      // Add value
      normalizedRow.push(value);

      normalizedData.push(normalizedRow);
    }
  }

  // Build column definitions
  const columns = buildNormalizedColumns(
    currentSection !== null,
    config.labelColumnCount,
    headers
  );

  return {
    columns,
    data: normalizedData,
    originalHeaders: periodColumns.map((p) => p.header),
  };
}

// ============================================================================
// Period Column Detection
// ============================================================================

interface PeriodColumn {
  index: number;
  header: string;
}

/**
 * Identify columns that contain period/measure data
 */
function identifyPeriodColumns(
  headers: CellValue[],
  skipColumns: number
): PeriodColumn[] {
  const periodColumns: PeriodColumn[] = [];

  // Period patterns to match
  const patterns = [
    /^Q[1-4]\b/i,
    /\bQ[1-4]\b/i,
    /^H[1-2]\b/i,
    /\bH[1-2]\b/i,
    /budget/i,
    /actual/i,
    /forecast/i,
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
    /^\d{4}$/,
    /^FY\d{2,4}/i,
  ];

  // Skip "Total" columns as they're computed
  const skipPatterns = [/^total$/i, /^grand\s+total$/i];

  for (let i = skipColumns; i < headers.length; i++) {
    const header = headers[i];
    if (typeof header !== 'string' || header === '') continue;

    // Check if it should be skipped
    if (skipPatterns.some((p) => p.test(header.trim()))) {
      continue;
    }

    // Check if it matches a period pattern
    if (patterns.some((p) => p.test(header.trim()))) {
      periodColumns.push({ index: i, header: header.trim() });
    }
  }

  return periodColumns;
}

// ============================================================================
// Row Processing
// ============================================================================

/**
 * Detect if a row is a section marker (like "SALES" or "MARKETING")
 */
function detectSectionMarker(
  row: CellValue[],
  labelColumnCount: number
): string | null {
  const firstCell = row[0];

  // Section marker is typically in first cell only
  if (typeof firstCell !== 'string' || firstCell === '') {
    return null;
  }

  // Check if it's all caps (common for section markers)
  if (/^[A-Z\s]{2,}$/.test(firstCell.trim())) {
    // Make sure other cells in label area are empty
    const otherLabelCells = row.slice(1, labelColumnCount);
    const allEmpty = otherLabelCells.every(
      (cell) => cell === null || cell === ''
    );

    if (allEmpty) {
      return firstCell.trim();
    }
  }

  return null;
}

/**
 * Check if a row is empty
 */
function isEmptyRow(row: CellValue[]): boolean {
  return row.every((cell) => cell === null || cell === '');
}

/**
 * Check if a row is a total/subtotal row
 */
function isTotalRow(row: CellValue[]): boolean {
  return row.some(
    (cell) =>
      typeof cell === 'string' && /\b(total|subtotal)\b/i.test(cell)
  );
}

/**
 * Extract label values from a row
 */
function extractLabels(row: CellValue[], labelColumnCount: number): CellValue[] {
  const labels: CellValue[] = [];

  for (let i = 0; i < labelColumnCount; i++) {
    const value = row[i];
    // Use the last non-empty label found
    if (value !== null && value !== '') {
      labels.push(value);
    } else if (i === 0) {
      // First column empty - might need to use previous section
      labels.push(null);
    }
  }

  // Filter to get actual labels (remove leading nulls if second col has value)
  if (labels.length === 2 && labels[0] === null && labels[1] !== null) {
    return [labels[1]];
  }

  return labels.filter((l) => l !== null && l !== '');
}

/**
 * Format section name for consistency
 */
function formatSectionName(name: string): string {
  // Convert "SALES" to "Sales"
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

// ============================================================================
// Column Building
// ============================================================================

/**
 * Build column definitions for normalized table
 */
function buildNormalizedColumns(
  hasSection: boolean,
  labelColumnCount: number,
  originalHeaders: CellValue[]
): ColumnInfo[] {
  const columns: ColumnInfo[] = [];

  // Department/Section column (if detected)
  if (hasSection) {
    columns.push({
      name: 'department',
      originalName: 'Department',
      type: 'VARCHAR',
      nullable: false,
      sampleValues: [],
    });
  }

  // Category column (from label columns)
  columns.push({
    name: 'category',
    originalName: 'Category',
    type: 'VARCHAR',
    nullable: false,
    sampleValues: [],
  });

  // Period column
  columns.push({
    name: 'period',
    originalName: 'Period',
    type: 'VARCHAR',
    nullable: false,
    sampleValues: [],
  });

  // Amount/Value column
  columns.push({
    name: 'amount',
    originalName: 'Amount',
    type: 'DOUBLE',
    nullable: true,
    sampleValues: [],
  });

  return columns;
}

/**
 * Create basic normalization when no period columns detected
 */
function createBasicNormalization(
  data: CellValue[][],
  headerRow: number
): NormalizedMatrix {
  const headers = data[headerRow] || [];
  const dataRows = data.slice(headerRow + 1);

  const columns: ColumnInfo[] = headers
    .filter((h) => h !== null && h !== '')
    .map((h, i) => ({
      name: sanitizeName(String(h)),
      originalName: String(h),
      type: 'VARCHAR' as const,
      nullable: true,
      sampleValues: [],
    }));

  return {
    columns,
    data: dataRows,
    originalHeaders: [],
  };
}

/**
 * Sanitize a name for SQL
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .substring(0, 64);
}
