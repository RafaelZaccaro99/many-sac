export interface VariableContext {
  contact: {
    firstName: string | null;
    lastName: string | null;
    primaryEmail: string | null;
    primaryPhone: string | null;
  };
  workspaceName: string;
  assigneeName?: string | null;
  customFieldValues: Record<string, unknown>;
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const CUSTOM_FIELD_PREFIX = "contact.custom.";

/**
 * Resolves a single `{{...}}` variable path to its raw value (not stringified) -
 * shared by template rendering (send_message) and condition evaluation, so both
 * agree on what a variable means.
 */
export function resolveVariableValue(path: string, ctx: VariableContext): unknown {
  switch (path) {
    case "contact.first_name":
      return ctx.contact.firstName;
    case "contact.last_name":
      return ctx.contact.lastName;
    case "contact.primary_email":
      return ctx.contact.primaryEmail;
    case "contact.primary_phone":
      return ctx.contact.primaryPhone;
    case "workspace.name":
      return ctx.workspaceName;
    case "conversation.assignee.name":
      return ctx.assigneeName ?? null;
    default:
      if (path.startsWith(CUSTOM_FIELD_PREFIX)) {
        const key = path.slice(CUSTOM_FIELD_PREFIX.length);
        return ctx.customFieldValues[key] ?? null;
      }
      return undefined;
  }
}

/**
 * Renders a message template. A variable that resolves to null/undefined falls
 * back to an empty string rather than throwing - a missing field must never
 * break the execution (per the compliance-by-design / resilience requirements).
 */
export function renderTemplate(template: string, ctx: VariableContext): string {
  return template.replace(VARIABLE_PATTERN, (_match, path: string) => {
    const value = resolveVariableValue(path, ctx);
    return value === null || value === undefined ? "" : String(value);
  });
}
