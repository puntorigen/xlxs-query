# PRD: Next.js Spreadsheet NLQ App (Excel Upload + SQL Transparency)

## 1. Overview

Build a local-first web app (Next.js fullstack) that lets users upload Excel `.xlsx` files and ask natural-language questions about their data. The system must return numerically exact answers, show the generated SQL/code used to compute the answer, and attribute which sheet(s) contributed.

**Key principle:** the LLM never performs math. It produces a deterministic query plan (SQL) executed by a computation engine.

## 2. Goals

* Upload and parse Excel workbooks with multiple sheets.
* Automatically detect spreadsheet structure (tables) and handle variable header rows.
* Support “matrix/report-style” sheets (like Budgets) by normalizing to query-friendly tables.
* Natural-language question answering with:

  * exact numerical results
  * displayed SQL used for computation
  * source attribution (sheets/tables used)
  * verifiable outputs (result table preview, optional contributing rows)
* Runs locally with clear setup instructions.

## 3. Non-Goals

* Pixel-perfect Excel rendering (styles, merged cells, charts).
* Full Excel feature parity (macros, pivot caches, external links).
* Multi-user auth and cloud deployment (out of scope for challenge).

## 4. Target Users

* Analyst or reviewer uploading a workbook and asking questions.
* Developer/reviewer validating the computed results and provenance.

## 5. Success Criteria

* **Query Accuracy:** Answers match deterministic computation output.
* **Schema Understanding:** Correctly identifies headers, tables, types, and handles non-table layouts.
* **Architecture:** Clean separation between parsing/modeling/querying/UI.
* **Transparency:** Shows SQL, referenced sheets, and result preview.

## 6. Core User Flows

### 6.1 Upload Workbook

1. User selects `.xlsx` and uploads.
2. App parses workbook, detects sheet structures, and builds a query model.
3. App shows:

   * sheet list
   * detected header row per sheet
   * schema summary (columns/types/row counts)
   * preview grid per sheet

### 6.2 Ask a Question

1. User enters a natural-language question.
2. App generates a read-only SQL query from the question + schema.
3. App executes SQL and returns:

   * answer (with exact numeric values)
   * SQL used
   * sheets/tables used
   * result table preview
   * optional “Show contributing rows”

### 6.3 Review and Verify

* User expands “SQL used” and “Sheets used”.
* User can open the sheet preview(s) referenced.
* For cell/coordinate questions, user can click a cell to see its address/value/formula (if supported).

## 7. Functional Requirements

### 7.1 Upload & Processing

* Accept `.xlsx` via web UI.
* Parse workbook sheets.
* Extract:

  * sheet names
  * raw cell grid for preview (first N rows, e.g., 200)
  * detected header row and table region
  * columns and inferred data types

### 7.2 Header Row Detection (Variable Header Rows)

* Auto-detect header rows using heuristics:

  * candidate header rows in first K rows (e.g., 30)
  * score by:

    * number of non-empty cells
    * proportion of string-like cells
    * stability of data types in rows beneath
* Provide UI override:

  * “Use row X as header”
  * Rebuild schema for that sheet

### 7.3 Table-like Sheets Modeling

* For each table-like sheet:

  * sanitize names for SQL tables/columns
  * load into computation engine as a table
  * store schema and mapping to original sheet

### 7.4 Matrix/Report Sheets Modeling (Budgets Pattern)

Some sheets are not a single clean table and may be a **matrix** where labels are in the first 1–2 columns and measures are across columns.

**Normalization approach:** unpivot (“melt”) to a tidy table.

**Example output table:** `budgets_long`

* `department` (derived from section markers)
* `category` (row label)
* `period` (parsed from top headers, e.g., Q1, Q2, H1)
* `amount` (numeric)
* optional: `is_subtotal` (boolean)

**Parsing rules:**

* Detect the “measure header row” where columns contain terms like Q1/Q2/H1 and Budget/Total.
* Treat first 1–2 columns as label columns.
* Maintain `currentDepartment` from section rows.
* For each category row, emit one record per measure column.
* Prefer excluding subtotal rows from analytics (or store with `is_subtotal=true`).

### 7.5 Natural Language to SQL

* LLM takes:

  * compact schema summary (tables, columns, types, sample values)
  * user question
  * strict rules: read-only SQL only
* Output must be structured JSON:

  * `sql`
  * `assumptions` (optional)

### 7.6 SQL Safety & Validation

* Only allow queries that start with `SELECT` or `WITH`.
* Block keywords: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `ATTACH`, `COPY`, `PRAGMA`.
* Enforce limits for raw row returns (e.g., add `LIMIT 200` when needed).
* Timeouts/limits:

  * max execution time (e.g., 2–5 seconds)
  * max returned rows for UI

