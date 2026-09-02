import { describe, it, expect } from "vitest";
import { parseListQuery } from "../src/lib/pagination";
import { ValidationError } from "../src/lib/errors";

describe("parseListQuery", () => {
  it("applies sensible defaults when no query params are given", () => {
    const result = parseListQuery({}, ["createdAt"]);
    expect(result).toMatchObject({ page: 1, pageSize: 25, skip: 0, take: 25 });
    expect(result.orderBy).toBeUndefined();
  });

  it("computes skip/take from page and pageSize", () => {
    const result = parseListQuery({ page: "3", pageSize: "10" }, ["createdAt"]);
    expect(result).toMatchObject({ page: 3, pageSize: 10, skip: 20, take: 10 });
  });

  it("parses a valid sort param into a Prisma orderBy object", () => {
    const result = parseListQuery({ sort: "email:desc" }, ["email", "createdAt"]);
    expect(result.orderBy).toEqual({ email: "desc" });
  });

  it("defaults sort direction to asc when omitted", () => {
    const result = parseListQuery({ sort: "email" }, ["email"]);
    expect(result.orderBy).toEqual({ email: "asc" });
  });

  it("rejects sorting by a field that isn't in the allow-list", () => {
    expect(() => parseListQuery({ sort: "password:asc" }, ["email"])).toThrow(ValidationError);
  });

  it("rejects a non-positive page number", () => {
    expect(() => parseListQuery({ page: "0" }, [])).toThrow(ValidationError);
  });

  it("rejects a pageSize above the max of 100", () => {
    expect(() => parseListQuery({ pageSize: "500" }, [])).toThrow(ValidationError);
  });
});
