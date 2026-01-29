'use client';

import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadZoneProps {
  onUpload: (file: File) => Promise<void>;
  isLoading: boolean;
  error?: string | null;
}

/**
 * Drag-and-drop file upload zone
 */
export function UploadZone({ onUpload, isLoading, error }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.xlsx')) {
        await onUpload(file);
      }
    },
    [onUpload]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await onUpload(file);
      }
    },
    [onUpload]
  );

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200',
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.02]'
            : 'border-slate-300 bg-white hover:border-slate-400',
          isLoading && 'pointer-events-none opacity-70'
        )}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
            <div>
              <p className="text-lg font-medium text-slate-700">
                Processing your spreadsheet...
              </p>
              <p className="text-sm text-slate-500 mt-1">
                This may take a moment for large files
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-slate-100 rounded-full">
                <FileSpreadsheet className="h-10 w-10 text-slate-600" />
              </div>
              <div>
                <p className="text-lg font-medium text-slate-700">
                  Drop your Excel file here
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  or click to browse
                </p>
              </div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={handleFileChange}
                  className="sr-only"
                  disabled={isLoading}
                />
                <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                  <Upload className="h-4 w-4" />
                  Choose File
                </span>
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-6">
              Supported format: .xlsx (max 50MB)
            </p>
          </>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Upload failed</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
