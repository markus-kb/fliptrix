import { describe, expect, it } from "vitest";

import { formatAccountsField, parseAccountsField } from "./settings-ui";

describe("parseAccountsField", () => {
  it("trims whitespace, strips leading @, and drops empty lines", () => {
    expect(parseAccountsField("  @alice\n\nbob  \n @carol ")).toEqual(["alice", "bob", "carol"]);
  });
});

describe("formatAccountsField", () => {
  it("joins accounts onto separate lines", () => {
    expect(formatAccountsField(["alice", "bob"])).toBe("alice\nbob");
  });
});
