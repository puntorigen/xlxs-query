/**
 * Matrix sheet normalizer
 * Converts matrix/report-style sheets into queryable long format
 * 
 * Example transformation:
 * 
 * INPUT:
 * |           |          | Q1 Budget | Q2 Budget | H1 Total |
 * | SALES     |          |           |           |          |
 * |           | Salaries | 180000    | 185000    | 365000   |
 * |           | Travel   | 25000     | 30000     | 55000    |
 * | Sales Tot |          | 220000    | 233000    | 453000   |
 * 
 * OUTPUT:
 * | department | category | period    | amount |
 * | Sales      | Salaries | Q1 Budget | 180000 |
 * | Sales      | Salaries | Q2 Budget | 185000 |
 * | Sales      | Travel   | Q1 Budget | 25000  |
 * | Sales      | Travel   | Q2 Budget | 30000  |
 */

import type { CellValue, ColumnInfo } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface NormalizedMatrix {
  columns: ColumnInfo[];
  data: CellValue[][];
  originalHeaders: string[];
}

export interface MatrixConfig {
  /** The row index containing period headers */
  periodHeaderRow: number;
  /** Period headers detected */
  periodHeaders: string[];
  /** Number of label columns (typically 2: department, category) */
  labelColumnCount: number;
}

// ============================================================================
// Main Normalizer
// ============================================================================

/**
 * Normalize a matrix sheet into long format
 */
export function normalizeMatrix(
  data: CellValue[][],
  config: MatrixConfig
): NormalizedMatrix {
  const { periodHeaderRow, periodHeaders } = config;

  // Get the header row
  const headerRow = data[periodHeaderRow] || [];
  
  // Find period columns (columns with period headers)
  const periodColumns = findPeriodColumns(headerRow, periodHeaders);

  if (periodColumns.length === 0) {
    // Fall back to basic extraction
    return createBasicNormalization(data, periodHeaderRow);
  }

  // Process data rows into normalized format
  const normalizedData: CellValue[][] = [];
  let currentDepartment: string | null = null;

  // Start processing from row after header
  for (let rowIdx = periodHeaderRow + 1; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    
    // Skip empty rows
    if (isEmptyRow(row)) continue;

    // Check if this is a section marker row (department header)
    const sectionMarker = detectSectionMarker(row);
    if (sectionMarker) {
      currentDepartment = formatDepartmentName(sectionMarker);
      continue;
    }

    // Skip total/subtotal rows
    if (isTotalRow(row)) continue;

    // Get the category (usually in column B, index 1)
    const category = findCategory(row);
    if (!category) continue;

    // Create one row per period column
    for (const periodCol of periodColumns) {
      const value = row[periodCol.index];
      
      // Skip empty/null values
      if (value === null || value === undefined || value === '') continue;
      
      // Skip non-numeric values in what should be numeric columns
      if (typeof value !== 'number') continue;

      const normalizedRow: CellValue[] = [
        currentDepartment || 'Unknown',
        category,
        periodCol.header,
        value,
      ];

      normalizedData.push(normalizedRow);
    }
  }

  // Build column definitions
  const columns: ColumnInfo[] = [
    {
      name: 'department',
      originalName: 'Department',
      type: 'VARCHAR',
      nullable: false,
      sampleValues: [],
    },
    {
      name: 'category',
      originalName: 'Category',
      type: 'VARCHAR',
      nullable: false,
      sampleValues: [],
    },
    {
      name: 'period',
      originalName: 'Period',
      type: 'VARCHAR',
      nullable: false,
      sampleValues: [],
    },
    {
      name: 'amount',
      originalName: 'Amount',
      type: 'DOUBLE',
      nullable: false,
      sampleValues: [],
    },
  ];

  return {
    columns,
    data: normalizedData,
    originalHeaders: periodColumns.map(p => p.header),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

interface PeriodColumn {
  index: number;
  header: string;
}

/**
 * Find columns that contain period data
 */
function findPeriodColumns(headerRow: CellValue[], periodHeaders: string[]): PeriodColumn[] {
  const columns: PeriodColumn[] = [];
  
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i];
    if (typeof cell === 'string' && cell.trim() !== '') {
      // Check if this header is in our detected period headers
      // or matches common patterns (but skip "Total" columns)
      if (periodHeaders.includes(cell) || 
          (isPeriodLikeHeader(cell) && !isTotalHeader(cell))) {
        columns.push({ index: i, header: cell.trim() });
      }
    }
  }
  
  return columns;
}

/**
 * Check if header looks like a period header
 */
function isPeriodLikeHeader(header: string): boolean {
  const patterns = [
    /^Q[1-4]/i,
    /^H[1-2]/i,
    /budget/i,
    /actual/i,
    /forecast/i,
  ];
  return patterns.some(p => p.test(header));
}

/**
 * Check if header is a "Total" header (to skip)
 */
function isTotalHeader(header: string): boolean {
  return /\btotal\b/i.test(header);
}

/**
 * Check if row is empty
 */
function isEmptyRow(row: CellValue[]): boolean {
  return row.every(cell => cell === null || cell === undefined || cell === '');
}

/**
 * Detect if row is a section marker (department header)
 * Returns the section name or null
 */
function detectSectionMarker(row: CellValue[]): string | null {
  const firstCell = row[0];
  
  // Section marker should be in first column and:
  // - All caps (SALES, MARKETING)
  // - Or other cells in the row are mostly empty
  if (typeof firstCell !== 'string' || firstCell.trim() === '') {
    return null;
  }

  const trimmed = firstCell.trim();
  
  // Check if it's all caps (common pattern for section markers)
  if (/^[A-Z\s]{2,}$/.test(trimmed) && !trimmed.includes('TOTAL')) {
    // Verify other cells are mostly empty (not a data row)
    const otherCells = row.slice(1);
    const nonEmptyCount = otherCells.filter(c => c !== null && c !== undefined && c !== '').length;
    
    if (nonEmptyCount <= 1) {
      return trimmed;
    }
  }

  return null;
}

/**
 * Check if row is a total/subtotal row
 */
function isTotalRow(row: CellValue[]): boolean {
  return row.some(cell => 
    typeof cell === 'string' && /\btotal\b/i.test(cell)
  );
}

/**
 * Find the category value in a row (typically column B)
 */
function findCategory(row: CellValue[]): string | null {
  // Try column B first (index 1)
  if (row[1] && typeof row[1] === 'string' && row[1].trim() !== '') {
    return row[1].trim();
  }
  
  // Fall back to first non-empty string
  for (let i = 0; i < Math.min(3, row.length); i++) {
    const cell = row[i];
    if (typeof cell === 'string' && cell.trim() !== '') {
      return cell.trim();
    }
  }
  
  return null;
}

/**
 * Format department name (SALES -> Sales)
 */
function formatDepartmentName(name: string): string {
  if (/^[A-Z\s]+$/.test(name)) {
    return name.charAt(0) + name.slice(1).toLowerCase();
  }
  return name;
}

/**
 * Create basic normalization when pattern detection fails
 */
function createBasicNormalization(
  data: CellValue[][],
  headerRow: number
): NormalizedMatrix {
  const headers = data[headerRow] || [];
  const dataRows = data.slice(headerRow + 1);

  const columns: ColumnInfo[] = headers
    .filter((h, i) => h !== null && h !== '')
    .map((h) => ({
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
 * Sanitize name for SQL
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .substring(0, 64);
}
