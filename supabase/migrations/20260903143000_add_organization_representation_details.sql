/*
  # Organization representation details

  Stores the KRS representation rule separately from the person selected as the
  primary representative. Additional signers continue to be stored in
  organization_decision_makers with can_sign_contracts = true.
*/

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS representation_type text,
ADD COLUMN IF NOT EXISTS representation_rule text,
ADD COLUMN IF NOT EXISTS representation_basis text,
ADD COLUMN IF NOT EXISTS representation_verified_at date;

ALTER TABLE organizations
DROP CONSTRAINT IF EXISTS organizations_representation_type_check;

ALTER TABLE organizations
ADD CONSTRAINT organizations_representation_type_check
CHECK (
  representation_type IS NULL
  OR representation_type IN ('sole', 'joint', 'joint_with_proxy', 'proxy', 'other')
);

COMMENT ON COLUMN organizations.representation_type IS
  'Structured representation type: sole, joint, joint_with_proxy, proxy or other.';
COMMENT ON COLUMN organizations.representation_rule IS
  'Exact representation rule verified in KRS section 2 or another authoritative register.';
COMMENT ON COLUMN organizations.representation_basis IS
  'Source and basis used to verify representation, for example KRS section 2.';
COMMENT ON COLUMN organizations.representation_verified_at IS
  'Date when the representation rule was last verified.';
