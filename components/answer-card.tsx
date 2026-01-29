'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Table2, AlertCircle, Code } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CellValue } from '@/lib/types';

interface AnswerCardProps {
  question: string;
  answer?: string;
  sql?: string;
  tablesUsed?: string[];
  resultPreview?: CellValue[][];
  columnNames?: string[];
  error?: string;
  isLatest?: boolean;
}

/**
 * Display card for a query answer with collapsible SQL and results
 */
export function AnswerCard({
  question,
  answer,
  sql,
  tablesUsed = [],
  resultPreview,
  columnNames,
  error,
  isLatest = false,
}: AnswerCardProps) {
  const [showSql, setShowSql] = useState(false);
  const [showResults, setShowResults] = useState(false);

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-all',
        error
          ? 'bg-red-50/50 border-red-200'
          : isLatest
          ? 'bg-white border-primary/30 shadow-sm'
          : 'bg-slate-50/50 border-slate-200'
      )}
    >
      {/* Question */}
      <p className="text-sm text-slate-600 mb-2">Q: {question}</p>

      {/* Answer or Error */}
      {error ? (
        <div className="flex items-start gap-2 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      ) : (
        <div className="prose prose-slate prose-sm max-w-none">
          <ReactMarkdown
            components={{
              // Style overrides for better appearance
              p: ({ children }) => (
                <p className="text-lg font-medium text-slate-900 mb-0">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-slate-900">{children}</strong>
              ),
              ul: ({ children }) => (
                <ul className="list-disc list-inside text-lg text-slate-900 mt-1 mb-0">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-inside text-lg text-slate-900 mt-1 mb-0">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="text-base text-slate-800">{children}</li>
              ),
            }}
          >
            {answer || ''}
          </ReactMarkdown>
        </div>
      )}

      {/* Tables Used */}
      {tablesUsed.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <Table2 className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs text-slate-500">From:</span>
          {tablesUsed.map((table) => (
            <Badge key={table} variant="secondary" className="text-xs">
              {table}
            </Badge>
          ))}
        </div>
      )}

      {/* Collapsible SQL */}
      {sql && (
        <div className="mt-3 border-t pt-3">
          <button
            onClick={() => setShowSql(!showSql)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            {showSql ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Code className="h-3.5 w-3.5" />
            <span>SQL Query</span>
          </button>

          {showSql && (
            <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-md text-xs overflow-x-auto font-mono">
              {formatSql(sql)}
            </pre>
          )}
        </div>
      )}

      {/* Collapsible Results Table */}
      {resultPreview && resultPreview.length > 1 && columnNames && (
        <div className="mt-2 border-t pt-3">
          <button
            onClick={() => setShowResults(!showResults)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            {showResults ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Table2 className="h-3.5 w-3.5" />
            <span>Results ({resultPreview.length} rows)</span>
          </button>

          {showResults && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs border rounded">
                <thead>
                  <tr className="bg-slate-100">
                    {columnNames.map((col) => (
                      <th
                        key={col}
                        className="px-2 py-1.5 text-left font-medium text-slate-600 border-b"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultPreview.slice(0, 10).map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {row.map((cell, j) => (
                        <td key={j} className="px-2 py-1 border-b text-slate-700">
                          {formatCellValue(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {resultPreview.length > 10 && (
                <p className="text-xs text-slate-400 mt-1 text-center">
                  Showing 10 of {resultPreview.length} rows
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Format SQL for display with basic syntax highlighting
 */
function formatSql(sql: string): string {
  // Just return formatted SQL - browser will handle whitespace
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',\n  ')
    .replace(/\bSELECT\b/gi, 'SELECT')
    .replace(/\bFROM\b/gi, '\nFROM')
    .replace(/\bWHERE\b/gi, '\nWHERE')
    .replace(/\bJOIN\b/gi, '\nJOIN')
    .replace(/\bLEFT JOIN\b/gi, '\nLEFT JOIN')
    .replace(/\bINNER JOIN\b/gi, '\nINNER JOIN')
    .replace(/\bON\b/gi, '\n  ON')
    .replace(/\bGROUP BY\b/gi, '\nGROUP BY')
    .replace(/\bORDER BY\b/gi, '\nORDER BY')
    .replace(/\bLIMIT\b/gi, '\nLIMIT')
    .trim();
}

/**
 * Format cell value for display
 */
function formatCellValue(value: CellValue): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return String(value);
}
