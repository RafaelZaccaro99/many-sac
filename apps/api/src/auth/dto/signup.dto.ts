import { IsEmail, IsString, MinLength } from "class-validator";

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: "password must be at least 10 characters" })
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
