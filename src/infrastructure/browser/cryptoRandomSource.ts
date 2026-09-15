import type { RandomSource } from "../../domain/ports/randomSource";

const UINT32_RANGE = 0x1_0000_0000;

export class CryptoRandomSource implements RandomSource {
  public next(): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return (values[0] ?? 0) / UINT32_RANGE;
  }
}
