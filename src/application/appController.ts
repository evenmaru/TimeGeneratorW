import type { AppState, GeneratedTime, Slot } from "../domain/models";
import type { ShellFormat } from "../domain/models";
import { formatGitCommand } from "../domain/git/gitCommandFormatter";
import type { IdGenerator } from "../domain/ports/idGenerator";
import type { RandomSource } from "../domain/ports/randomSource";
import type { TimeZonePort } from "../domain/ports/timeZonePort";
import { failure, success, type Result } from "../domain/result";
import {
  createSlot,
  deleteSlot,
  updateSlot,
  type SlotCommandError,
} from "../domain/slotCommands";
import {
  generateNextTime,
  type TimeGenerationError,
} from "../domain/time/timeGenerator";
import type { AppStateWriter, StateWriteError } from "./ports/appStateWriter";
import type { BackupFileError, BackupFilePort } from "./ports/backupFilePort";
import type { ClipboardError, ClipboardPort } from "./ports/clipboardPort";
import {
  decodeAppStateJson,
  encodeAppStateJson,
} from "./appStateJsonCodec";

export type CommandError = Readonly<{
  code: "command_unavailable" | "invalid_shell_format";
  message: string;
}>;

export type BackupError = Readonly<{
  code: "invalid_backup";
  message: string;
}>;

export type PreparedBackupImport = Readonly<{
  state: AppState;
  normalized: boolean;
}>;

export type AppControllerError =
  | SlotCommandError
  | StateWriteError
  | TimeGenerationError
  | CommandError
  | ClipboardError
  | BackupFileError
  | BackupError;

export type AppSnapshot = Readonly<{
  state: AppState;
  selectedSlotId: string | null;
}>;

export type SlotFormInput = Readonly<{
  name: string;
  startDate: string;
  endDate: string;
}>;

export class AppController {
  private state: AppState;
  private selectedSlotId: string | null;
  private saveInProgress = false;

  public constructor(
    initialState: AppState,
    private readonly stateWriter: AppStateWriter,
    private readonly idGenerator: IdGenerator,
    private readonly randomSource: RandomSource,
    private readonly timeZonePort: TimeZonePort,
    private readonly clipboardPort: ClipboardPort,
    private readonly backupFilePort: BackupFilePort,
  ) {
    this.state = initialState;
    this.selectedSlotId = initialState.slots[0]?.id ?? null;
  }

  public getSnapshot(): AppSnapshot {
    return { state: this.state, selectedSlotId: this.selectedSlotId };
  }

  public replaceStateFromRemote(state: AppState): void {
    this.state = state;
    if (!state.slots.some((slot) => slot.id === this.selectedSlotId)) {
      this.selectedSlotId = state.slots[0]?.id ?? null;
    }
  }

  public getCurrentTimeZone(): string | null {
    const timeZone = this.timeZonePort.getCurrentTimeZone();
    return timeZone !== null && this.timeZonePort.isValidTimeZone(timeZone)
      ? timeZone
      : null;
  }

  public getSlot(slotId: string): Slot | null {
    return this.state.slots.find((slot) => slot.id === slotId) ?? null;
  }

  public selectSlot(slotId: string): boolean {
    if (!this.state.slots.some((slot) => slot.id === slotId)) {
      return false;
    }

    this.selectedSlotId = slotId;
    return true;
  }

  public async createSlot(
    input: SlotFormInput,
  ): Promise<Result<Readonly<{ slotId: string }>, AppControllerError>> {
    const timeZone = this.getCurrentTimeZone();
    if (timeZone === null) {
      return failure({
        code: "invalid_time_zone",
        message: "브라우저에서 유효한 IANA 시간대를 확인할 수 없습니다.",
      });
    }

    const slotId = this.idGenerator.createId();
    const result = createSlot(this.state, { ...input, id: slotId, timeZone });
    if (!result.ok) {
      return result;
    }

    const saveResult = await this.saveState(result.value.state);
    if (!saveResult.ok) {
      return saveResult;
    }

    this.state = result.value.state;
    this.selectedSlotId = slotId;
    return success({ slotId });
  }

  public async updateSlot(
    slotId: string,
    input: SlotFormInput,
    resetLastGeneratedTime = false,
  ): Promise<Result<void, AppControllerError>> {
    const result = updateSlot(this.state, slotId, {
      ...input,
      resetLastGeneratedTime,
    });
    if (!result.ok) {
      return result;
    }

    return this.commit(result.value);
  }

