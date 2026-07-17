import { IsString, Matches, MaxLength } from "class-validator";

export class CreateTagDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[^\s].*[^\s]$|^[^\s]$/, { message: "name cannot start or end with whitespace" })
  name!: string;
}
