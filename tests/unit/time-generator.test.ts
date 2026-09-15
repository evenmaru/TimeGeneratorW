import { describe, expect, it } from "vitest";
import { generateNextTime } from "../../src/domain/time/timeGenerator";
import {
  SequenceRandomSource,
  StubTimeZonePort,
  createSlotFixture,
} from "../helpers/fakes";

describe("다음 시간 생성기", () => {
  const utc = new StubTimeZonePort();

  it("최초 범위의 양 끝을 포함한다", () => {
    const slot = createSlotFixture({ startDate: "2026-09-21", endDate: "2026-09-21" });

    expect(generateNextTime(slot, new SequenceRandomSource([0]), utc)).toEqual({
      ok: true,
      value: { localDateTime: "2026-09-21T09:00:00", utcOffset: "+00:00" },
    });
    expect(generateNextTime(slot, new SequenceRandomSource([0.999_999_999]), utc)).toEqual({
      ok: true,
      value: { localDateTime: "2026-09-21T09:30:59", utcOffset: "+00:00" },
    });
  });

  it("주말 시작일 다음의 첫 평일에 최초 시간을 만든다", () => {
    const slot = createSlotFixture({ startDate: "2026-09-19", endDate: "2026-09-21" });
    expect(generateNextTime(slot, new SequenceRandomSource([0]), utc)).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-21T09:00:00" },
    });
  });

  it("날짜 범위에 평일이 없으면 종료일 초과를 반환한다", () => {
    const slot = createSlotFixture({ startDate: "2026-09-19", endDate: "2026-09-20" });
    expect(generateNextTime(slot, new SequenceRandomSource([0]), utc)).toMatchObject({
      ok: false,
      error: { code: "no_available_time" },
    });
  });

  it("이후 간격의 600초와 10,800초를 포함한다", () => {
    const slot = createSlotFixture({
      lastGeneratedTime: {
        localDateTime: "2026-09-21T09:00:00",
        utcOffset: "+00:00",
      },
    });

    expect(generateNextTime(slot, new SequenceRandomSource([0]), utc)).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-21T09:10:00" },
    });
    expect(
      generateNextTime(slot, new SequenceRandomSource([0.999_999_999, 0]), utc),
    ).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-21T12:00:00" },
    });
  });

  it("금요일 야간과 주말을 간격에서 제외한다", () => {
    const slot = createSlotFixture({
      startDate: "2026-09-18",
      endDate: "2026-09-21",
      lastGeneratedTime: {
        localDateTime: "2026-09-18T22:55:00",
        utcOffset: "+00:00",
      },
    });
    expect(generateNextTime(slot, new SequenceRandomSource([0]), utc)).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-21T09:05:00" },
    });
  });

  it("남은 시간이 600초이면 종료일 마지막 초를 후보로 사용한다", () => {
    const slot = createSlotFixture({
      startDate: "2026-09-21",
      endDate: "2026-09-21",
      lastGeneratedTime: {
        localDateTime: "2026-09-21T22:49:59",
        utcOffset: "+00:00",
      },
    });
    expect(generateNextTime(slot, new SequenceRandomSource([0.999_999_999]), utc)).toEqual({
      ok: true,
      value: { localDateTime: "2026-09-21T22:59:59", utcOffset: "+00:00" },
    });
  });

  it("남은 시간이 599초이면 종료일 초과를 반환한다", () => {
    const slot = createSlotFixture({
      startDate: "2026-09-21",
      endDate: "2026-09-21",
      lastGeneratedTime: {
        localDateTime: "2026-09-21T22:50:00",
        utcOffset: "+00:00",
      },
    });
    expect(generateNextTime(slot, new SequenceRandomSource([0]), utc)).toMatchObject({
      ok: false,
      error: { code: "no_available_time" },
    });
  });

  it("점심 후보를 20%로 채택하고 13시는 확률 검사에서 제외한다", () => {
    const lunchSlot = createSlotFixture({
      lastGeneratedTime: {
        localDateTime: "2026-09-21T11:50:00",
        utcOffset: "+00:00",
      },
    });
    expect(
      generateNextTime(lunchSlot, new SequenceRandomSource([0, 0.199_999]), utc),
    ).toMatchObject({ ok: true, value: { localDateTime: "2026-09-21T12:00:00" } });

    const boundaryRandom = new SequenceRandomSource([0]);
    const boundarySlot = createSlotFixture({
      lastGeneratedTime: {
        localDateTime: "2026-09-21T12:50:00",
        utcOffset: "+00:00",
      },
    });
    expect(generateNextTime(boundarySlot, boundaryRandom, utc)).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-21T13:00:00" },
    });
    expect(boundaryRandom.callCount).toBe(1);
  });

  it("저녁 후보를 25%로 채택하고 20시는 확률 검사에서 제외한다", () => {
    const eveningSlot = createSlotFixture({
      lastGeneratedTime: {
        localDateTime: "2026-09-21T16:50:00",
        utcOffset: "+00:00",
      },
    });
    expect(
      generateNextTime(eveningSlot, new SequenceRandomSource([0, 0.249_999]), utc),
    ).toMatchObject({ ok: true, value: { localDateTime: "2026-09-21T17:00:00" } });

    const boundaryRandom = new SequenceRandomSource([0]);
    const boundarySlot = createSlotFixture({
      lastGeneratedTime: {
        localDateTime: "2026-09-21T19:50:00",
        utcOffset: "+00:00",
      },
    });
    expect(generateNextTime(boundarySlot, boundaryRandom, utc)).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-21T20:00:00" },
    });
    expect(boundaryRandom.callCount).toBe(1);
  });

  it("탈락한 후보가 아니라 마지막 저장 시간을 기준으로 다시 계산한다", () => {
    const slot = createSlotFixture({
      lastGeneratedTime: {
        localDateTime: "2026-09-21T11:50:00",
        utcOffset: "+00:00",
      },
    });
    const result = generateNextTime(
      slot,
      new SequenceRandomSource([0, 0.9, 0.999_999_999]),
      utc,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-21T14:50:00" },
    });
  });

  it("100회 확률 탈락은 종료일 초과가 아닌 일시 실패다", () => {
    const slot = createSlotFixture({
      lastGeneratedTime: {
        localDateTime: "2026-09-21T11:50:00",
        utcOffset: "+00:00",
      },
    });
    const values = Array.from({ length: 200 }, (_, index) =>
      index % 2 === 0 ? 0 : 0.99,
    );
    expect(generateNextTime(slot, new SequenceRandomSource(values), utc)).toMatchObject({
      ok: false,
      error: { code: "temporary_generation_failure" },
    });
  });

  it("난수 공급 오류를 상태 변경 가능한 결과로 오인하지 않는다", () => {
    const slot = createSlotFixture();
    expect(generateNextTime(slot, new SequenceRandomSource([1]), utc)).toMatchObject({
      ok: false,
      error: { code: "temporary_generation_failure" },
    });
  });

  it("중복 로컬 시각에서는 실제 시점이 이른 첫 오프셋을 사용한다", () => {
    const dateTime = "2026-09-21T09:00:00";
    const timeZone = new StubTimeZonePort("America/New_York", {
      [`America/New_York:${dateTime}`]: ["-04:00", "-05:00"],
    });
    const slot = createSlotFixture({
      startDate: "2026-09-21",
      endDate: "2026-09-21",
      timeZone: "America/New_York",
    });
    expect(generateNextTime(slot, new SequenceRandomSource([0]), timeZone)).toEqual({
      ok: true,
      value: { localDateTime: dateTime, utcOffset: "-04:00" },
    });
  });
});
