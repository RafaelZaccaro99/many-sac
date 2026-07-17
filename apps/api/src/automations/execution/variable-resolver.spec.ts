import { renderTemplate, resolveVariableValue, VariableContext } from "./variable-resolver";

const ctx: VariableContext = {
  contact: { firstName: "Ana", lastName: "Silva", primaryEmail: "ana@example.com", primaryPhone: null },
  workspaceName: "Acme",
  assigneeName: "Bruno",
  customFieldValues: { product_interest: "CRM" },
};

describe("resolveVariableValue", () => {
  it("resolves built-in contact and workspace variables", () => {
    expect(resolveVariableValue("contact.first_name", ctx)).toBe("Ana");
    expect(resolveVariableValue("workspace.name", ctx)).toBe("Acme");
    expect(resolveVariableValue("conversation.assignee.name", ctx)).toBe("Bruno");
  });

  it("resolves a null field as null, not throwing", () => {
    expect(resolveVariableValue("contact.primary_phone", ctx)).toBeNull();
  });

  it("resolves a custom field by key", () => {
    expect(resolveVariableValue("contact.custom.product_interest", ctx)).toBe("CRM");
  });

  it("resolves an undefined custom field as null", () => {
    expect(resolveVariableValue("contact.custom.does_not_exist", ctx)).toBeNull();
  });

  it("returns undefined for a completely unknown path", () => {
    expect(resolveVariableValue("something.made_up", ctx)).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  it("substitutes multiple variables in one string", () => {
    expect(renderTemplate("Hi {{contact.first_name}}, welcome to {{workspace.name}}!", ctx)).toBe(
      "Hi Ana, welcome to Acme!",
    );
  });

  it("falls back to an empty string for a missing variable instead of breaking", () => {
    expect(renderTemplate("Call {{contact.primary_phone}} now", ctx)).toBe("Call  now");
    expect(renderTemplate("{{something.made_up}}", ctx)).toBe("");
  });

  it("leaves plain text without variables untouched", () => {
    expect(renderTemplate("no variables here", ctx)).toBe("no variables here");
  });
});
