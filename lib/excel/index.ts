/**
 * Excel processing module exports
 */

export { parseExcelBuffer, columnIndexToLetter, letterToColumnIndex } from './parser';
export type { RawParsedSheet, RawParsedWorkbook } from './parser';

export { evaluateFormulas, serialToDate } from './formula-evaluator';
export type { EvaluatedSheet, EvaluatedWorkbook } from './formula-evaluator';

export { detectHeaderRow } from './header-detector';
export type { HeaderDetectionResult } from './header-detector';

export { classifySheet } from './sheet-classifier';
export type { ClassificationResult } from './sheet-classifier';

export { normalizeMatrix } from './matrix-normalizer';
export type { NormalizedMatrix } from './matrix-normalizer';

export { processExcelFile } from './processor';
