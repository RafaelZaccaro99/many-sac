import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { ChannelProvider } from "@prisma/client";

export class ConnectChannelDto {
  @IsEnum(ChannelProvider)
  provider!: ChannelProvider;

  @IsString()
  @MinLength(1)
  externalAccountId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsString()
  @MinLength(1)
  accessToken!: string;
}
