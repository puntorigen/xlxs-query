'use client';

import { Table2, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SheetType } from '@/lib/types';

interface SheetInfo {
  name: string;
  sheetType: SheetType;
  rowCount: number;
}

interface SheetTabsProps {
  sheets: SheetInfo[];
  activeSheet: string;
  onSheetChange: (sheetName: string) => void;
}

/**
 * Tab navigation for sheets in the workbook
 */
export function SheetTabs({ sheets, activeSheet, onSheetChange }: SheetTabsProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
      {sheets.map((sheet) => (
        <button
          key={sheet.name}
          onClick={() => onSheetChange(sheet.name)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap',
            activeSheet === sheet.name
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
          )}
        >
          {sheet.sheetType === 'matrix' ? (
            <LayoutGrid className="h-3.5 w-3.5" />
          ) : (
            <Table2 className="h-3.5 w-3.5" />
          )}
          <span>{sheet.name}</span>
          <span className="text-xs text-slate-400">({sheet.rowCount})</span>
        </button>
      ))}
    </div>
  );
}
