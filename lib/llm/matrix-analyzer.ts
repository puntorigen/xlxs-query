/**
 * LLM-assisted matrix structure analyzer
 * Identifies aggregate columns and rows by analyzing numeric patterns
 */

import { generateAnswerCompletion } from './groq-client';
import type { CellValue } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface MatrixAnalysis {
  /** Column indices (0-based from data start) that contain calculated aggregates */
  aggregateColumns: number[];
  /** Row indices (0-based from data start) that are subtotals/totals */
  aggregateRows: number[];
  /** Confidence level 0-1 */
  confidence: number;
  /** Optional explanation from LLM */
  reasoning?: string;
}

// ============================================================================
// System Prompt
// ============================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a spreadsheet structure analyzer. Your task is to identify calculated aggregate columns and rows by analyzing NUMERIC PATTERNS in the data.

## What to Look For

AGGREGATE COLUMNS: Columns where values appear to be sums of other columns
- Example: If column C + column D = column E for most rows, column E is an aggregate

AGGREGATE ROWS: Rows where values appear to be sums of previous rows  
- Example: If a row's values equal the sum of the rows above it (within a section), it's an aggregate row
- These are typically subtotals or grand totals

## Important

- Analyze the NUMBERS, not the text labels (labels may be in any language)
- Look for mathematical relationships between values
- A column/row is aggregate if its values consistently equal the sum of other columns/rows
- Return indices relative to the data portion (0-based, excluding header row)

## Response Format

Return ONLY valid JSON:
{
  "aggregateColumns": [<indices of aggregate columns>],
  "aggregateRows": [<indices of aggregate rows>],
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation>"
}`;

// ============================================================================
// Main Analyzer
// ============================================================================

/**
 * Analyze matrix structure to identify aggregate columns and rows
 * Uses LLM to detect patterns based on numeric relationships, not labels
 */
export async function analyzeMatrixStructure(
  headers: CellValue[],
  dataRows: CellValue[][],
  dataColumnStartIndex: number = 0
): Promise<MatrixAnalysis> {
  // Default result if analysis fails
  const defaultResult: MatrixAnalysis = {
    aggregateColumns: [],
    aggregateRows: [],
    confidence: 0,
  };

  if (dataRows.length === 0) {
    return defaultResult;
  }

  try {
    // Build the analysis prompt
    const prompt = buildAnalysisPrompt(headers, dataRows, dataColumnStartIndex);
    
    console.log('[MatrixAnalyzer] Analyzing matrix structure with LLM...');
    
    // Call LLM for analysis
    const response = await generateAnswerCompletion(
      ANALYSIS_SYSTEM_PROMPT,
      prompt,
      { temperature: 0.1, maxTokens: 1024 }
    );

    // Parse the JSON response
    const analysis = parseAnalysisResponse(response);
    
    console.log(
      `[MatrixAnalyzer] Analysis complete. Aggregate columns: [${analysis.aggregateColumns.join(', ')}], ` +
      `Aggregate rows: [${analysis.aggregateRows.join(', ')}], Confidence: ${analysis.confidence}`
    );

    return analysis;
  } catch (error) {
    console.error('[MatrixAnalyzer] Analysis failed:', error);
    return defaultResult;
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the analysis prompt with headers and sample data
 */
function buildAnalysisPrompt(
  headers: CellValue[],
  dataRows: CellValue[][],
  dataColumnStartIndex: number
): string {
  // Format headers
  const headerStr = JSON.stringify(headers);
  
  // Take up to 20 rows for analysis
  const sampleRows = dataRows.slice(0, 20);
  
  // Format data rows with row indices
  const rowsStr = sampleRows
    .map((row, idx) => `Row ${idx}: ${JSON.stringify(row)}`)
    .join('\n');

  // Count numeric columns for context
  const numericColumnIndices = findNumericColumns(headers, dataRows, dataColumnStartIndex);
  
  return `Analyze this spreadsheet matrix to identify aggregate columns and rows.

## Headers
${headerStr}

## Data Rows (showing first ${sampleRows.length} rows)
${rowsStr}

## Context
- Numeric data starts at column index ${dataColumnStartIndex}
- Numeric columns are at indices: ${JSON.stringify(numericColumnIndices)}
- Total data rows: ${dataRows.length}

## Task
Examine the numeric values and identify:
1. Which columns (if any) contain values that are sums of other columns?
2. Which rows (if any) contain values that are sums of other rows (subtotals/totals)?

Return your analysis as JSON.`;
}

/**
 * Find which columns contain predominantly numeric data
 */
function findNumericColumns(
  headers: CellValue[],
  dataRows: CellValue[][],
  startIndex: number
): number[] {
  const numericCols: number[] = [];
  
  for (let col = startIndex; col < headers.length; col++) {
    let numericCount = 0;
    const sampleSize = Math.min(10, dataRows.length);
    
    for (let row = 0; row < sampleSize; row++) {
      if (typeof dataRows[row]?.[col] === 'number') {
        numericCount++;
      }
    }
    
    // If more than half are numbers, consider it numeric
    if (numericCount > sampleSize / 2) {
      numericCols.push(col);
    }
  }
  
  return numericCols;
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse and validate the LLM's analysis response
 */
function parseAnalysisResponse(response: string): MatrixAnalysis {
  const defaultResult: MatrixAnalysis = {
    aggregateColumns: [],
    aggregateRows: [],
    confidence: 0,
  };

  if (!response || response.trim() === '') {
    return defaultResult;
  }

  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[MatrixAnalyzer] No JSON found in response');
      return defaultResult;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and extract fields
    const result: MatrixAnalysis = {
      aggregateColumns: Array.isArray(parsed.aggregateColumns) 
        ? parsed.aggregateColumns.filter((n: unknown) => typeof n === 'number')
        : [],
      aggregateRows: Array.isArray(parsed.aggregateRows)
        ? parsed.aggregateRows.filter((n: unknown) => typeof n === 'number')
        : [],
      confidence: typeof parsed.confidence === 'number' 
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    };

    return result;
  } catch (error) {
    console.warn('[MatrixAnalyzer] Failed to parse response:', error);
    return defaultResult;
  }
}
