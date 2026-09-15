import { describe, expect, it } from "vitest";
import {
  advanceOnValidTimeAxis,
  countWeekdaysInclusive,
  findFirstWeekday,
  getRemainingValidSeconds,
  getValidTimelineProgress,
} from "../../src/domain/time/validTimeAxis";

describe("평일 유효 시간축", () => {
  it("주말 뒤 첫 평일을 찾는다", () => {
    expect(findFirstWeekday("2026-09-19", "2026-09-21")).toBe("2026-09-21");
    expect(findFirstWeekday("2026-09-19", "2026-09-20")).toBeNull();
  });

  it("같은 날의 유효 초를 이동한다", () => {
    expect(
      advanceOnValidTimeAxis("2026-09-21T09:00:00", 600, "2026-09-21"),
    ).toBe("2026-09-21T09:10:00");
    expect(
      advanceOnValidTimeAxis("2026-09-21T19:59:59", 1, "2026-09-21"),
    ).toBe("2026-09-21T20:00:00");
  });

  it("금요일 야간과 주말을 제외하고 월요일로 이동한다", () => {
    expect(
      advanceOnValidTimeAxis("2026-09-18T22:55:00", 600, "2026-09-21"),
    ).toBe("2026-09-21T09:05:00");
  });

  it("종료일까지 남은 유효 초를 경계값으로 계산한다", () => {
    expect(getRemainingValidSeconds("2026-09-21T22:49:59", "2026-09-21")).toBe(600);
    expect(getRemainingValidSeconds("2026-09-21T22:50:00", "2026-09-21")).toBe(599);
    expect(
      getRemainingValidSeconds("2026-09-18T22:55:00", "2026-09-21", 10_800),
    ).toBe(10_800);
  });

  it("평일 개수와 마지막 생성 위치의 진행 비율을 계산한다", () => {
    expect(countWeekdaysInclusive("2026-09-18", "2026-09-21")).toBe(2);
    const progress = getValidTimelineProgress(
      "2026-09-18",
      "2026-09-21",
      "2026-09-21T22:59:59",
    );
    expect(progress).toBe(1);
  });
});
