import { UnauthorizedException } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";

function buildController(configuredToken: string) {
  const metricsService = { collect: jest.fn().mockResolvedValue({ generatedAt: "2026-01-01T00:00:00.000Z" }) } as any;
  const configService = { get: jest.fn().mockReturnValue(configuredToken) } as any;
  const controller = new MetricsController(metricsService, configService);
  return { controller, metricsService };
}

describe("MetricsController.getMetrics", () => {
  it("returns the collected metrics when the token header matches METRICS_TOKEN", async () => {
    const { controller, metricsService } = buildController("secret-token");

    const result = await controller.getMetrics("secret-token");

    expect(result).toEqual({ generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(metricsService.collect).toHaveBeenCalled();
  });

  it("rejects when the token header is missing", async () => {
    const { controller } = buildController("secret-token");
    await expect(controller.getMetrics(undefined)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects when the token header doesn't match", async () => {
    const { controller } = buildController("secret-token");
    await expect(controller.getMetrics("wrong-token")).rejects.toThrow(UnauthorizedException);
  });

  it("fails closed when METRICS_TOKEN isn't configured, even with a matching empty header", async () => {
    const { controller } = buildController("");
    await expect(controller.getMetrics("")).rejects.toThrow(UnauthorizedException);
  });
});
