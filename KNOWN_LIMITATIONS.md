# Known Limitations

This document lists the known limitations of Spreadsheet Intelligence, organized by category.

## File Format Support

| Supported | Not Supported |
|-----------|---------------|
| `.xlsx` (Excel 2007+) | `.xls` (legacy Excel) |
| | `.csv` (comma-separated) |
| | `.ods` (OpenDocument) |
| | `.xlsm` (macro-enabled) |
| | `.xlsb` (binary format) |

**Why**: The application uses SheetJS which supports multiple formats, but we only validate and test `.xlsx` files.

## File Size & Performance

- **Maximum file size**: 50MB (enforced at upload)
- **Practical limit**: Files with >100,000 rows may be slow to process
- **Memory usage**: Entire file is loaded into memory during processing
- **No streaming**: Large files are processed all at once, not incrementally

**Symptoms of large file issues**:
- Slow upload (>10 seconds)
- Browser timeout during processing
- Server memory pressure with concurrent uploads

## Excel Features

### Formulas

- **Supported**: ~400 common functions via HyperFormula
- **Not fully supported**:
  - Array formulas (`CTRL+SHIFT+ENTER` style)
  - Dynamic arrays (`FILTER`, `SORT`, `UNIQUE` spill formulas)
  - External references (`='[OtherFile.xlsx]Sheet1'!A1`)
  - Macros and VBA
  - Data validation formulas

**Behavior**: Unsupported formulas may return `#NAME?` or `#VALUE!` errors, or the raw formula text.

### Cell Features

| Works | Doesn't Work |
|-------|--------------|
| Text, numbers, dates | Merged cells (treated as single cell) |
| Basic formatting (ignored) | Comments/notes |
| Multiple sheets | Hyperlinks |
| Named ranges (partial) | Conditional formatting |
| | Embedded images/charts |
| | Pivot tables |

### Sheet Structure

- **Headers must be in a single row**: Multi-row headers are not detected
- **One table per sheet**: Sheets with multiple separate tables may confuse detection
- **Consistent column types**: Mixed types in a column may cause type inference issues

## Matrix Sheet Detection

Matrix/report-style sheets are detected using heuristics that look for:
- Period-like headers (Q1, Q2, H1, Budget, Actual, etc.)
- Section markers (all-caps department names)
- Numeric data in a grid pattern

**Limitations**:
- Non-English period names may not be detected (though LLM aggregate detection is language-agnostic)
- Unusual layouts may be misclassified
- Complex multi-level headers not supported
- Matrix detection can be wrong—no manual override currently available

## Aggregate Detection

The LLM-based aggregate detection analyzes numeric patterns to identify pre-calculated totals.

**Limitations**:
- Relies on LLM interpretation (may miss subtle patterns)
- Only detects column-wise aggregates reliably
- Row-wise aggregates (subtotal rows) detection is less reliable
- May not detect aggregates in small datasets (insufficient patterns)
- Adds 500-2000ms to processing time for matrix sheets

**When it fails**: If aggregates are not detected, SUM queries may double-count values.

## Natural Language Queries

### What Works Well
- Simple aggregations: "What is the total sales?"
- Filtering: "Show sales from January 2024"
- Grouping: "Sales by product category"
- Joins: "Which rep sold the most?" (joins sales with employees)
- Comparisons: "Compare Q1 vs Q2 budget"

### What May Struggle
- **Ambiguous questions**: "Show me the data" (which data?)
- **Complex analytics**: Multi-step calculations, percentiles, moving averages
- **Temporal logic**: "Month over month growth" (requires window functions)
- **Fuzzy matching**: "Find sales for John" when name is "Jonathan Smith"
- **Implicit context**: "And what about Marketing?" (needs conversation context)

### SQL Generation Limitations
- Generated SQL may be syntactically incorrect (rare, but possible)
- Complex queries may timeout or return errors
- No support for `INSERT`, `UPDATE`, `DELETE` (by design)
- Subqueries and CTEs depend on LLM capability

## Session & State

- **No persistence**: Data is lost when server restarts
- **Single session per upload**: Re-uploading creates a new session
- **No concurrent uploads**: Uploading a new file replaces the current session
- **Memory-based**: Sessions stored in server memory (not scalable)
- **No export**: Cannot export query results to CSV/Excel

## User Interface

- **No header row override**: Cannot manually specify which row is the header
- **No column type override**: Cannot manually change detected column types
- **No sheet renaming**: Table names are auto-generated from sheet names
- **Limited mobile support**: UI optimized for desktop browsers
- **No dark mode**: Light theme only

## Query Engine (DuckDB)

- **In-memory only**: No persistent database files
- **Single-threaded queries**: Complex queries run on one thread
- **No indexes**: All queries do full table scans (fine for small datasets)
- **Type coercion**: May convert types unexpectedly (e.g., "123" string to 123 number)

## LLM Provider (Groq)

- **Internet required**: Cannot work offline
- **Rate limits**: High query volume may hit API limits
- **Model availability**: Depends on Groq service uptime
- **Token limits**: Very large schemas may exceed context window
- **Cost**: Each query costs API tokens (though Groq is competitively priced)

## Security Considerations

- **No authentication**: Anyone with access to the URL can use the app
- **No data encryption**: Data stored in plain memory
- **SQL injection mitigated**: LLM generates SQL, but validation enforces SELECT-only
- **File upload risks**: Malformed Excel files could potentially cause issues
- **No audit logging**: No record of who queried what

## Browser Compatibility

Tested and works on:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

Not tested on:
- Internet Explorer (not supported)
- Mobile browsers (may work but not optimized)

## Future Improvements

These limitations could be addressed in future versions:

1. **File format support**: Add CSV, XLS support
2. **Streaming upload**: Handle large files incrementally
3. **Header override UI**: Let users manually set header row
4. **Persistent sessions**: Save/restore sessions
5. **Export functionality**: Download query results
6. **Better matrix detection**: ML-based layout classification
7. **Offline mode**: Local LLM option for air-gapped environments
8. **Multi-user support**: Authentication and session isolation
