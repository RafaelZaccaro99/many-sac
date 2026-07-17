import { IsDefined } from "class-validator";

// The graph's internal node/edge shape is validated by graph-validator.ts, not
// class-validator - a fixed DTO shape can't express "valid node type + matching
// data fields", and duplicating that logic here would drift from the real check.
export class UpdateDraftDto {
  @IsDefined()
  graph!: unknown;
}
