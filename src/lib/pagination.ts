import { ValidationError } from "./errors";

export interface ParsedListQuery {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
  orderBy?: Record<string, "asc" | "desc">;
}

/**
 * Parses the common `page`, `pageSize`, and `sort` query params shared by
 * every local list endpoint (/contacts, /deals) into Prisma-ready options.
 *
 * `sort` format: `field:asc` or `field:desc`, e.g. `?sort=createdAt:desc`.
 */
export function parseListQuery(query: Record<string, unknown>, allowedSortFields: string[]): ParsedListQuery {
  const page = query.page ? Number(query.page) : 1;
  const pageSize = query.pageSize ? Number(query.pageSize) : 25;

  if (!Number.isInteger(page) || page < 1) throw new ValidationError("`page` must be a positive integer");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ValidationError("`pageSize` must be an integer between 1 and 100");
  }

  let orderBy: Record<string, "asc" | "desc"> | undefined;
  if (typeof query.sort === "string") {
    const [field, direction = "asc"] = query.sort.split(":");
    if (!allowedSortFields.includes(field)) {
      throw new ValidationError(`Cannot sort by "${field}". Allowed fields: ${allowedSortFields.join(", ")}`);
    }
    if (direction !== "asc" && direction !== "desc") {
      throw new ValidationError('Sort direction must be "asc" or "desc"');
    }
    orderBy = { [field]: direction };
  }

  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize, orderBy };
}
