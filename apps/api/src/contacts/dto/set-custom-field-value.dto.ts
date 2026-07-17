import { IsDefined } from "class-validator";

// `value`'s shape depends on the field definition's declared type (text, number,
// boolean, date, json, ...), so it's validated and coerced in the service layer
// rather than via a fixed class-validator decorator here.
export class SetCustomFieldValueDto {
  @IsDefined()
  value!: unknown;
}
