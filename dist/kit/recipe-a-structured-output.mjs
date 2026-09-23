/** Recipe A: structured output and exact policy.
 *
 * This overlay keeps schema, arithmetic and identifier policy in code. Replace
 * the example supplier list and invoice fields with the rules your application
 * already owns; keep the exported function names and labelled case shape.
 */

const APPROVED_SUPPLIERS = new Set(["supplier-100", "supplier-200"]);

// Amounts arrive as integer minor units. Never round a floating-point amount
// into a valid invoice; convert decimal input before it reaches this check.
function validCents(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function invoiceFacts(candidate) {
  const lines = Array.isArray(candidate?.line_items) ? candidate.line_items : [];
  const amounts = lines.map((line) => line?.amount_cents);
  const total = candidate?.total_cents;
  const amountsValid = amounts.length > 0 && amounts.every(validCents);
  const anchors = {
    invoice_id_present: typeof candidate?.invoice_id === "string" && candidate.invoice_id.trim() !== "",
    supplier_approved: APPROVED_SUPPLIERS.has(candidate?.supplier_id),
    line_items_present: lines.length > 0,
    line_amounts_valid: amountsValid,
    total_reconciles: validCents(total) && amountsValid
      && amounts.reduce((sum, amount) => sum + BigInt(amount), 0n) === BigInt(total),
  };
  return anchors;
}

export function runHardCheck(candidate) {
  const anchor_results = invoiceFacts(candidate);
  return { is_correct: Object.values(anchor_results).every(Boolean), anchor_results };
}

export function scoreQuality(candidate) {
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
      line_items: [{ amount_cents: 1250 }, { amount_cents: 750 }],
      total_cents: 2000,
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
      line_items: [{ amount_cents: 1250 }, { amount_cents: 750 }],
      total_cents: 1900,
    },
    expect: { is_correct: false, anchor_results: { total_reconciles: false } },
  },
  {
    id: "a-reject-fractional-cents",
    label: "fractional minor units are rejected instead of rounded",
    candidate: {
      invoice_id: "inv-102", supplier_id: "supplier-100",
      line_items: [{ amount_cents: 1.005 }], total_cents: 1,
    },
    expect: { is_correct: false, anchor_results: { line_amounts_valid: false, total_reconciles: false } },
  },
  {
    id: "a-technical-policy-store",
    label: "an unavailable policy store is a technical failure with no verdict",
    candidate: { invoice_id: "inv-test-fault" },
    fault: "check_throws",
    expect: { technical_failure: { status: 500 } },
  },
];
