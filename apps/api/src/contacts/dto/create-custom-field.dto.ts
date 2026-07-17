import { IsEnum, IsString, Matches, MaxLength } from "class-validator";
import { CustomFieldType } from "@prisma/client";

export class CreateCustomFieldDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: "key must be lowercase snake_case starting with a letter (e.g. product_interest)",
  })
  key!: string;

  @IsString()
  @MaxLength(100)
  label!: string;

  @IsEnum(CustomFieldType)
  type!: CustomFieldType;
}
