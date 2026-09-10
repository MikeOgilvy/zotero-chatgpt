import { describe, expect, it } from "vitest";

import {
  paperId,
  type PaperScope,
} from "../../packages/contracts/src/index.ts";

describe("paperId", () => {
  it("keeps scopes distinct when separator-like text makes concatenation ambiguous", () => {
    const first: PaperScope = {
      clientId: "profile:7",
      libraryId: 2,
      attachmentKey: "PDF",
    };
    const second: PaperScope = {
      clientId: "profile",
      libraryId: 7,
      attachmentKey: "2:PDF",
    };

    expect(paperId(first)).not.toBe(paperId(second));
  });

  it("returns the same stable identity for equivalent scopes", () => {
    expect(
      paperId({ clientId: "profile", libraryId: 7, attachmentKey: "ABCD1234" }),
    ).toBe('["profile",7,"ABCD1234"]');
  });
});
