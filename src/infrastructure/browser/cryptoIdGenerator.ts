import type { IdGenerator } from "../../domain/ports/idGenerator";

export class CryptoIdGenerator implements IdGenerator {
  public createId(): string {
    return crypto.randomUUID();
  }
}
