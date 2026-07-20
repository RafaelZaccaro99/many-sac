import { MetricsService } from "./metrics.service";

function buildService() {
  const prisma = {
    automationExecution: {
      groupBy: jest.fn().mockResolvedValue([
        { status: "COMPLETED", _count: { _all: 10 } },
        { status: "FAILED_PERMANENT", _count: { _all: 2 } },
      ]),
    },
    outboxEvent: {
      count: jest.fn().mockResolvedValue(3),
      findFirst: jest.fn().mockResolvedValue({ createdAt: new Date(Date.now() - 5000) }),
    },
    automationStepExecution: {
      count: jest.fn().mockResolvedValue(4),
    },
  } as any;

  const executionQueue = { getJobCounts: jest.fn().mockResolvedValue({ waiting: 1, active: 2, failed: 0 }) } as any;
  const deadLetterQueue = { getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, failed: 5 }) } as any;

  const service = new MetricsService(prisma, executionQueue, deadLetterQueue);
  return { service, prisma, executionQueue, deadLetterQueue };
}

describe("MetricsService.collect", () => {
  it("reshapes execution counts by status into a flat map", async () => {
    const { service } = buildService();
    const metrics = await service.collect();

    expect(metrics.executionsByStatus).toEqual({ COMPLETED: 10, FAILED_PERMANENT: 2 });
  });

  it("includes the execution queue and dead-letter queue job counts", async () => {
    const { service } = buildService();
    const metrics = await service.collect();

    expect(metrics.executionQueue).toEqual({ waiting: 1, active: 2, failed: 0 });
    expect(metrics.deadLetterQueue).toEqual({ waiting: 0, active: 0, failed: 5 });
  });

  it("reports the outbox backlog size and the age of the oldest unprocessed event", async () => {
    const { service } = buildService();
    const metrics = await service.collect();

    expect(metrics.outbox.unprocessed).toBe(3);
    expect(metrics.outbox.oldestUnprocessedAgeMs).toBeGreaterThanOrEqual(5000);
  });

  it("reports null for the oldest unprocessed age when the outbox is empty", async () => {
    const { service, prisma } = buildService();
    prisma.outboxEvent.findFirst.mockResolvedValue(null);

    const metrics = await service.collect();

    expect(metrics.outbox.oldestUnprocessedAgeMs).toBeNull();
  });

  it("counts FAILED steps whose error matches a known Policy Engine denial message", async () => {
    const { service, prisma } = buildService();
    const metrics = await service.collect();

    expect(metrics.policyDenialsTotal).toBe(4);
    expect(prisma.automationStepExecution.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          error: { in: expect.arrayContaining(["Contact has opted out of messaging", "24-hour messaging window is closed for this contact"]) },
        }),
      }),
    );
  });
});
