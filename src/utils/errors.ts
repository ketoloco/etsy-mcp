export class EtsyApiError extends Error {
  constructor(
    public status: number,
    public errorBody: unknown,
    message?: string
  ) {
    super(message ?? `Etsy API error (${status})${EtsyApiError.describe(errorBody)}`);
    this.name = "EtsyApiError";
  }

  /** Etsy explains what went wrong in the body ({"error": "..."}); surface it. */
  static describe(body: unknown): string {
    if (!body) return "";
    if (typeof body === "string") return `: ${body}`;
    const b = body as Record<string, unknown>;
    const msg = b.error ?? b.error_description ?? b.message;
    return msg ? `: ${String(msg)}` : `: ${JSON.stringify(body)}`;
  }
}
