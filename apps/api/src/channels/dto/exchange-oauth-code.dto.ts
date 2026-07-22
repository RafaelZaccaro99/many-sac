import { IsString, MinLength } from "class-validator";

export class ExchangeOAuthCodeDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  redirectUri!: string;
}
