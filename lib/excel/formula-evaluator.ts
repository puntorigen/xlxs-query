/**
 * Formula evaluation using HyperFormula
 * Evaluates all Excel formulas to ensure computed values are accurate
 */

import { HyperFormula } from 'hyperformula';
import type { RawParsedWorkbook, RawParsedSheet } from './parser';
import type { CellValue } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

/** Sheet with evaluated values */
export interface EvaluatedSheet {
  name: string;
  data: CellValue[][];
}

/** Workbook with all formulas evaluated */
export interface EvaluatedWorkbook {
  sheets: EvaluatedSheet[];
  sheetNames: string[];
}

// ============================================================================
// Main Evaluator
// ============================================================================

/**
 * Evaluate all formulas in a parsed workbook using HyperFormula
 * Returns a workbook with computed values instead of formulas
 */
export function evaluateFormulas(
  parsedWorkbook: RawParsedWorkbook
): EvaluatedWorkbook {
  // Build sheet data object for HyperFormula
  const sheetsData: Record<string, (string | number | boolean | null)[][]> = {};

  for (const sheet of parsedWorkbook.sheets) {
    // Convert data to HyperFormula-compatible format
    sheetsData[sheet.name] = sheet.data.map((row) =>
      row.map((cell) => normalizeForHyperFormula(cell))
    );
  }

  // Create HyperFormula instance with all sheets
  // Using default locale settings (en-US style)
  const hf = HyperFormula.buildFromSheets(sheetsData, {
    licenseKey: 'gpl-v3',
  });

  // Get evaluated values for all sheets
  const allValues = hf.getAllSheetsValues();

  // Convert back to our format
  const evaluatedSheets: EvaluatedSheet[] = parsedWorkbook.sheetNames.map(
    (name) => ({
      name,
      data: (allValues[name] || []).map((row) =>
        (row || []).map((cell) => normalizeFromHyperFormula(cell))
      ),
    })
  );

  // Clean up HyperFormula instance
  hf.destroy();

  return {
    sheets: evaluatedSheets,
    sheetNames: parsedWorkbook.sheetNames,
  };
}

// ============================================================================
// Value Normalization
// ============================================================================

/**
 * Normalize a cell value for HyperFormula input
 * HyperFormula expects: number, string, boolean, null, or formula string
 */
function normalizeForHyperFormula(
  value: CellValue | string
): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  // Formula strings (already prefixed with =)
  if (typeof value === 'string' && value.startsWith('=')) {
    return value;
  }

  // Dates need to be converted to numbers (Excel serial date)
  if (value instanceof Date) {
    return dateToSerial(value);
  }

  // Primitives
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return null;
}

/**
 * Normalize a value from HyperFormula output
 */
function normalizeFromHyperFormula(value: unknown): CellValue {
  if (value === null || value === undefined) {
    return null;
  }

  // HyperFormula may return error objects
  if (typeof value === 'object' && value !== null) {
    // Check for error types
    if ('type' in value && 'message' in value) {
      return null; // Return null for errors
    }
    return null;
  }

  // Handle Date serial numbers if needed
  // (HyperFormula returns dates as serial numbers)

  return value as CellValue;
}

/**
 * Convert JavaScript Date to Excel serial date number
 * Excel's epoch is December 30, 1899
 */
function dateToSerial(date: Date): number {
  // Excel epoch (January 0, 1900 = December 30, 1899)
  const excelEpoch = new Date(1899, 11, 30);
  const msPerDay = 24 * 60 * 60 * 1000;

  // Calculate days since epoch
  const days = (date.getTime() - excelEpoch.getTime()) / msPerDay;

  // Excel incorrectly assumes 1900 is a leap year, so add 1 for dates after Feb 28, 1900
  if (days > 59) {
    return days + 1;
  }

  return days;
}

/**
 * Convert Excel serial date to JavaScript Date
 */
export function serialToDate(serial: number): Date {
  const excelEpoch = new Date(1899, 11, 30);
  const msPerDay = 24 * 60 * 60 * 1000;

  // Adjust for Excel's leap year bug
  let adjustedSerial = serial;
  if (serial > 59) {
    adjustedSerial = serial - 1;
  }

  return new Date(excelEpoch.getTime() + adjustedSerial * msPerDay);
}
