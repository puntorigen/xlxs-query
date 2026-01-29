# LLM-Assisted Matrix Sheet Analysis

## Problem Statement

Matrix/report-style spreadsheets often contain both **base data** and **pre-calculated aggregates**:

```
                    Q1 Budget   Q2 Budget   H1 Total
SALES
  Salaries          180,000     185,000     365,000   ← H1 = Q1 + Q2
  Travel             25,000      30,000      55,000
Sales Total         220,000     233,000     453,000   ← Sum of above rows
```

When we normalize this to a queryable format, including ALL data causes **double-counting**:
- Query: "Total engineering budget across periods"
- Wrong: Q1 + Q2 + H1 Total = 2,000,000 (double-counted)
- Correct: Q1 + Q2 = 1,000,000

### Why Not Use Regex?

Current approach uses hardcoded patterns like `/total/i`, `/sum/i`, etc. Problems:
1. **Language-dependent** - Won't work for Spanish ("Suma"), French ("Somme"), German ("Gesamt")
2. **Brittle** - Can't anticipate all variations and domain-specific terms
3. **Not leveraging AI** - We have an LLM, we should use its semantic understanding

---

## Solution: LLM-Assisted Aggregate Detection

Use the LLM to analyze **numeric patterns** (not labels) to identify aggregates.

### Key Insight

The LLM can deduce from the **math** that:
- Column "H1 Total" contains values that equal Q1 + Q2
- Row "Sales Total" contains values that sum the rows above

This works regardless of what language the labels are in.

---

## Implementation Plan

### Phase 1: LLM Analysis Function

**File:** `lib/llm/matrix-analyzer.ts`

```typescript
interface MatrixAnalysis {
  aggregateColumns: number[];  // Column indices that are calculated totals
  aggregateRows: number[];     // Row indices that are subtotals/totals
  confidence: number;
  notes?: string;
}

async function analyzeMatrixStructure(
  headers: CellValue[],
  dataRows: CellValue[][],
  periodHeaderRow: number
): Promise<MatrixAnalysis>
```

**Prompt Design:**
- Send headers + first 15-20 rows of data
- Ask LLM to identify columns/rows where values = sum of other columns/rows
- Request JSON response with indices

**Example Prompt:**
```
Analyze this spreadsheet matrix structure to identify calculated aggregates.

Headers (row 2): [null, null, "Q1 Budget", "Q2 Budget", "H1 Total"]

Data rows:
Row 3: ["SALES", null, null, null, null]
Row 4: [null, "Salaries", 180000, 185000, 365000]
Row 5: [null, "Travel", 25000, 30000, 55000]
Row 6: [null, "Tools", 15000, 18000, 33000]
Row 7: ["Sales Total", null, 220000, 233000, 453000]

Identify by analyzing the NUMBERS (not labels):
1. Which columns contain values that are sums of other columns?
2. Which rows contain values that are sums of other rows?

Return JSON:
{
  "aggregateColumns": [<indices>],
  "aggregateRows": [<indices>],
  "reasoning": "<brief explanation>"
}
```

---

### Phase 2: Update Matrix Normalizer

**File:** `lib/excel/matrix-normalizer.ts`

#### 2.1 Add `is_aggregate` Column

Update the normalized schema from:
```
department | category | period | amount
```

To:
```
department | category | period | amount | is_aggregate
```

#### 2.2 Mark Aggregates During Normalization

```typescript
function normalizeMatrix(
  data: CellValue[][],
  config: MatrixConfig,
  analysis: MatrixAnalysis  // NEW: from LLM
): NormalizedMatrix {
  // ... existing normalization logic ...
  
  for (const periodCol of periodColumns) {
    const isAggregateColumn = analysis.aggregateColumns.includes(periodCol.index);
    const isAggregateRow = analysis.aggregateRows.includes(rowIdx);
    
    normalizedRow.push(isAggregateColumn || isAggregateRow);
  }
}
```

---

### Phase 3: Update Processor

**File:** `lib/excel/processor.ts`

#### 3.1 Call LLM Analysis for Matrix Sheets

```typescript
async function processMatrixSheet(...) {
  // NEW: Get LLM analysis before normalizing
  const analysis = await analyzeMatrixStructure(
    data[headerRow],
    data.slice(headerRow + 1),
    headerRow
  );
  
  // Pass analysis to normalizer
  const normalized = normalizeMatrix(data, config, analysis);
}
```

Note: The processor will need to become async to support LLM calls.

---

### Phase 4: Update Schema Context

**File:** `lib/llm/schema-context.ts`

#### 4.1 Include Aggregate Information in Query Prompts

When generating SQL, include context about the `is_aggregate` column:

```typescript
function buildSchemaContext(schema: SchemaInfo): string {
  // ... existing schema description ...
  
  // Add for tables with is_aggregate column
  if (table has is_aggregate column) {
    context += `
    Note: The 'is_aggregate' column indicates pre-calculated totals/subtotals.
    - For accurate sums/counts, filter: WHERE is_aggregate = false
    - To query specific totals directly, filter: WHERE period = 'H1 Total'
    `;
  }
}
```

---

### Phase 5: Update Types

**File:** `lib/types.ts`

```typescript
interface ColumnInfo {
  name: string;
  originalName: string;
  type: 'VARCHAR' | 'INTEGER' | 'DOUBLE' | 'BOOLEAN' | ...;
  nullable: boolean;
  sampleValues: CellValue[];
  isAggregateIndicator?: boolean;  // NEW: marks the is_aggregate column
}
```

---

## Task Checklist

- [x] **Task 1:** Create `lib/llm/matrix-analyzer.ts` with LLM analysis function
- [x] **Task 2:** Design and test the analysis prompt
- [x] **Task 3:** Update `lib/excel/matrix-normalizer.ts` to add `is_aggregate` column
- [x] **Task 4:** Update `lib/excel/processor.ts` to call LLM analysis for matrix sheets
- [x] **Task 5:** Update `lib/llm/schema-context.ts` to include aggregate guidance
- [x] **Task 6:** Update types as needed
- [ ] **Task 7:** Test with company_data.xlsx Budgets sheet
- [ ] **Task 8:** Verify queries like "total engineering budget" return correct values

---

## Expected Behavior After Implementation

### Query: "What is the total engineering budget?"

**Generated SQL:**
```sql
SELECT SUM(amount) AS total_budget
FROM budgets
WHERE department = 'Engineering'
  AND is_aggregate = false  -- Excludes H1 Total to avoid double-counting
```

**Result:** $1,000,000 (correct)

### Query: "What is the H1 total for engineering?"

**Generated SQL:**
```sql
SELECT amount
FROM budgets
WHERE department = 'Engineering'
  AND period = 'H1 Total'
```

**Result:** $1,000,000 (directly from pre-calculated column)

---

## Error Handling

1. **LLM fails to respond:** Fall back to no aggregate detection (current behavior)
2. **LLM returns invalid JSON:** Log warning, use empty arrays
3. **LLM misidentifies aggregates:** Queries may have some inaccuracy, but won't break

---

## Performance Considerations

- **When:** One LLM call per matrix sheet during upload
- **Latency:** ~1-2 seconds per sheet
- **Cost:** Small prompt/response, ~$0.001 per sheet
- **Parallelization:** Could analyze multiple sheets concurrently

---

## Benefits

1. **Language-agnostic** - Works on files in any language
2. **Data-driven** - Uses numeric patterns, not string matching
3. **Preserves all data** - Can query both base data and aggregates
4. **Demonstrates AI capabilities** - Aligns with "Spreadsheet Intelligence" theme
5. **Robust** - Adapts to different spreadsheet conventions
