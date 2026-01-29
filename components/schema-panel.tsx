'use client';

import { Database, Hash, Type, Calendar, ToggleLeft, Link, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ColumnInfo, Relationship, SheetType } from '@/lib/types';

interface SchemaPanelProps {
  columns: ColumnInfo[];
  rowCount: number;
  relationships?: Relationship[];
  tableName: string;
  sheetType?: SheetType;
}

/**
 * Schema information panel showing columns, types, and relationships
 */
export function SchemaPanel({
  columns,
  rowCount,
  relationships = [],
  tableName,
  sheetType,
}: SchemaPanelProps) {
  // Filter relationships relevant to this table
  const relevantRelationships = relationships.filter(
    (r) => r.fromTable === tableName || r.toTable === tableName
  );

  return (
    <div className="space-y-4">
      {/* Matrix sheet notice */}
      {sheetType === 'matrix' && (
        <div className="flex items-start gap-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            This is a matrix/report sheet. Data has been normalized to columns
            (department, category, period, amount) for easier querying.
          </span>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Database className="h-4 w-4" />
        <span>{columns.length} columns</span>
        <span className="text-slate-300">•</span>
        <span>{rowCount.toLocaleString()} rows</span>
      </div>

      {/* Columns */}
      <ScrollArea className="h-[200px]">
        <div className="space-y-1.5">
          {columns.map((column) => (
            <div
              key={column.name}
              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50"
            >
              <TypeIcon type={column.type} />
              <span className="font-mono text-sm text-slate-700 flex-1 truncate">
                {column.name}
              </span>
              <Badge variant="secondary" className="text-xs">
                {formatType(column.type)}
              </Badge>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Relationships */}
      {relevantRelationships.length > 0 && (
        <div className="border-t pt-3">
          <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
            <Link className="h-4 w-4" />
            <span>Relationships</span>
          </div>
          <div className="space-y-1.5 text-xs">
            {relevantRelationships.map((rel, i) => (
              <div key={i} className="flex items-center gap-1 text-slate-500">
                <span className="font-mono">{rel.fromTable}.{rel.fromColumn}</span>
                <span>→</span>
                <span className="font-mono">{rel.toTable}.{rel.toColumn}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Get icon for column type
 */
function TypeIcon({ type }: { type: ColumnInfo['type'] }) {
  const iconClass = 'h-3.5 w-3.5 text-slate-400';

  switch (type) {
    case 'INTEGER':
    case 'DOUBLE':
      return <Hash className={iconClass} />;
    case 'DATE':
    case 'TIMESTAMP':
      return <Calendar className={iconClass} />;
    case 'BOOLEAN':
      return <ToggleLeft className={iconClass} />;
    default:
      return <Type className={iconClass} />;
  }
}

/**
 * Format type name for display
 */
function formatType(type: ColumnInfo['type']): string {
  const typeMap: Record<ColumnInfo['type'], string> = {
    VARCHAR: 'text',
    INTEGER: 'int',
    DOUBLE: 'number',
    BOOLEAN: 'bool',
    DATE: 'date',
    TIMESTAMP: 'time',
  };
  return typeMap[type] || type.toLowerCase();
}
