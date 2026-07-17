import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateAutomationDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}
