import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";

const BCRYPT_ROUNDS = 12;
// Used to keep login timing constant when the account doesn't exist, so the
// response doesn't leak whether an email is registered.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO0d3l4uH6b6z2y6nB2y3T9m9y0zJj9Fu";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  async signup(dto: SignupDto): Promise<{ user: AuthenticatedUser; accessToken: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
    });

    await this.auditService.record({
      workspaceId: null,
      actorUserId: user.id,
      action: "user.signup",
      targetType: "User",
      targetId: user.id,
    });

    return this.buildSession(user);
  }

  async login(dto: LoginDto): Promise<{ user: AuthenticatedUser; accessToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const passwordMatches = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches) {
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.auditService.record({
      workspaceId: null,
      actorUserId: user.id,
      action: "user.login",
      targetType: "User",
      targetId: user.id,
    });

    return this.buildSession(user);
  }

  private buildSession(user: { id: string; email: string; name: string }) {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
    };
  }
}
