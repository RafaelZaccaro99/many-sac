import { JsonLogger } from "./json-logger.service";

function captureWrites(fn: () => void): Record<string, unknown>[] {
  const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  let entries: Record<string, unknown>[];
  try {
    fn();
    entries = writeSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
  } finally {
    writeSpy.mockRestore();
  }
  return entries;
}

describe("JsonLogger", () => {
  it("writes one parseable JSON line per call, with a level and timestamp", () => {
    const logger = new JsonLogger();
    const [entry] = captureWrites(() => logger.log("something happened"));

    expect(entry).toMatchObject({ level: "log", message: "something happened" });
    expect(typeof entry.timestamp).toBe("string");
    expect(new Date(entry.timestamp as string).toString()).not.toBe("Invalid Date");
  });

  it("labels a single string param as context, matching Nest's log(message, context) convention", () => {
    const logger = new JsonLogger();
    const [entry] = captureWrites(() => logger.log("execution started", "ExecutionRunnerService"));

    expect(entry).toMatchObject({ message: "execution started", context: "ExecutionRunnerService" });
  });

  it("keeps multiple params verbatim instead of guessing which one is the stack vs context", () => {
    const logger = new JsonLogger();
    const [entry] = captureWrites(() => logger.error("boom", "at Foo.bar (file.ts:1:1)", "ExecutionRunnerService"));

    expect(entry.level).toBe("error");
    expect(entry.message).toBe("boom");
    expect(entry.details).toEqual(["at Foo.bar (file.ts:1:1)", "ExecutionRunnerService"]);
  });

  it("extracts just the message from an Error instance, not the whole object", () => {
    const logger = new JsonLogger();
    const [entry] = captureWrites(() => logger.error(new Error("Graph API down")));

    expect(entry.message).toBe("Graph API down");
  });

  it("stringifies a non-string, non-Error message", () => {
    const logger = new JsonLogger();
    const [entry] = captureWrites(() => logger.debug({ executionId: "exec-1", step: 3 }));

    expect(entry.message).toBe(JSON.stringify({ executionId: "exec-1", step: 3 }));
  });

  it.each(["log", "error", "warn", "debug", "verbose"] as const)("supports the %s level", (level) => {
    const logger = new JsonLogger();
    const [entry] = captureWrites(() => logger[level]("hi"));

    expect(entry.level).toBe(level);
  });
});
