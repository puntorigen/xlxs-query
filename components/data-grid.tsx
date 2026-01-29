'use client';

import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CellValue } from '@/lib/types';

interface DataGridProps {
  data: CellValue[][];
  maxRows?: number;
}

/**
 * Spreadsheet-like data grid display
 */
export function DataGrid({ data, maxRows = 100 }: DataGridProps) {
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
            {Array.from({ length: columnCount }).map((_, i) => (
              <th
                key={i}
                className="min-w-[100px] px-3 py-2 border-r border-b text-slate-500 font-medium text-center bg-slate-100"
              >
                {columnIndexToLetter(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayData.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={rowIndex === 0 ? 'bg-blue-50/50' : 'hover:bg-slate-50'}
            >
              {/* Row number */}
              <td className="px-2 py-1.5 border-r text-slate-400 text-center text-xs bg-slate-50">
                {rowIndex + 1}
              </td>
              {/* Data cells */}
              {Array.from({ length: columnCount }).map((_, colIndex) => (
                <td
                  key={colIndex}
                  className="px-3 py-1.5 border-r border-b truncate max-w-[200px]"
                  title={formatCellValue(row[colIndex])}
                >
                  <span
                    className={
                      rowIndex === 0
                        ? 'font-medium text-slate-900'
                        : getCellStyle(row[colIndex])
                    }
                  >
                    {formatCellValue(row[colIndex])}
                  </span>
                </td>
              ))}
            </tr>
          ))}
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

  if (typeof value === 'number') {
    return 'text-right font-mono text-slate-700';
  }

  return 'text-slate-700';
}
