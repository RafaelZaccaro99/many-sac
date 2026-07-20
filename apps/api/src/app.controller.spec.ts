import { ServiceUnavailableException } from "@nestjs/common";
import { AppController } from "./app.controller";

function buildController(overrides: { dbOk?: boolean; redisOk?: boolean } = {}) {
  const { dbOk = true, redisOk = true } = overrides;

  const prisma = {
    $queryRaw: jest.fn().mockImplementation(async () => {
      if (!dbOk) throw new Error("connection refused");
      return [{ "?column?": 1 }];
    }),
  } as any;

  const executionQueue = {
    client: Promise.resolve({
      info: jest.fn().mockImplementation(async () => {
        if (!redisOk) throw new Error("connection refused");
        return "redis_version:7.0.0";
      }),
    }),
  } as any;

  return new AppController(prisma, executionQueue);
}

describe("AppController.health", () => {
  it("returns ok when both the database and Redis respond", async () => {
    const controller = buildController();
    await expect(controller.health()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok", redis: "ok" },
    });
  });

  it("throws a 503 with the check breakdown when the database is down", async () => {
    const controller = buildController({ dbOk: false });
    await expect(controller.health()).rejects.toThrow(ServiceUnavailableException);
    try {
      await controller.health();
      fail("expected health() to throw");
    } catch (err: any) {
      expect(err.getResponse()).toEqual({ status: "degraded", checks: { database: "down", redis: "ok" } });
    }
  });

  it("throws a 503 when Redis is down even if the database is fine", async () => {
    const controller = buildController({ redisOk: false });
    try {
      await controller.health();
      fail("expected health() to throw");
    } catch (err: any) {
      expect(err.getResponse()).toEqual({ status: "degraded", checks: { database: "ok", redis: "down" } });
    }
  });
});
