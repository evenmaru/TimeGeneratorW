import { describe, expect, it } from "vitest";
import { createInitialAppState, type AppState } from "../../src/domain/models";
import { createSlot, deleteSlot, updateSlot } from "../../src/domain/slotCommands";
import { createSlotFixture, createStateFixture } from "../helpers/fakes";

describe("슬롯 명령", () => {
  it("이름을 정규화한 새 슬롯을 배열 끝에 추가한다", () => {
    const result = createSlot(createInitialAppState(), {
      id: "123e4567-e89b-42d3-a456-426614174001",
      name: "  새 슬롯  ",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      timeZone: "UTC",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        slot: {
          name: "새 슬롯",
          lastGeneratedTime: null,
        },
      },
    });
  });

  it("중복 이름은 허용하지만 5개를 넘기지 않는다", () => {
    let state: AppState = createInitialAppState();
    for (let index = 0; index < 5; index += 1) {
      const result = createSlot(state, {
        id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`,
        name: "중복 이름",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        timeZone: "UTC",
      });
      expect(result.ok).toBe(true);
      if (result.ok) state = result.value.state;
    }

    expect(
      createSlot(state, {
        id: "123e4567-e89b-42d3-a456-999999999999",
        name: "여섯 번째",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        timeZone: "UTC",
      }),
    ).toMatchObject({ ok: false, error: { code: "slot_limit_reached" } });
  });

  it("이름과 날짜 변경 후에도 ID와 시간대를 유지한다", () => {
    const state = createStateFixture();
    const result = updateSlot(state, state.slots[0]?.id ?? "", {
      name: "변경 이름",
      startDate: "2026-09-02",
      endDate: "2026-10-01",
      resetLastGeneratedTime: false,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        slots: [
          {
            id: state.slots[0]?.id,
            name: "변경 이름",
            timeZone: "UTC",
          },
        ],
      },
    });
  });

  it("날짜 밖의 마지막 시간은 확인 전 거부하고 확인 후 초기화한다", () => {
    const state = createStateFixture({
      slots: [
        createSlotFixture({
          lastGeneratedTime: {
            localDateTime: "2026-09-15T10:00:00",
            utcOffset: "+00:00",
          },
        }),
      ],
    });
    const input = {
      name: "테스트 슬롯",
      startDate: "2026-09-20",
      endDate: "2026-09-30",
    };

    expect(
      updateSlot(state, state.slots[0]?.id ?? "", {
        ...input,
        resetLastGeneratedTime: false,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "last_generated_time_out_of_range" },
    });

    expect(
      updateSlot(state, state.slots[0]?.id ?? "", {
        ...input,
        resetLastGeneratedTime: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { slots: [{ lastGeneratedTime: null }] },
    });
  });

  it("삭제 시 대상 슬롯 객체 전체를 배열에서 제거한다", () => {
    const first = createSlotFixture();
    const second = createSlotFixture({ id: "123e4567-e89b-42d3-a456-426614174002" });
    const result = deleteSlot(createStateFixture({ slots: [first, second] }), first.id);

    expect(result).toEqual({
      ok: true,
      value: { schemaVersion: 1, slots: [second], shellFormat: null },
    });
  });
});
