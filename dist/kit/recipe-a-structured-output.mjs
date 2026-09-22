/** Recipe A: structured output and exact policy.
 *
 * This overlay keeps schema, arithmetic and identifier policy in code. Replace
 * the example supplier list and invoice fields with the rules your application
 * already owns; keep the exported function names and labelled case shape.
 */

const APPROVED_SUPPLIERS = new Set(["supplier-100", "supplier-200"]);

function asCents(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;
}

function invoiceFacts(candidate) {
  if (candidate?.simulate === "technical_failure") {
    throw new Error("labelled recipe A fixture: invoice policy store unavailable");
  }
  const lines = Array.isArray(candidate?.line_items) ? candidate.line_items : [];
  const amounts = lines.map((line) => asCents(line?.amount));
  const total = asCents(candidate?.total);
  const anchors = {
    invoice_id_present: typeof candidate?.invoice_id === "string" && candidate.invoice_id.trim() !== "",
    supplier_approved: APPROVED_SUPPLIERS.has(candidate?.supplier_id),
    line_items_present: lines.length > 0,
    line_amounts_valid: amounts.length > 0 && amounts.every((amount) => amount !== null && amount >= 0),
    total_reconciles: total !== null && amounts.every((amount) => amount !== null)
      && amounts.reduce((sum, amount) => sum + amount, 0) === total,
  };
  return anchors;
}

export function runHardCheck(candidate) {
  const anchor_results = invoiceFacts(candidate);
  return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
}

export function scoreQuality(candidate) {
  if (candidate?.simulate === "technical_failure") return 0;
  const optionalFields = [candidate?.currency, candidate?.purchase_order, candidate?.summary];
  return optionalFields.filter((value) => typeof value === "string" && value.trim() !== "").length / optionalFields.length;
}

export const labelledCases = [
  {
    id: "a-pass-reconciled-invoice",
    label: "approved supplier and exact line-item total pass",
    candidate: {
      invoice_id: "inv-100",
      supplier_id: "supplier-100",
      currency: "USD",
      purchase_order: "po-42",
      summary: "Two approved items",
      line_items: [{ amount: 12.5 }, { amount: 7.5 }],
      total: 20,
    },
    expect: {
      is_correct: true,
      quality_score: { min: 0.9 },
      anchor_results: { supplier_approved: true, total_reconciles: true },
    },
  },
  {
    id: "a-reject-total-mismatch",
    label: "a total that does not equal the line items is rejected",
    candidate: {
      invoice_id: "inv-101",
      supplier_id: "supplier-100",
      currency: "USD",
      line_items: [{ amount: 12.5 }, { amount: 7.5 }],
      total: 19,
    },
    expect: { is_correct: false, anchor_results: { total_reconciles: false } },
  },
  {
    id: "a-technical-policy-store",
    label: "an unavailable policy store is a technical failure with no verdict",
    candidate: { simulate: "technical_failure" },
    expect: { technical_failure: { status: 500 } },
  },
];
