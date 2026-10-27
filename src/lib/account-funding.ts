export interface AccountFundingBalance {
  micro: number;
  plan_micro?: number;
  comp_micro?: number;
  available_micro?: number;
  available_plan_micro?: number;
  available_comp_micro?: number;
  reserved_micro?: number;
  pending_micro?: number;
}

const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** The three availability fields are one server snapshot; never mix versions. */
export function accountFunding(balance?: AccountFundingBalance | null) {
  const gross = balance?.micro ?? 0, grossPlan = balance?.plan_micro ?? 0, grossCompensation = balance?.comp_micro ?? 0;
  const explicit = integer(balance?.available_micro) && integer(balance?.available_plan_micro) && integer(balance?.available_comp_micro);
  const total = explicit ? balance!.available_micro! : gross;
  const plan = explicit ? balance!.available_plan_micro! : grossPlan;
  const compensation = explicit ? balance!.available_comp_micro! : grossCompensation;
  return {
    explicit, gross, total, plan, compensation,
    independent: total - plan - compensation,
    nonPlan: total - plan,
    reserved: integer(balance?.reserved_micro) && balance!.reserved_micro! >= 0 ? balance!.reserved_micro! : 0,
    pending: integer(balance?.pending_micro) && balance!.pending_micro! >= 0 ? balance!.pending_micro! : 0,
  };
}
