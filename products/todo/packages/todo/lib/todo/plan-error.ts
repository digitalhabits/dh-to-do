/**
 * An error with an HTTP status, for routes to answer with.
 *
 * To-Do's own copy of the planner's packages/shared/lib/plan/errors.ts,
 * so that To-Do needs no planner file. Two copies
 * are two classes, and a plain `instanceof` would say no to the other copy's
 * errors: a To-Do 404 would then answer as a 500 (lib/plan/respond.ts). So
 * both copies mark their errors with the same global symbol, and
 * `instanceof` reads that mark. Keep the two files the same;
 * tests/todo-shared-copies.test.mts checks it.
 */
const MARK = Symbol.for("digital-habits.PlanError");

export class PlanError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500
  ) {
    super(message);
    (this as unknown as Record<symbol, true>)[MARK] = true;
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as Record<symbol, unknown>)[MARK] === true
    );
  }
}
