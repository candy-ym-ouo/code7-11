import { describe, expect, it } from "vitest";
import { AppError, forbidden, notFound } from "./errors";

describe("AppError helpers", () => {
  it("creates stable problem codes", () => {
    const missing = notFound();
    const denied = forbidden();
    expect(missing).toBeInstanceOf(AppError);
    expect(missing.statusCode).toBe(404);
    expect(missing.code).toBe("NOT_FOUND");
    expect(denied.statusCode).toBe(403);
    expect(denied.code).toBe("FORBIDDEN");
  });
});
