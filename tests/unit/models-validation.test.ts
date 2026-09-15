import { describe, expect, it } from "vitest";
import { createInitialAppState } from "../../src/domain/models";
import {
  isValidDate,
  isValidLocalDateTime,
  isValidUtcOffset,
  normalizeSlotName,
  validateAndNormalizeAppState,
  validateDateRange,
} from "../../src/domain/validation";
import { StubTimeZonePort, createSlotFixture } from "../helpers/fakes";

describe("애플리케이션 상태 모델과 검증", () => {
  const timeZonePort = new StubTimeZonePort();

  it("빈 초기 상태를 새 배열로 생성한다", () => {
    const first = createInitialAppState();
    const second = createInitialAppState();

    expect(first).toEqual({ schemaVersion: 1, slots: [], shellFormat: null });
    expect(first.slots).not.toBe(second.slots);
  });

  it("이름 앞뒤 공백만 제거하고 공백 이름은 거부한다", () => {
    expect(normalizeSlotName("  같은 이름  ")).toEqual({ ok: true, value: "같은 이름" });
    expect(normalizeSlotName("   ")).toMatchObject({
      ok: false,
      error: { code: "invalid_name" },
    });
  });

  it("실제 달력 날짜와 날짜 순서를 확인한다", () => {
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2025-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(validateDateRange("2026-09-30", "2026-09-01")).toMatchObject({
      ok: false,
      error: [{ code: "invalid_date_range" }],
    });
  });

  it("초 단위 로컬 시간과 UTC 오프셋 형식을 확인한다", () => {
    expect(isValidLocalDateTime("2026-09-15T22:59:59")).toBe(true);
    expect(isValidLocalDateTime("2026-09-15T23:60:00")).toBe(false);
    expect(isValidUtcOffset("+09:00")).toBe(true);
    expect(isValidUtcOffset("09:00")).toBe(false);
  });

  it("유효한 상태를 값 손실 없이 반환한다", () => {
    const state = {
      schemaVersion: 1,
      shellFormat: "bash",
      slots: [
        createSlotFixture({
          lastGeneratedTime: {
            localDateTime: "2026-09-15T14:20:00",
            utcOffset: "+00:00",
          },
        }),
      ],
    };

    expect(validateAndNormalizeAppState(state, timeZonePort)).toEqual({
      ok: true,
      value: { state, normalized: false, issues: [] },
    });
  });

  it("이름과 추가 필드를 정규화하고 잘못된 마지막 시간만 초기화한다", () => {
    const input = {
      schemaVersion: 1,
      shellFormat: null,
      extraRoot: true,
      slots: [
        {
          ...createSlotFixture(),
          name: "  정규화 이름  ",
          extraSlot: true,
          lastGeneratedTime: {
            localDateTime: "2026-10-01T10:00:00",
            utcOffset: "+00:00",
          },
        },
      ],
    };

    const result = validateAndNormalizeAppState(input, timeZonePort);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.normalized).toBe(true);
    expect(result.value.state.slots[0]).toMatchObject({
      name: "정규화 이름",
      lastGeneratedTime: null,
    });
    expect(result.value.issues.map((entry) => entry.code)).toEqual([
      "normalized_name",
      "reset_invalid_generated_time",
    ]);
  });

  it("중복 ID와 슬롯 5개 초과를 복구 불가능한 오류로 구분한다", () => {
    const duplicate = validateAndNormalizeAppState(
      {
        schemaVersion: 1,
        shellFormat: null,
        slots: [createSlotFixture(), createSlotFixture()],
      },
      timeZonePort,
    );
    expect(duplicate).toMatchObject({ ok: false, error: [{ code: "duplicate_id" }] });

    const excessive = validateAndNormalizeAppState(
      {
        schemaVersion: 1,
        shellFormat: null,
        slots: Array.from({ length: 6 }, (_, index) =>
          createSlotFixture({
            id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
          }),
        ),
      },
      timeZonePort,
    );
    expect(excessive).toMatchObject({ ok: false, error: [{ code: "too_many_slots" }] });
  });

  it("시간대와 오프셋 조합이 다르면 마지막 시간만 초기화한다", () => {
    const result = validateAndNormalizeAppState(
      {
        schemaVersion: 1,
        shellFormat: null,
        slots: [
          createSlotFixture({
            timeZone: "Asia/Seoul",
            lastGeneratedTime: {
              localDateTime: "2026-09-15T10:00:00",
              utcOffset: "+00:00",
            },
          }),
        ],
      },
      timeZonePort,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        normalized: true,
        state: { slots: [{ lastGeneratedTime: null }] },
      },
    });
  });
});