  public async deleteSlot(slotId: string): Promise<Result<void, AppControllerError>> {
    const deletedIndex = this.state.slots.findIndex((slot) => slot.id === slotId);
    const result = deleteSlot(this.state, slotId);
    if (!result.ok) {
      return result;
    }

    const saveResult = await this.saveState(result.value);
    if (!saveResult.ok) {
      return saveResult;
    }

    this.state = result.value;
    if (this.selectedSlotId === slotId) {
      this.selectedSlotId =
        this.state.slots[deletedIndex]?.id ??
        this.state.slots[deletedIndex - 1]?.id ??
        null;
    }

    return success(undefined);
  }

  public async generateNextTime(
    slotId: string,
  ): Promise<Result<GeneratedTime, AppControllerError>> {
    const slotIndex = this.state.slots.findIndex((slot) => slot.id === slotId);
    const slot = this.state.slots[slotIndex];
    if (slot === undefined) {
      return failure({
        code: "slot_not_found",
        message: "시간을 생성할 슬롯을 찾을 수 없습니다.",
      });
    }

    const generationResult = generateNextTime(
      slot,
      this.randomSource,
      this.timeZonePort,
    );
    if (!generationResult.ok) {
      return generationResult;
    }

    const slots = [...this.state.slots];
    slots[slotIndex] = {
      ...slot,
      lastGeneratedTime: generationResult.value,
    };
    const nextState: AppState = { ...this.state, slots };
    const saveResult = await this.saveState(nextState);
    if (!saveResult.ok) {
      return saveResult;
    }

    this.state = nextState;
    return success(generationResult.value);
  }

  public async setShellFormat(
    shellFormat: ShellFormat,
  ): Promise<Result<void, AppControllerError>> {
    if (!isShellFormat(shellFormat)) {
      return failure({
        code: "invalid_shell_format",
        message: "지원하는 셸 형식이 아닙니다.",
      });
    }

    if (this.state.shellFormat === shellFormat) {
      return success(undefined);
    }

    return this.commit({ ...this.state, shellFormat });
  }

  public getGitCommand(slotId: string): string | null {
    const slot = this.getSlot(slotId);
    if (slot?.lastGeneratedTime === null || slot === null || this.state.shellFormat === null) {
      return null;
    }

    return formatGitCommand(slot.lastGeneratedTime, this.state.shellFormat);
  }

  public async copyGitCommand(
    slotId: string,
  ): Promise<Result<void, AppControllerError>> {
    const command = this.getGitCommand(slotId);
    if (command === null) {
      return failure({
        code: "command_unavailable",
        message: "생성 시간과 셸 형식을 먼저 선택해야 합니다.",
      });
    }

    return this.clipboardPort.writeText(command);
  }

  public exportBackup(): Result<void, AppControllerError> {
    let content: string;
    try {
      content = encodeAppStateJson(this.state, true);
    } catch {
      return failure({
        code: "invalid_backup",
        message: "현재 상태를 백업 JSON으로 만들지 못했습니다.",
      });
    }

    return this.backupFilePort.downloadText("time-generator-backup.json", content);
  }

  public async prepareBackupImport(
    file: unknown,
  ): Promise<Result<PreparedBackupImport, AppControllerError>> {
    const readResult = await this.backupFilePort.readText(file);
    if (!readResult.ok) {
      return readResult;
    }

    const decodeResult = decodeAppStateJson(readResult.value, this.timeZonePort);
    if (!decodeResult.ok) {
      return failure({
        code: "invalid_backup",
        message: decodeResult.error.message,
      });
    }

    return success(decodeResult.value);
  }

  public async applyBackupImport(
    prepared: PreparedBackupImport,
  ): Promise<Result<void, AppControllerError>> {
    const saveResult = await this.saveState(prepared.state);
    if (!saveResult.ok) {
      return saveResult;
    }

    this.state = prepared.state;
    this.selectedSlotId = prepared.state.slots[0]?.id ?? null;
    return success(undefined);
  }

  private async commit(nextState: AppState): Promise<Result<void, StateWriteError>> {
    const saveResult = await this.saveState(nextState);
    if (!saveResult.ok) {
      return saveResult;
    }

    this.state = nextState;
    return success(undefined);
  }

  private async saveState(state: AppState): Promise<Result<void, StateWriteError>> {
    if (this.saveInProgress) {
      return failure({
        code: "save_in_progress",
        message: "이전 변경 내용을 저장하고 있습니다. 잠시 후 다시 시도해 주세요.",
      });
    }

    this.saveInProgress = true;
    try {
      return await this.stateWriter.save(state);
    } finally {
      this.saveInProgress = false;
    }
  }
}

function isShellFormat(value: string): value is ShellFormat {
  return value === "bash" || value === "powershell" || value === "cmd";
}
