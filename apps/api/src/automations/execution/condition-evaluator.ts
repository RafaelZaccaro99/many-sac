import { resolveVariableValue, VariableContext } from "./variable-resolver";

export interface ConditionData {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "greater_than"
    | "less_than"
    | "exists"
    | "not_exists"
    | "before"
    | "after"
    | "in"
    | "not_in";
  value?: unknown;
}

/** Evaluates one condition node's `data` against the current variable context. */
export function evaluateCondition(data: ConditionData, ctx: VariableContext): boolean {
  const actual = resolveVariableValue(data.field, ctx);

  switch (data.operator) {
    case "exists":
      return actual !== null && actual !== undefined;
    case "not_exists":
      return actual === null || actual === undefined;
    case "equals":
      return actual === data.value;
    case "not_equals":
      return actual !== data.value;
    case "contains":
      return typeof actual === "string" && typeof data.value === "string" && actual.includes(data.value);
    case "not_contains":
      return !(typeof actual === "string" && typeof data.value === "string" && actual.includes(data.value));
    case "greater_than":
      return typeof actual === "number" && typeof data.value === "number" && actual > data.value;
    case "less_than":
      return typeof actual === "number" && typeof data.value === "number" && actual < data.value;
    case "before":
      return isDate(actual) && isDate(data.value) && new Date(actual).getTime() < new Date(data.value as string).getTime();
    case "after":
      return isDate(actual) && isDate(data.value) && new Date(actual).getTime() > new Date(data.value as string).getTime();
    case "in":
      return Array.isArray(data.value) && data.value.includes(actual);
    case "not_in":
      return Array.isArray(data.value) && !data.value.includes(actual);
    default:
      return false;
  }
}

function isDate(value: unknown): value is string | Date {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  return !Number.isNaN(new Date(value).getTime());
}
