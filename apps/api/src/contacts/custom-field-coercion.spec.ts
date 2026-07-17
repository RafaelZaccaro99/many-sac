import { BadRequestException } from "@nestjs/common";
import { Prisma, CustomFieldType } from "@prisma/client";
import { coerceCustomFieldValue, decodeCustomFieldValue } from "./custom-field-coercion";

describe("coerceCustomFieldValue", () => {
  it("accepts a valid TEXT value and nulls out the other columns", () => {
    const result = coerceCustomFieldValue(CustomFieldType.TEXT, "hello");
    expect(result.valueText).toBe("hello");
    expect(result.valueNumber).toBeNull();
    expect(result.valueBoolean).toBeNull();
    expect(result.valueDate).toBeNull();
  });

  it("rejects a non-string TEXT value", () => {
    expect(() => coerceCustomFieldValue(CustomFieldType.TEXT, 42)).toThrow(BadRequestException);
  });

  it("accepts a valid EMAIL and rejects a malformed one", () => {
    expect(coerceCustomFieldValue(CustomFieldType.EMAIL, "a@b.com").valueText).toBe("a@b.com");
    expect(() => coerceCustomFieldValue(CustomFieldType.EMAIL, "not-an-email")).toThrow(BadRequestException);
  });

  it("accepts a valid URL and rejects a malformed one", () => {
    expect(coerceCustomFieldValue(CustomFieldType.URL, "https://example.com").valueText).toBe(
      "https://example.com",
    );
    expect(() => coerceCustomFieldValue(CustomFieldType.URL, "ftp:/bad")).toThrow(BadRequestException);
  });

  it("coerces numeric strings for NUMBER but rejects booleans and NaN", () => {
    expect(coerceCustomFieldValue(CustomFieldType.NUMBER, "42").valueNumber).toBe(42);
    expect(coerceCustomFieldValue(CustomFieldType.NUMBER, 3.5).valueNumber).toBe(3.5);
    expect(() => coerceCustomFieldValue(CustomFieldType.NUMBER, true)).toThrow(BadRequestException);
    expect(() => coerceCustomFieldValue(CustomFieldType.NUMBER, "not-a-number")).toThrow(BadRequestException);
  });

  it("requires a strict boolean for BOOLEAN", () => {
    expect(coerceCustomFieldValue(CustomFieldType.BOOLEAN, true).valueBoolean).toBe(true);
    expect(() => coerceCustomFieldValue(CustomFieldType.BOOLEAN, "true")).toThrow(BadRequestException);
  });

  it("parses valid dates for DATE/DATETIME and rejects garbage", () => {
    const result = coerceCustomFieldValue(CustomFieldType.DATE, "2026-01-01T00:00:00.000Z");
    expect(result.valueDate).toBeInstanceOf(Date);
    expect(() => coerceCustomFieldValue(CustomFieldType.DATE, "not-a-date")).toThrow(BadRequestException);
  });

  it("stores arbitrary JSON for JSON and JsonNull for an explicit null", () => {
    const withObject = coerceCustomFieldValue(CustomFieldType.JSON, { a: 1 });
    expect(withObject.valueJson).toEqual({ a: 1 });

    const withNull = coerceCustomFieldValue(CustomFieldType.JSON, null);
    expect(withNull.valueJson).toBe(Prisma.JsonNull);
  });

  it("defaults valueJson to DbNull for non-JSON types", () => {
    const result = coerceCustomFieldValue(CustomFieldType.TEXT, "x");
    expect(result.valueJson).toBe(Prisma.DbNull);
  });
});

describe("decodeCustomFieldValue", () => {
  const emptyRow = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueJson: null };

  it("reads back the column matching the field type", () => {
    expect(decodeCustomFieldValue(CustomFieldType.NUMBER, { ...emptyRow, valueNumber: 7 })).toBe(7);
    expect(decodeCustomFieldValue(CustomFieldType.BOOLEAN, { ...emptyRow, valueBoolean: false })).toBe(false);
    expect(decodeCustomFieldValue(CustomFieldType.TEXT, { ...emptyRow, valueText: "hi" })).toBe("hi");
    const date = new Date();
    expect(decodeCustomFieldValue(CustomFieldType.DATETIME, { ...emptyRow, valueDate: date })).toBe(date);
    expect(decodeCustomFieldValue(CustomFieldType.JSON, { ...emptyRow, valueJson: { a: 1 } })).toEqual({ a: 1 });
  });
});
