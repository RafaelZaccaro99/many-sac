import { evaluateCondition } from "./condition-evaluator";
import { VariableContext } from "./variable-resolver";

const ctx: VariableContext = {
  contact: { firstName: "Ana", lastName: null, primaryEmail: "ana@example.com", primaryPhone: null },
  workspaceName: "Acme",
  customFieldValues: { score: 42, plan: "pro" },
};

describe("evaluateCondition", () => {
  it("exists / not_exists", () => {
    expect(evaluateCondition({ field: "contact.first_name", operator: "exists" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "contact.last_name", operator: "exists" }, ctx)).toBe(false);
    expect(evaluateCondition({ field: "contact.last_name", operator: "not_exists" }, ctx)).toBe(true);
  });

  it("equals / not_equals", () => {
    expect(evaluateCondition({ field: "contact.custom.plan", operator: "equals", value: "pro" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "contact.custom.plan", operator: "equals", value: "free" }, ctx)).toBe(false);
    expect(evaluateCondition({ field: "contact.custom.plan", operator: "not_equals", value: "free" }, ctx)).toBe(true);
  });

  it("contains / not_contains on strings", () => {
    expect(evaluateCondition({ field: "contact.primary_email", operator: "contains", value: "example" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "contact.primary_email", operator: "contains", value: "gmail" }, ctx)).toBe(false);
    expect(evaluateCondition({ field: "contact.primary_email", operator: "not_contains", value: "gmail" }, ctx)).toBe(true);
  });

  it("greater_than / less_than on numbers", () => {
    expect(evaluateCondition({ field: "contact.custom.score", operator: "greater_than", value: 10 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "contact.custom.score", operator: "less_than", value: 10 }, ctx)).toBe(false);
  });

  it("in / not_in against an array", () => {
    expect(evaluateCondition({ field: "contact.custom.plan", operator: "in", value: ["pro", "enterprise"] }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "contact.custom.plan", operator: "not_in", value: ["free", "trial"] }, ctx)).toBe(true);
  });

  it("before / after on dates", () => {
    const dateCtx: VariableContext = { ...ctx, customFieldValues: { signup_date: "2026-01-01T00:00:00.000Z" } };
    expect(
      evaluateCondition({ field: "contact.custom.signup_date", operator: "before", value: "2026-06-01T00:00:00.000Z" }, dateCtx),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "contact.custom.signup_date", operator: "after", value: "2026-06-01T00:00:00.000Z" }, dateCtx),
    ).toBe(false);
  });

  it("returns false (not throw) when comparing mismatched types", () => {
    expect(evaluateCondition({ field: "contact.custom.plan", operator: "greater_than", value: 10 }, ctx)).toBe(false);
    expect(evaluateCondition({ field: "contact.custom.score", operator: "contains", value: "4" }, ctx)).toBe(false);
  });
});
