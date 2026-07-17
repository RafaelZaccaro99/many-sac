import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { ChannelProvider } from "@prisma/client";

export class RecordConsentDto {
  @IsEnum(ChannelProvider)
  channel!: ChannelProvider;

  @IsString()
  @MaxLength(100)
  purpose!: string;

  @IsString()
  @MaxLength(100)
  source!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  consentText?: string;
}
