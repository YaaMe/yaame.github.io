export class RecoveryError extends Error {
  code: string;

  constructor(code: string, message: string, properties: Record<string, unknown> = {}) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
    Object.assign(this, properties);
  }
}
