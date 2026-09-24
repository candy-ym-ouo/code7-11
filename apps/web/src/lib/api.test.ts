import { describe, expect, it } from "vitest";
import { ApiError } from "./api";

describe("ApiError", () => {
  it("preserves status, code and details", () => {
    const error = new ApiError(409, "MEDIA_NOT_READY", "not ready", { mediaStatus: "processing" });
    expect(error.status).toBe(409);
    expect(error.code).toBe("MEDIA_NOT_READY");
    expect(error.details).toEqual({ mediaStatus: "processing" });
  });
});
