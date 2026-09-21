/**
 * The listing example as a kit input. Copy this file and replace the
 * two functions with the check you already run, then write labelled cases
 * from your own outputs: each names a candidate and the verdict your check
 * actually gives it. Keep at least one it passes and one it rejects.
 */

import { listingExtractionHardCheck, listingQualityScore } from "./handler.mjs";

export const runHardCheck = listingExtractionHardCheck;
export const scoreQuality = listingQualityScore;

export const labelledCases = [
  {
    id: "a-missing-price",
    label: "missing extracted_fields.price is rejected even with high-quality text",
    candidate: { summary: "A".repeat(200), extracted_fields: {} },
    expect: {
      is_correct: false,
      quality_score: { min: 0.9 },
      anchor_results: { has_required_field_price: false },
    },
  },
  {
    id: "b-valid-price-thin-text",
    label: "a valid price passes even with low-quality text",
    candidate: { summary: "ok", extracted_fields: { price: 12 } },
    expect: {
      is_correct: true,
      quality_score: { max: 0.1 },
      anchor_results: { has_required_field_price: true, price_is_positive_number: true },
    },
  },
];
