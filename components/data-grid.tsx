'use client';

import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CellValue, AggregateInfo } from '@/lib/types';

interface DataGridProps {
  data: CellValue[][];
  maxRows?: number;
  /** For original view: highlight aggregate columns/rows */
  highlightAggregates?: AggregateInfo;
  /** For normalized view: highlight the is_aggregate column */
  showAggregateColumn?: boolean;
}

/**
 * Spreadsheet-like data grid display
 */
export function DataGrid({ 
  data, 
  maxRows = 100, 
  highlightAggregates,
  showAggregateColumn 
}: DataGridProps) {
  // Limit displayed rows
  const displayData = useMemo(() => {
    return data.slice(0, maxRows);
  }, [data, maxRows]);

  if (displayData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500">
        No data to display
      </div>
    );
  }

  // Get column count from the row with most columns
  const columnCount = Math.max(...displayData.map((row) => row.length));

  // Create set for fast lookup of aggregate column indices (for original view highlighting)
  const aggregateColumnSet = useMemo(() => {
    return new Set(highlightAggregates?.aggregateColumnIndices || []);
  }, [highlightAggregates]);

  // For normalized view, find the is_aggregate column index
  const isAggregateColumnIndex = useMemo(() => {
    if (!showAggregateColumn || displayData.length === 0) return -1;
    const headerRow = displayData[0];
    return headerRow.findIndex(cell => 
      typeof cell === 'string' && cell.toLowerCase().includes('aggregate')
    );
  }, [showAggregateColumn, displayData]);

  return (
    <ScrollArea orientation="both" className="h-[400px] border rounded-lg bg-white">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-100">
            {/* Row number header */}
            <th className="w-12 px-2 py-2 border-r border-b text-slate-500 font-medium text-center bg-slate-100">
              #
            </th>
            {/* Column headers (A, B, C...) */}
            {Array.from({ length: columnCount }).map((_, i) => {
              const isAggregateCol = aggregateColumnSet.has(i);
              return (
                <th
                  key={i}
                  className={`min-w-[100px] px-3 py-2 border-r border-b font-medium text-center ${
                    isAggregateCol 
                      ? 'bg-amber-100 text-amber-800' 
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {columnIndexToLetter(i)}
                  {isAggregateCol && (
                    <span className="ml-1 text-xs">(agg)</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayData.map((row, rowIndex) => {
            // For normalized view, check if the is_aggregate column has a truthy value
            // We only highlight rows in normalized view where we can check the actual column
            const isNormalizedAggregateRow = showAggregateColumn && 
              isAggregateColumnIndex >= 0 && 
              rowIndex > 0 && 
              row[isAggregateColumnIndex] === true;

            // Only highlight rows in normalized view (original view row indices don't map correctly)
            const shouldHighlightRow = isNormalizedAggregateRow;

            return (
              <tr
                key={rowIndex}
                className={
                  rowIndex === 0 
                    ? 'bg-blue-50/50' 
                    : shouldHighlightRow
                      ? 'bg-amber-50 hover:bg-amber-100'
                      : 'hover:bg-slate-50'
                }
              >
                {/* Row number */}
                <td className={`px-2 py-1.5 border-r text-center text-xs ${
                  shouldHighlightRow ? 'bg-amber-100 text-amber-700' : 'bg-slate-50 text-slate-400'
                }`}>
                  {rowIndex + 1}
                </td>
                {/* Data cells */}
                {Array.from({ length: columnCount }).map((_, colIndex) => {
                  const isAggregateCol = highlightAggregates && aggregateColumnSet.has(colIndex);
                  const cellHighlight = (isAggregateCol || shouldHighlightRow) && rowIndex > 0;

                  return (
                    <td
                      key={colIndex}
                      className={`px-3 py-1.5 border-r border-b truncate max-w-[200px] ${
                        cellHighlight ? 'bg-amber-50' : ''
                      }`}
                      title={formatCellValue(row[colIndex])}
                    >
                      <span
                        className={
                          rowIndex === 0
                            ? 'font-medium text-slate-900'
                            : cellHighlight
                              ? 'text-amber-800 ' + getCellStyle(row[colIndex])
                              : getCellStyle(row[colIndex])
                        }
                      >
                        {formatCellValue(row[colIndex])}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Row count indicator */}
      {data.length > maxRows && (
        <div className="sticky bottom-0 left-0 right-0 px-3 py-2 bg-slate-100 border-t text-xs text-slate-500 text-center">
          Showing {maxRows} of {data.length} rows
        </div>
      )}
    </ScrollArea>
  );
}

/**
 * Convert column index to Excel-style letter (0 -> A, 25 -> Z, 26 -> AA)
 */
function columnIndexToLetter(index: number): string {
  let letter = '';
  let temp = index;

  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }

  return letter;
}

/**
 * Format a cell value for display
 */
function formatCellValue(value: CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    // Format large numbers with commas
    if (Math.abs(value) >= 1000) {
      return new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 2,
      }).format(value);
    }
    // Format decimals
    if (value % 1 !== 0) {
      return value.toFixed(2);
    }
    return String(value);
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  return String(value);
}

/**
 * Get styling class for a cell based on its value type
 */
function getCellStyle(value: CellValue): string {
  if (value === null || value === undefined || value === '') {
    return 'text-slate-300';
  }

  if (typeof value === 'boolean') {
    return value ? 'text-green-600 font-medium' : 'text-slate-400';
  }

  if (typeof value === 'number') {
    return 'text-right font-mono text-slate-700';
  }

  return 'text-slate-700';
}
