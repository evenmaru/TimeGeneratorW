import { describe, expect, it } from "vitest";
import { IntlTimeZoneAdapter } from "../../src/infrastructure/browser/intlTimeZoneAdapter";

describe("Intl 시간대 어댑터", () => {
  const adapter = new IntlTimeZoneAdapter();

  it("IANA 시간대 식별자를 검증하고 UTC 오프셋을 계산한다", () => {
    expect(adapter.isValidTimeZone("Asia/Seoul")).toBe(true);
    expect(adapter.isValidTimeZone("Not/AZone")).toBe(false);
    expect(adapter.getValidUtcOffsets("2026-09-15T10:00:00", "Asia/Seoul")).toEqual([
      "+09:00",
    ]);
  });

  it("DST로 존재하지 않는 로컬 시각을 제외한다", () => {
    expect(
      adapter.getValidUtcOffsets("2026-03-08T02:30:00", "America/New_York"),
    ).toEqual([]);
  });

  it("DST로 중복된 로컬 시각을 실제 시점이 이른 순서로 반환한다", () => {
    expect(
      adapter.getValidUtcOffsets("2026-11-01T01:30:00", "America/New_York"),
    ).toEqual(["-04:00", "-05:00"]);
  });
});
