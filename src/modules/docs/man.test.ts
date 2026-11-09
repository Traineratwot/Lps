import { describe, expect, test } from "bun:test";
import { summaryFromTroff } from "./man.ts";

describe("summaryFromTroff", () => {
  test("classic NAME section", () => {
    const src = ".TH GIT 1\n.SH NAME\ngit \\- the stupid content tracker\n.SH SYNOPSIS\nfoo";
    expect(summaryFromTroff(src)).toBe("the stupid content tracker");
  });

  test("quoted section header and font escapes", () => {
    const src = '.SH "NAME"\n\\fBgit\\fR \\- fast, scalable, distributed revision control system';
    expect(summaryFromTroff(src)).toBe("fast, scalable, distributed revision control system");
  });

  test("multi-line NAME body is joined", () => {
    const src = ".SH NAME\nfoo \\- first line\nsecond line\n.SH OPTIONS\nx";
    expect(summaryFromTroff(src)).toBe("first line second line");
  });

  test("only name without dash returns the line", () => {
    expect(summaryFromTroff(".SH NAME\nlone-command")).toBe("lone-command");
  });

  test("missing NAME section returns empty", () => {
    expect(summaryFromTroff(".SH DESCRIPTION\nnothing")).toBe("");
  });

  test("multiple dashes: keeps first summary only", () => {
    const src = ".SH NAME\nfoo \\- summary one, bar \\- summary two";
    expect(summaryFromTroff(src)).toBe("summary one");
  });
});
