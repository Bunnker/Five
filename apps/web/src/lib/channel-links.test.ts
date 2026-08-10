import { describe, expect, it } from "vitest";

import { parsePublicChannelId, withPublicChannelId } from "./channel-links";

describe("public channel links", () => {
  it("accepts the OpenAPI channel shape and preserves query strings and fragments", () => {
    expect(parsePublicChannelId("wechat_official")).toBe("wechat_official");
    expect(withPublicChannelId("/outfits?formulaId=formula-01#plan", "wechat_official")).toBe(
      "/outfits?formulaId=formula-01&channelId=wechat_official#plan",
    );
  });

  it.each([
    undefined,
    ["organic", "wechat_official"],
    " padded ",
    "wechat\nheader",
    "x".repeat(65),
  ])("rejects an invalid channel without reflecting it into a link", (value) => {
    expect(parsePublicChannelId(value)).toBeNull();
    expect(withPublicChannelId("/outfits?formulaId=formula-01", value)).toBe(
      "/outfits?formulaId=formula-01",
    );
  });

  it("does not turn an external or protocol-relative href into an attributed link", () => {
    expect(withPublicChannelId("https://evil.example/path", "wechat_official")).toBe(
      "https://evil.example/path",
    );
    expect(withPublicChannelId("//evil.example/path", "wechat_official")).toBe(
      "//evil.example/path",
    );
  });

  it("keeps canonical organic links short unless the source href already carries a channel", () => {
    expect(withPublicChannelId("/", "organic")).toBe("/");
    expect(withPublicChannelId("/share?channelId=wechat_group", "organic")).toBe(
      "/share?channelId=organic",
    );
  });
});
