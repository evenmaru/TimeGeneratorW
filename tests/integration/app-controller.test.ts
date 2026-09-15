import { describe, expect, it } from "vitest";
import { AppController } from "../../src/application/appController";
import {
  FixedIdGenerator,
  MemoryBackupFilePort,
  RecordingClipboardPort,
  RecordingStateWriter,
  SequenceRandomSource,
  StubTimeZonePort,
  createSlotFixture,
  createStateFixture,
} from "../helpers/fakes";

const SECOND_SLOT_ID = "123e4567-e89b-42d3-a456-426614174001";

function createController(
  initialState = createStateFixture(),
  writer = new RecordingStateWriter(),
  backup = new MemoryBackupFilePort(),
) {
  const clipboard = new RecordingClipboardPort();
  const controller = new AppController(
    initialState,
    writer,
    new FixedIdGenerator(SECOND_SLOT_ID),
    new SequenceRandomSource([0, 0, 0, 0]),
    new StubTimeZonePort(),
    clipboard,
    backup,
  );
  return { controller, writer, clipboard, backup };
}

describe("애플리케이션 컨트롤러 통합", () => {
  it("슬롯을 저장한 뒤에만 상태와 선택을 변경한다", () => {
    const initialState = createStateFixture({ slots: [] });
    const { controller, writer } = createController(initialState);

    expect(
      controller.createSlot({
        name: "  새 프로젝트  ",
        startDate: "2026-09-21",
        endDate: "2026-09-25",
      }),
    ).toEqual({ ok: true, value: { slotId: SECOND_SLOT_ID } });
    expect(writer.savedStates).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      selectedSlotId: SECOND_SLOT_ID,
      state: { slots: [{ id: SECOND_SLOT_ID, name: "새 프로젝트" }] },
    });
  });

  it("저장 실패 시 생성·편집·시간 생성 상태를 원래대로 유지한다", () => {
    const initialState = createStateFixture();
    const writer = new RecordingStateWriter();
    writer.shouldFail = true;
    const { controller } = createController(initialState, writer);

    expect(
      controller.createSlot({
        name: "추가 슬롯",
        startDate: "2026-09-21",
        endDate: "2026-09-25",
      }),
    ).toMatchObject({ ok: false, error: { code: "save_failed" } });
    expect(
      controller.updateSlot(initialState.slots[0]!.id, {
        name: "수정 슬롯",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      }),
    ).toMatchObject({ ok: false, error: { code: "save_failed" } });
    expect(controller.generateNextTime(initialState.slots[0]!.id)).toMatchObject({
      ok: false,
      error: { code: "save_failed" },
    });
    expect(controller.getSnapshot()).toEqual({
      state: initialState,
      selectedSlotId: initialState.slots[0]!.id,
    });
  });

  it("선택 슬롯 삭제 후 같은 위치의 다음 슬롯을 선택한다", () => {
    const first = createSlotFixture();
    const second = createSlotFixture({ id: SECOND_SLOT_ID, name: "두 번째" });
    const { controller } = createController(
      createStateFixture({ slots: [first, second] }),
    );

    expect(controller.deleteSlot(first.id)).toEqual({ ok: true, value: undefined });
    expect(controller.getSnapshot()).toMatchObject({
      selectedSlotId: SECOND_SLOT_ID,
      state: { slots: [{ id: SECOND_SLOT_ID }] },
    });
  });

  it("생성 시간과 셸 형식을 조합해 같은 명령을 표시하고 복사한다", async () => {
    const { controller, clipboard } = createController();
    const slotId = controller.getSnapshot().state.slots[0]!.id;

    expect(controller.generateNextTime(slotId)).toMatchObject({
      ok: true,
      value: { localDateTime: "2026-09-01T09:00:00", utcOffset: "+00:00" },
    });
    expect(controller.setShellFormat("bash")).toEqual({ ok: true, value: undefined });
    const command = controller.getGitCommand(slotId);
    expect(command).toBe(
      "GIT_AUTHOR_DATE='2026-09-01T09:00:00+00:00' GIT_COMMITTER_DATE='2026-09-01T09:00:00+00:00' git commit -m '<커밋 메시지>'",
    );
    await expect(controller.copyGitCommand(slotId)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(clipboard.values).toEqual([command]);
  });

  it("백업을 내보내고 검증한 뒤 적용한다", async () => {
    const backup = new MemoryBackupFilePort();
    const { controller } = createController(createStateFixture(), undefined, backup);

    expect(controller.exportBackup()).toEqual({ ok: true, value: undefined });
    expect(backup.downloaded?.fileName).toBe("time-generator-backup.json");
    expect(JSON.parse(backup.downloaded!.content)).toEqual(controller.getSnapshot().state);

    backup.readValue = JSON.stringify(
      createStateFixture({
        slots: [createSlotFixture({ id: SECOND_SLOT_ID, name: "  가져온 슬롯  " })],
        shellFormat: "powershell",
      }),
    );
    const prepared = await controller.prepareBackupImport({});
    expect(prepared).toMatchObject({
      ok: true,
      value: { normalized: true, state: { slots: [{ name: "가져온 슬롯" }] } },
    });
    if (!prepared.ok) {
      throw new Error("유효한 백업 준비에 실패했습니다.");
    }
    expect(controller.applyBackupImport(prepared.value)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(controller.getSnapshot()).toMatchObject({
      selectedSlotId: SECOND_SLOT_ID,
      state: { shellFormat: "powershell", slots: [{ name: "가져온 슬롯" }] },
    });
  });

  it("잘못된 백업과 적용 저장 실패가 기존 상태를 보존한다", async () => {
    const initialState = createStateFixture();
    const writer = new RecordingStateWriter();
    const backup = new MemoryBackupFilePort();
    const { controller } = createController(initialState, writer, backup);

    backup.readValue = "{bad-json";
    await expect(controller.prepareBackupImport({})).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_backup" },
    });

    backup.readValue = JSON.stringify(createStateFixture({ slots: [] }));
    const prepared = await controller.prepareBackupImport({});
    if (!prepared.ok) {
      throw new Error("유효한 백업 준비에 실패했습니다.");
    }
    writer.shouldFail = true;
    expect(controller.applyBackupImport(prepared.value)).toMatchObject({
      ok: false,
      error: { code: "save_failed" },
    });
    expect(controller.getSnapshot().state).toBe(initialState);
  });
});