### 7.7 Execution & Exactness

* Execute SQL with deterministic engine (DuckDB).
* Return results as:

  * scalar answer (when applicable)
  * tabular data for preview
* Never let the LLM compute final numbers.

### 7.8 Attribution (Sheets/Tables Used)

* Determine which tables were referenced by SQL:

  * parse SQL (preferred) or conservative heuristic
* Map tables back to original sheet names.
* Display in answer card: “Computed from: Sheets X, Y”.

### 7.9 Spreadsheet Preview UI

* Tabs for each sheet.
* Grid view:

  * first N rows (paging optional)
  * sticky header
  * type-aware formatting (numbers, dates)
  * row numbers and column letters (A, B, C…)
* Cell inspect (optional, recommended):

  * click a cell to show `Sheet!D14`, value, and formula (if available)

### 7.10 Query UX

* Chat-like history of questions/answers.
* Each answer card includes expandable sections:

  * SQL used
  * sheets/tables used
  * result preview
  * assumptions
  * optional: contributing rows

## 8. Optional: Excel Formulas Support

If workbooks contain formulas:

* Evaluate formulas server-side using a spreadsheet calculation engine (e.g., HyperFormula).
* Store computed values in DuckDB for querying.
* Store formula metadata for transparency:

  * per cell: `sheet`, `address`, `value`, `formula`

**Note:** full Excel compatibility is not guaranteed; document unsupported functions.

## 9. Technical Architecture

### 9.1 Stack

* **Framework:** Next.js (App Router) for frontend + backend.
* **Excel parsing:** `xlsx` (SheetJS).
* **Query engine:** DuckDB (local, deterministic).
* **Validation:** `zod`.
* **SQL parsing (attribution):** `node-sql-parser` (optional).
* **LLM provider:** OpenAI/Anthropic/etc. (configurable).

### 9.2 Data Storage (Local)

* Store per-upload:

  * `./data/<uploadId>.duckdb` (tables)
  * `./data/<uploadId>.manifest.json` (schema + mappings)
  * optional previews: `./data/<uploadId>.preview.<sheet>.json`

### 9.3 Separation of Concerns

* Parsing: read workbook, detect structures.
* Modeling: convert sheets into query-ready tables.
* Querying: NLQ to SQL, validation, execution.
* UI: preview grid, schema panel, Q&A panel.

## 10. API Endpoints

### POST `/api/upload`

* Input: multipart form-data (`file`)
* Output:

  * `uploadId`
  * `schemaSummary`
  * `sheets` metadata

### GET `/api/schema?uploadId=...`

* Output: schema + sheet/table mappings

### GET `/api/sheet?uploadId=...&sheet=...&limit=...&offset=...`

* Output: grid slice for UI preview

### POST `/api/query`

* Input: `{ uploadId, question }`
* Output:

  * `answer`
  * `sql`
  * `tablesUsed` / `sheetsUsed`
  * `assumptions` (optional)
  * `resultPreview`

### Optional GET `/api/cell?uploadId=...&sheet=...&addr=...`

* Output: `{ value, formula? }`

## 11. UI Requirements

### Layout

* Left: workbook info + sheet list + schema summary.
* Center: sheet grid preview.
* Right: Q&A panel with history.

### Controls

* Per sheet:

  * detected header row display
  * override header row
  * (if applicable) mark as matrix/report and show normalized preview

### Transparency

* Every answer shows:

  * computed value(s)
  * SQL used
  * contributing sheets
  * preview of result rows

## 12. Known Limitations

* Complex spreadsheets with merged cells, multi-row headers, or embedded subtables may require manual header override.
* Matrix/report parsing relies on heuristics (department markers, subtotal naming).
* Formula evaluation (if enabled) may not support all Excel functions.
* Very large workbooks may be slow without optimization (future: Parquet, incremental loading).

## 13. Testing Plan

* Unit tests:

  * header row detection
  * budgets matrix normalization
  * SQL safety validator
* Integration tests:

  * upload → schema → query
  * attribution correctness
* Golden tests:

  * compare known query outputs against expected numeric results

## 14. README Requirements

* Setup steps:

  * Node version
  * install commands
  * env vars for LLM provider
  * run locally
* Architectural overview (pipeline + key modules)
* Known limitations and future improvements

## 15. Future Enhancements

* What-if analysis (temporary cell overrides with recalculation).
* Relationship inference across sheets (join suggestions).
* Smarter multi-table detection within a single sheet.
* Export query results to CSV.
