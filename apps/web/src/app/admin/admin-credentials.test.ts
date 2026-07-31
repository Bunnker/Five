import { describe, expect, it } from "vitest";

import { ADMIN_USERNAME_INPUT_PATTERN } from "./admin-credentials";

describe("ADMIN_USERNAME_INPUT_PATTERN", () => {
  it("is valid under the HTML pattern Unicode Sets flag", () => {
    const pattern = new RegExp(`^(?:${ADMIN_USERNAME_INPUT_PATTERN})$`, "v");

    expect(pattern.test("Operator-01_test.name")).toBe(true);
    expect(pattern.test("-operator")).toBe(false);
    expect(pattern.test("operator space")).toBe(false);
  });
});
