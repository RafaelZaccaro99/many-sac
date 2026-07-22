import { ContactsService } from "./contacts.service";

function buildService(contactCount: number) {
  const contacts = Array.from({ length: contactCount }, (_, i) => ({
    id: `contact-${i}`,
    workspaceId: "ws-1",
    createdAt: new Date(2026, 0, 1 + i),
    tags: [],
  }));
  // Service orders desc by createdAt - sort once, matching Prisma's behavior.
  const sorted = [...contacts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const prisma = {
    contact: {
      findMany: jest.fn().mockImplementation(async ({ take, cursor, skip }: any) => {
        let startIndex = 0;
        if (cursor) {
          const idx = sorted.findIndex((c) => c.id === cursor.id);
          startIndex = idx + (skip ?? 0);
        }
        return sorted.slice(startIndex, startIndex + take);
      }),
    },
  } as any;

  const auditService = {} as any;
  const service = new ContactsService(prisma, auditService);
  return { service, prisma, sorted };
}

describe("ContactsService.list", () => {
  it("returns the first page and a nextCursor when more rows exist", async () => {
    const { service, sorted } = buildService(5);

    const result = await service.list("ws-1", 2);

    expect(result.items.map((c) => c.id)).toEqual([sorted[0].id, sorted[1].id]);
    expect(result.nextCursor).toBe(sorted[1].id);
  });

  it("continues from the cursor on the next call, without repeating or skipping rows", async () => {
    const { service, sorted } = buildService(5);

    const first = await service.list("ws-1", 2);
    const second = await service.list("ws-1", 2, first.nextCursor!);

    expect(second.items.map((c) => c.id)).toEqual([sorted[2].id, sorted[3].id]);
    expect(second.nextCursor).toBe(sorted[3].id);
  });

  it("returns nextCursor: null on the last page, even if it's a partial page", async () => {
    const { service, sorted } = buildService(5);

    const first = await service.list("ws-1", 2);
    const second = await service.list("ws-1", 2, first.nextCursor!);
    const third = await service.list("ws-1", 2, second.nextCursor!);

    expect(third.items.map((c) => c.id)).toEqual([sorted[4].id]);
    expect(third.nextCursor).toBeNull();
  });

  it("returns nextCursor: null when every row fits in a single page", async () => {
    const { service } = buildService(3);

    const result = await service.list("ws-1", 50);

    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it("caps take at 200 even if a larger value is requested", async () => {
    const { service, prisma } = buildService(3);

    await service.list("ws-1", 10_000);

    expect(prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 201 }));
  });
});
