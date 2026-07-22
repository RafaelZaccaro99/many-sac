import { BadRequestException } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";

function buildController() {
  const contactsService = { list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) } as any;
  const controller = new ContactsController(contactsService);
  return { controller, contactsService };
}

describe("ContactsController.list", () => {
  it("passes a valid take through as a number", async () => {
    const { controller, contactsService } = buildController();

    await controller.list("ws-1", "25", undefined);

    expect(contactsService.list).toHaveBeenCalledWith("ws-1", 25, undefined);
  });

  it("omits take when the query param is absent", async () => {
    const { controller, contactsService } = buildController();

    await controller.list("ws-1", undefined, "cursor-1");

    expect(contactsService.list).toHaveBeenCalledWith("ws-1", undefined, "cursor-1");
  });

  it.each(["abc", "-1", "0", "1.5"])("rejects take=%s with a 400 instead of forwarding it to Prisma", (take) => {
    const { controller, contactsService } = buildController();

    expect(() => controller.list("ws-1", take, undefined)).toThrow(BadRequestException);
    expect(contactsService.list).not.toHaveBeenCalled();
  });
});
