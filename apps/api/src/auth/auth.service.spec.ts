import { ConflictException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  function buildService() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    } as any;
    const jwtService = { sign: jest.fn().mockReturnValue("signed-jwt") } as any;
    const auditService = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new AuthService(prisma, jwtService, auditService);
    return { service, prisma, jwtService, auditService };
  }

  describe("signup", () => {
    it("creates a user, hashes the password, and records an audit entry", async () => {
      const { service, prisma, auditService } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }: any) => ({
        id: "user-1",
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
      }));

      const result = await service.signup({ email: "a@b.com", password: "supersecret1", name: "Ana" });

      expect(result.accessToken).toBe("signed-jwt");
      expect(result.user).toEqual({ id: "user-1", email: "a@b.com", name: "Ana" });
      expect(prisma.user.create.mock.calls[0][0].data.passwordHash).not.toBe("supersecret1");
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "user.signup", actorUserId: "user-1" }),
      );
    });

    it("rejects signup when the email is already registered", async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: "existing" });

      await expect(
        service.signup({ email: "a@b.com", password: "supersecret1", name: "Ana" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("login", () => {
    it("logs in with correct credentials", async () => {
      const { service, prisma } = buildService();
      const passwordHash = await bcrypt.hash("correct-password", 4);
      prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Ana", passwordHash });

      const result = await service.login({ email: "a@b.com", password: "correct-password" });
      expect(result.accessToken).toBe("signed-jwt");
    });

    it("rejects an unknown email without revealing that it doesn't exist", async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: "nobody@b.com", password: "whatever123" })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects a wrong password", async () => {
      const { service, prisma } = buildService();
      const passwordHash = await bcrypt.hash("correct-password", 4);
      prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Ana", passwordHash });

      await expect(service.login({ email: "a@b.com", password: "wrong-password" })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
