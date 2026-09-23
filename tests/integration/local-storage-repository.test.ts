import { describe, expect, it } from "vitest";
import { createInitialAppState } from "../../src/domain/models";
import {
  APP_STATE_RECOVERY_KEY,
  APP_STATE_STORAGE_KEY,
  LocalStorageAppStateRepository,
} from "../../src/infrastructure/storage/localStorageAppStateRepository";
import type { KeyValueStorage } from "../../src/infrastructure/storage/keyValueStorage";
import { StubTimeZonePort, createSlotFixture, createStateFixture } from "../helpers/fakes";

class MemoryKeyValueStorage implements KeyValueStorage {
  public readonly values = new Map<string, string>();
  public readShouldFail = false;
  public writeShouldFail = false;

  public getItem(key: string): string | null {
    if (this.readShouldFail) {
      throw new Error("읽기 실패");
    }
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    if (this.writeShouldFail) {
      throw new Error("쓰기 실패");
    }
    this.values.set(key, value);
  }
}

function createRepository(storage = new MemoryKeyValueStorage()) {
  return {
    storage,
    repository: new LocalStorageAppStateRepository(storage, new StubTimeZonePort()),
  };
}

describe("로컬 저장소 상태 저장소 통합", () => {
  it("저장 데이터가 없으면 알림 없이 초기 상태를 반환한다", () => {
    const { repository } = createRepository();
    expect(repository.load()).toEqual({
      state: createInitialAppState(),
      notices: [],
      hasStoredState: false,
    });
  });

  it("유효한 상태를 저장하고 같은 값으로 다시 읽는다", async () => {
    const { repository, storage } = createRepository();
    const state = createStateFixture({ shellFormat: "cmd" });

    expect(await repository.save(state)).toEqual({ ok: true, value: undefined });
    expect(JSON.parse(storage.values.get(APP_STATE_STORAGE_KEY)!)).toEqual(state);
    expect(repository.load()).toEqual({ state, notices: [], hasStoredState: true });
  });

  it("안전하게 정규화할 값은 고친 뒤 저장소에도 다시 기록한다", () => {
    const { repository, storage } = createRepository();
    storage.values.set(
      APP_STATE_STORAGE_KEY,
      JSON.stringify({
        ...createStateFixture(),
        temporary: true,
        slots: [{ ...createSlotFixture(), name: "  정리할 이름  ", extra: "remove" }],
      }),
    );

    const result = repository.load();
    expect(result.state.slots[0]?.name).toBe("정리할 이름");
    expect(result.notices).toMatchObject([{ code: "state_normalized" }]);
    expect(JSON.parse(storage.values.get(APP_STATE_STORAGE_KEY)!)).toEqual(result.state);
  });

  it("손상된 원문을 보존하고 빈 상태로 복구한다", () => {
    const { repository, storage } = createRepository();
    const raw = "{invalid-json";
    storage.values.set(APP_STATE_STORAGE_KEY, raw);

    const result = repository.load();
    expect(result.state).toEqual(createInitialAppState());
    expect(result.notices).toMatchObject([{ code: "state_recovered" }]);
    expect(storage.values.get(APP_STATE_RECOVERY_KEY)).toBe(raw);
    expect(JSON.parse(storage.values.get(APP_STATE_STORAGE_KEY)!)).toEqual(
      createInitialAppState(),
    );
  });

  it("새 스키마 원문은 보존하고 이후 저장을 차단한다", async () => {
    const { repository, storage } = createRepository();
    const raw = JSON.stringify({ schemaVersion: 2, slots: [], shellFormat: null });
    storage.values.set(APP_STATE_STORAGE_KEY, raw);

    const result = repository.load();
    expect(result.notices).toMatchObject([{ code: "unsupported_newer_schema" }]);
    expect(storage.values.get(APP_STATE_RECOVERY_KEY)).toBe(raw);
    expect(storage.values.get(APP_STATE_STORAGE_KEY)).toBe(raw);
    expect(await repository.save(createInitialAppState())).toMatchObject({
      ok: false,
      error: { code: "save_failed" },
    });
    expect(storage.values.get(APP_STATE_STORAGE_KEY)).toBe(raw);
  });

  it("읽기·쓰기 실패를 결과와 시작 알림으로 반환한다", async () => {
    const { repository, storage } = createRepository();
    storage.readShouldFail = true;
    expect(repository.load()).toMatchObject({
      state: createInitialAppState(),
      notices: [{ code: "storage_read_failed" }],
    });

    storage.readShouldFail = false;
    storage.writeShouldFail = true;
    expect(await repository.save(createStateFixture())).toMatchObject({
      ok: false,
      error: { code: "save_failed" },
    });
  });

  it("중복 ID처럼 부분 복구가 위험한 상태는 통째로 초기화한다", () => {
    const { repository, storage } = createRepository();
    const slot = createSlotFixture();
    storage.values.set(
      APP_STATE_STORAGE_KEY,
      JSON.stringify(createStateFixture({ slots: [slot, { ...slot, name: "중복" }] })),
    );

    const result = repository.load();
    expect(result.state).toEqual(createInitialAppState());
    expect(result.notices).toMatchObject([{ code: "state_recovered" }]);
  });
});
