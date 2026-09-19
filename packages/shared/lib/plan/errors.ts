export class PlanError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500
  ) {
    super(message);
  }
}
