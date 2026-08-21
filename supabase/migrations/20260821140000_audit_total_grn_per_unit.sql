-- Align pricing_sheet_audit with price_sheet_details Total GRN columns
-- so lock history can persist Total GRN ₹/unit under the matching grid header.

ALTER TABLE public.pricing_sheet_audit
  ADD COLUMN IF NOT EXISTS total_grn NUMERIC(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS total_grn_per_unit NUMERIC(12, 2) NULL;
