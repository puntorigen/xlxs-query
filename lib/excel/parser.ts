/**
 * Excel file parser using SheetJS
 * Extracts both values and formulas from Excel files
 */

import * as XLSX from 'xlsx';
import type { CellValue } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

/** Raw parsed sheet from SheetJS */
export interface RawParsedSheet {
  name: string;
  /** 2D array with values or formula strings (prefixed with =) */
  data: (CellValue | string)[][];
  /** Original cell data for reference */
  cells: Map<string, { value: CellValue; formula?: string }>;
}

/** Raw parsed workbook */
export interface RawParsedWorkbook {
  sheets: RawParsedSheet[];
  sheetNames: string[];
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse an Excel file buffer into raw sheet data
 * Extracts formulas for HyperFormula evaluation
 */
export function parseExcelBuffer(buffer: ArrayBuffer): RawParsedWorkbook {
  // Read workbook with formula extraction enabled
  const workbook = XLSX.read(buffer, {
    cellFormula: true,
    cellDates: true,
    cellNF: false,
    cellStyles: false,
  });

  const sheets: RawParsedSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const parsedSheet = parseWorksheet(sheetName, worksheet);
    sheets.push(parsedSheet);
  }

  return {
    sheets,
    sheetNames: workbook.SheetNames,
  };
}

/**
 * Parse a single worksheet into raw data
 */
function parseWorksheet(
  name: string,
  worksheet: XLSX.WorkSheet
): RawParsedSheet {
  const cells = new Map<string, { value: CellValue; formula?: string }>();
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

  // Calculate dimensions
  const rowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;

  // Initialize 2D array
  const data: (CellValue | string)[][] = Array.from({ length: rowCount }, () =>
    Array(colCount).fill(null)
  );

  // Process each cell
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];

      if (cell) {
        const value = getCellValue(cell);
        const formula = cell.f;

        // Store cell info
        cells.set(cellAddress, { value, formula });

        // For HyperFormula: use formula string if present, otherwise use value
        const dataRow = row - range.s.r;
        const dataCol = col - range.s.c;

        if (formula) {
          // Prefix formula with = for HyperFormula
          data[dataRow][dataCol] = `=${formula}`;
        } else {
          data[dataRow][dataCol] = value;
        }
      }
    }
  }

  return { name, data, cells };
}

/**
 * Extract typed value from a SheetJS cell
 */
function getCellValue(cell: XLSX.CellObject): CellValue {
  if (cell.v === undefined || cell.v === null) {
    return null;
  }

  switch (cell.t) {
    case 'n': // Number
      return cell.v as number;
    case 's': // String
      return cell.v as string;
    case 'b': // Boolean
      return cell.v as boolean;
    case 'd': // Date
      return cell.v as Date;
    case 'e': // Error
      return null;
    default:
      return cell.v as CellValue;
  }
}

/**
 * Convert column index to Excel letter (0 -> A, 25 -> Z, 26 -> AA)
 */
export function columnIndexToLetter(index: number): string {
  let letter = '';
  let temp = index;

  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }

  return letter;
}

/**
 * Convert Excel letter to column index (A -> 0, Z -> 25, AA -> 26)
 */
export function letterToColumnIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}
