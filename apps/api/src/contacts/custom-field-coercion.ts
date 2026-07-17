import { BadRequestException } from "@nestjs/common";
import { CustomFieldType, Prisma } from "@prisma/client";

export interface CoercedFieldValue {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueJson: Prisma.InputJsonValue | typeof Prisma.DbNull | typeof Prisma.JsonNull;
}

export interface StoredFieldValueRow {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueJson: Prisma.JsonValue | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/;
const EMPTY: CoercedFieldValue = {
  valueText: null,
  valueNumber: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: Prisma.DbNull,
};

export function coerceCustomFieldValue(type: CustomFieldType, raw: unknown): CoercedFieldValue {
  switch (type) {
    case CustomFieldType.TEXT:
      assertType(typeof raw === "string", "TEXT");
      return { ...EMPTY, valueText: raw as string };

    case CustomFieldType.EMAIL: {
      assertType(typeof raw === "string" && EMAIL_RE.test(raw), "EMAIL");
      return { ...EMPTY, valueText: raw as string };
    }

    case CustomFieldType.PHONE:
      assertType(typeof raw === "string" && raw.trim().length > 0, "PHONE");
      return { ...EMPTY, valueText: raw as string };

    case CustomFieldType.URL:
      assertType(typeof raw === "string" && URL_RE.test(raw), "URL");
      return { ...EMPTY, valueText: raw as string };

    case CustomFieldType.ENUM:
      assertType(typeof raw === "string" && raw.trim().length > 0, "ENUM");
      return { ...EMPTY, valueText: raw as string };

    case CustomFieldType.NUMBER: {
      const num = typeof raw === "number" ? raw : Number(raw);
      assertType(typeof raw !== "boolean" && Number.isFinite(num), "NUMBER");
      return { ...EMPTY, valueNumber: num };
    }

    case CustomFieldType.BOOLEAN:
      assertType(typeof raw === "boolean", "BOOLEAN");
      return { ...EMPTY, valueBoolean: raw as boolean };

    case CustomFieldType.DATE:
    case CustomFieldType.DATETIME: {
      const date = raw instanceof Date ? raw : new Date(raw as string);
      assertType(typeof raw === "string" || raw instanceof Date, type);
      assertType(!Number.isNaN(date.getTime()), type);
      return { ...EMPTY, valueDate: date };
    }

    case CustomFieldType.JSON:
      return { ...EMPTY, valueJson: raw === null ? Prisma.JsonNull : (raw as Prisma.InputJsonValue) };

    default:
      throw new BadRequestException(`Unsupported custom field type: ${type}`);
  }
}

function assertType(condition: boolean, type: CustomFieldType | string): asserts condition {
  if (!condition) {
    throw new BadRequestException(`Value is not valid for field type ${type}`);
  }
}

export function decodeCustomFieldValue(type: CustomFieldType, row: StoredFieldValueRow): unknown {
  switch (type) {
    case CustomFieldType.NUMBER:
      return row.valueNumber;
    case CustomFieldType.BOOLEAN:
      return row.valueBoolean;
    case CustomFieldType.DATE:
    case CustomFieldType.DATETIME:
      return row.valueDate;
    case CustomFieldType.JSON:
      return row.valueJson;
    default:
      return row.valueText;
  }
}
