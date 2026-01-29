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
 * OUTPUT (with LLM-detected aggregates):
 * | department | category | period    | amount | is_aggregate |
 * | Sales      | Salaries | Q1 Budget | 180000 | false        |
 * | Sales      | Salaries | Q2 Budget | 185000 | false        |
 * | Sales      | Salaries | H1 Total  | 365000 | true         |  <- aggregate column
 * | Sales      | Travel   | Q1 Budget | 25000  | false        |
 * | Sales      | Travel   | Q2 Budget | 30000  | false        |
 */

import type { CellValue, ColumnInfo } from '@/lib/types';
import type { MatrixAnalysis } from '@/lib/llm/matrix-analyzer';

// ============================================================================
// Types
// ============================================================================

export interface NormalizedMatrix {
  columns: ColumnInfo[];
  data: CellValue[][];
  originalHeaders: string[];
  /** Whether this matrix has aggregate detection enabled */
  hasAggregateColumn: boolean;
  /** Aggregate info for UI display */
  aggregateInfo: {
    /** Period names that are aggregates (e.g., "H1 Total") */
    aggregatePeriods: string[];
    /** Column indices in original data that are aggregates */
    aggregateColumnIndices: number[];
    /** Row indices in original data that are aggregates (relative to header row) */
    aggregateRowIndices: number[];
  };
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
 * Now accepts optional LLM analysis for aggregate detection
 */
export function normalizeMatrix(
  data: CellValue[][],
  config: MatrixConfig,
  analysis?: MatrixAnalysis
): NormalizedMatrix {
  const { periodHeaderRow, periodHeaders } = config;

  // Get the header row
  const headerRow = data[periodHeaderRow] || [];
  
  // Find ALL period columns (including potential aggregates)
  const periodColumns = findPeriodColumns(headerRow, periodHeaders);

  if (periodColumns.length === 0) {
    // Fall back to basic extraction
    return createBasicNormalization(data, periodHeaderRow);
  }

  // Determine which columns are aggregates (from LLM analysis)
  const aggregateColumnIndicesFromLLM = new Set(analysis?.aggregateColumns || []);
  const aggregateRowIndicesFromLLM = new Set(analysis?.aggregateRows || []);
  
  // Track aggregate periods for UI display
  const aggregatePeriods: string[] = [];
  const aggregateColumnIndices: number[] = [];
  
  // Map period column indices to whether they're aggregates
  const periodColumnAggregateStatus = periodColumns.map((col, idx) => {
    // Check if this period column's position matches any aggregate column
    const isAggregate = aggregateColumnIndicesFromLLM.has(col.index) || aggregateColumnIndicesFromLLM.has(idx);
    if (isAggregate) {
      aggregatePeriods.push(col.header);
      aggregateColumnIndices.push(col.index);
    }
    return isAggregate;
  });

  // Process data rows into normalized format
  const normalizedData: CellValue[][] = [];
  let currentDepartment: string | null = null;
  let dataRowIndex = 0; // Track row index relative to data start

  // Start processing from row after header
  for (let rowIdx = periodHeaderRow + 1; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    
    // Skip empty rows
    if (isEmptyRow(row)) {
      dataRowIndex++;
      continue;
    }

    // Check if this is a section marker row (department header)
    const sectionMarker = detectSectionMarker(row);
    if (sectionMarker) {
      currentDepartment = formatDepartmentName(sectionMarker);
      dataRowIndex++;
      continue;
    }

    // Check if this row is marked as aggregate by LLM
    const isAggregateRow = aggregateRowIndicesFromLLM.has(dataRowIndex) || 
                           aggregateRowIndicesFromLLM.has(rowIdx - periodHeaderRow - 1);

    // Get the category (usually in column B, index 1)
    const category = findCategory(row);
    if (!category) {
      dataRowIndex++;
      continue;
    }

    // Create one row per period column
    for (let i = 0; i < periodColumns.length; i++) {
      const periodCol = periodColumns[i];
      const value = row[periodCol.index];
      
      // Skip empty/null values
      if (value === null || value === undefined || value === '') continue;
      
      // Skip non-numeric values in what should be numeric columns
      if (typeof value !== 'number') continue;

      // Determine if this cell is an aggregate
      const isAggregateColumn = periodColumnAggregateStatus[i];
      const isAggregate = isAggregateRow || isAggregateColumn;

      const normalizedRow: CellValue[] = [
        currentDepartment || 'Unknown',
        category,
        periodCol.header,
        value,
        isAggregate, // is_aggregate column
      ];

      normalizedData.push(normalizedRow);
    }

    dataRowIndex++;
  }

  // Build column definitions (now with is_aggregate)
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
    {
      name: 'is_aggregate',
      originalName: 'Is Aggregate',
      type: 'BOOLEAN',
      nullable: false,
      sampleValues: [],
    },
  ];

  const hasAggregates = analysis && 
    (analysis.aggregateColumns.length > 0 || analysis.aggregateRows.length > 0);

  return {
    columns,
    data: normalizedData,
    originalHeaders: periodColumns.map(p => p.header),
    hasAggregateColumn: hasAggregates || false,
    aggregateInfo: {
      aggregatePeriods,
      aggregateColumnIndices,
      aggregateRowIndices: analysis?.aggregateRows || [],
    },
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
 * Now includes ALL period-like columns (aggregates will be marked, not excluded)
 */
function findPeriodColumns(headerRow: CellValue[], periodHeaders: string[]): PeriodColumn[] {
  const columns: PeriodColumn[] = [];
  
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i];
    if (typeof cell === 'string' && cell.trim() !== '') {
      // Include if it's in detected period headers OR looks like a period header
      if (periodHeaders.includes(cell) || isPeriodLikeHeader(cell)) {
        columns.push({ index: i, header: cell.trim() });
      }
    }
  }
  
  return columns;
}

/**
 * Check if header looks like a period header
 * Includes totals now (they'll be marked as aggregates, not excluded)
 */
function isPeriodLikeHeader(header: string): boolean {
  const patterns = [
    /^Q[1-4]/i,
    /^H[1-2]/i,
    /budget/i,
    /actual/i,
    /forecast/i,
    /total/i, // Now included (will be marked as aggregate)
  ];
  return patterns.some(p => p.test(header));
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
  
  if (typeof firstCell !== 'string' || firstCell.trim() === '') {
    return null;
  }

  const trimmed = firstCell.trim();
  
  // Check if it's all caps (common pattern for section markers)
  // But don't treat TOTAL rows as section markers
  if (/^[A-Z\s]{2,}$/.test(trimmed)) {
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
    .filter((h) => h !== null && h !== '')
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
    hasAggregateColumn: false,
    aggregateInfo: {
      aggregatePeriods: [],
      aggregateColumnIndices: [],
      aggregateRowIndices: [],
    },
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
