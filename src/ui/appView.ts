import {
  type AppController,
  type AppControllerError,
  type PreparedBackupImport,
  type SlotFormInput,
} from "../application/appController";
import type { StartupNotice } from "../application/ports/appStateRepository";
import {
  MAX_SLOT_COUNT,
  type ShellFormat,
  type Slot,
} from "../domain/models";
import {
  getValidTimelineProgress,
  hasWeekday,
} from "../domain/time/validTimeAxis";

type SlotFormMode = "create" | "edit";

type PendingDateReset = Readonly<{
  slotId: string;
  input: SlotFormInput;
}>;

export function mountApp(
  root: HTMLElement,
  controller: AppController,
  startupNotices: readonly StartupNotice[] = [],
): void {
  new AppView(root, controller, startupNotices).mount();
}

class AppView {
  private pendingDateReset: PendingDateReset | null = null;
  private statusMessage: Readonly<{ message: string; tone: "warning" | "error" }> | null;
  private generationMessage:
    | Readonly<{ slotId: string; message: string; tone: "warning" | "error" }>
    | null = null;
  private copyMessage:
    | Readonly<{ slotId: string; message: string; tone: "error" }>
    | null = null;
  private pendingBackupImport: PreparedBackupImport | null = null;
  private dataMessage:
    | Readonly<{ message: string; tone: "success" | "error" }>
    | null = null;

  public constructor(
    private readonly root: HTMLElement,
    private readonly controller: AppController,
    startupNotices: readonly StartupNotice[],
  ) {
    this.statusMessage =
      startupNotices.length === 0
        ? null
        : {
            message: startupNotices.map((notice) => notice.message).join(" "),
            tone: startupNotices.some((notice) => notice.tone === "error")
              ? "error"
              : "warning",
          };
  }

  public mount(): void {
    this.render();
  }

  private render(focusSlotId?: string, focusSelector?: string): void {
    const snapshot = this.controller.getSnapshot();
    const selectedSlot =
      snapshot.state.slots.find((slot) => slot.id === snapshot.selectedSlotId) ?? null;
    const currentTimeZone = this.controller.getCurrentTimeZone();
    const gitCommand =
      selectedSlot === null ? null : this.controller.getGitCommand(selectedSlot.id);

    this.root.innerHTML = `
      <div class="app-shell">
        <header class="app-header">
          <div class="app-header__copy">
            <p class="app-header__eyebrow"><span aria-hidden="true">↗</span> 개인용 커밋 시간 도구</p>
            <h1>Time-Generator<span aria-hidden="true">.</span></h1>
            <p class="app-header__description">
              프로젝트별 다음 커밋 시간을 만들고 셸 명령으로 복사하세요.
            </p>
          </div>
          <div class="app-header__aside">
            <div class="workflow-route" aria-hidden="true">
              <span><i>01</i> 범위 설정</span>
              <b></b>
              <span><i>02</i> 시간 생성</span>
              <b></b>
              <span><i>03</i> 명령 복사</span>
            </div>
            <p class="storage-note"><span aria-hidden="true"></span> 이 브라우저에만 저장됩니다.</p>
          </div>
        </header>

        ${renderStatusBanner(this.statusMessage)}

        <main class="app-content">
          ${renderSlotPanel(snapshot.state.slots, snapshot.selectedSlotId)}
          ${renderWorkspace(
            selectedSlot,
            snapshot.state.shellFormat,
            gitCommand,
            selectedSlot !== null && this.generationMessage?.slotId === selectedSlot.id
              ? this.generationMessage
              : null,
            selectedSlot !== null && this.copyMessage?.slotId === selectedSlot.id
              ? this.copyMessage
              : null,
          )}
          ${renderDataManagement(this.dataMessage)}
        </main>
      </div>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      ${renderSlotFormDialog(currentTimeZone)}
      ${renderDateResetDialog()}
      ${renderDeleteDialog()}
      ${renderImportDialog()}
    `;

    this.bindEvents();

    if (focusSlotId !== undefined) {
      queueMicrotask(() => {
        this.root
          .querySelector<HTMLElement>(`[data-select-slot="${escapeSelector(focusSlotId)}"]`)
          ?.focus();
      });
    } else if (focusSelector !== undefined) {
      queueMicrotask(() => this.root.querySelector<HTMLElement>(focusSelector)?.focus());
    }
  }

  private bindEvents(): void {
    this.root.querySelector<HTMLButtonElement>("[data-add-slot]")?.addEventListener("click", () => {
      this.openSlotForm("create");
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-select-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.selectSlot;
        if (slotId !== undefined && this.controller.selectSlot(slotId)) {
          this.generationMessage = null;
          this.copyMessage = null;
          this.render(slotId);
        }
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-edit-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.editSlot;
        const slot = slotId === undefined ? null : this.controller.getSlot(slotId);
        if (slot !== null) {
          this.openSlotForm("edit", slot);
        }
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-delete-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.deleteSlot;
        const slot = slotId === undefined ? null : this.controller.getSlot(slotId);
        if (slot !== null) {
          this.openDeleteDialog(slot);
        }
      });
    });

    const slotForm = this.root.querySelector<HTMLFormElement>("#slot-form");
    slotForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitSlotForm(slotForm);
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => button.closest("dialog")?.close());
    });

    this.root
      .querySelector<HTMLButtonElement>("[data-confirm-date-reset]")
      ?.addEventListener("click", () => this.confirmDateReset());

    this.root
      .querySelector<HTMLButtonElement>("[data-confirm-delete]")
      ?.addEventListener("click", () => this.confirmDelete());

    this.root
      .querySelector<HTMLButtonElement>("[data-generate-time]")
      ?.addEventListener("click", (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const slotId = button.dataset.generateTime;
        if (slotId !== undefined) {
          this.generateTime(slotId);
        }
      });

    this.root
      .querySelector<HTMLButtonElement>("[data-export-backup]")
      ?.addEventListener("click", () => this.exportBackup());

    this.root
      .querySelector<HTMLInputElement>("[data-import-backup]")
      ?.addEventListener("change", (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (file !== undefined) {
          void this.prepareBackupImport(file);
        }
      });

    this.root
      .querySelector<HTMLElement>("[data-import-label]")
      ?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.root.querySelector<HTMLInputElement>("[data-import-backup]")?.click();
        }
      });

    const importDialog = this.root.querySelector<HTMLDialogElement>("#import-dialog");
    importDialog?.addEventListener("close", () => {
      this.pendingBackupImport = null;
    });
    this.root
      .querySelector<HTMLButtonElement>("[data-confirm-import]")
      ?.addEventListener("click", () => this.confirmBackupImport());

    this.root
      .querySelectorAll<HTMLInputElement>('input[name="shellFormat"]')
      .forEach((input) => {
        input.addEventListener("change", () => {
          if (input.checked && isShellFormat(input.value)) {
            const result = this.controller.setShellFormat(input.value);
            if (!result.ok) {
              this.showBanner(result.error.message);
              return;
            }
            this.copyMessage = null;
            this.render(undefined, `input[value="${input.value}"]`);
          }
        });
      });

    this.root
      .querySelector<HTMLButtonElement>("[data-copy-command]")
      ?.addEventListener("click", (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const slotId = button.dataset.copyCommand;
        if (slotId !== undefined) {
          void this.copyCommand(slotId, button);
        }
      });
  }

  private openSlotForm(mode: SlotFormMode, slot?: Slot): void {
    const dialog = this.requireElement<HTMLDialogElement>("#slot-form-dialog");
    const form = this.requireElement<HTMLFormElement>("#slot-form");
    const title = this.requireElement<HTMLElement>("#slot-form-title");
    const submitButton = this.requireElement<HTMLButtonElement>("#slot-form-submit");
    const nameInput = this.requireElement<HTMLInputElement>("#slot-name");
    const startDateInput = this.requireElement<HTMLInputElement>("#slot-start-date");
    const endDateInput = this.requireElement<HTMLInputElement>("#slot-end-date");

    form.reset();
    this.clearFormErrors(form);
    form.dataset.mode = mode;
    form.dataset.slotId = slot?.id ?? "";
    title.textContent = mode === "create" ? "새 슬롯 만들기" : "슬롯 편집";
    submitButton.textContent = mode === "create" ? "슬롯 만들기" : "변경 저장";
    nameInput.value = slot?.name ?? "";
    startDateInput.value = slot?.startDate ?? "";
    endDateInput.value = slot?.endDate ?? "";
    dialog.showModal();
    nameInput.focus();
  }

  private submitSlotForm(form: HTMLFormElement): void {
    this.clearFormErrors(form);

    const formData = new FormData(form);
    const input: SlotFormInput = {
      name: String(formData.get("name") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
    };
    const mode = form.dataset.mode as SlotFormMode | undefined;
    const slotId = form.dataset.slotId ?? "";
    const result =
      mode === "edit"
        ? this.controller.updateSlot(slotId, input)
        : this.controller.createSlot(input);

    if (!result.ok) {
      if (result.error.code === "last_generated_time_out_of_range") {
        this.pendingDateReset = { slotId, input };
        this.requireElement<HTMLDialogElement>("#slot-form-dialog").close();
        this.openDateResetDialog(slotId);
        return;
      }

      if (this.showFormError(result.error)) {
        return;
      }

      this.showBanner(result.error.message);
      return;
    }

    this.requireElement<HTMLDialogElement>("#slot-form-dialog").close();
    const focusId =
      mode === "edit"
        ? slotId
        : (result.value as Readonly<{ slotId: string }>).slotId;
    this.render(focusId);
  }

  private showFormError(error: AppControllerError): boolean {
    if (error.code === "invalid_name") {
      this.setFieldError("slot-name", "slot-name-error", error.message);
      return true;
    }

    if (error.code === "invalid_date") {
      const inputId = error.field === "startDate" ? "slot-start-date" : "slot-end-date";
      const errorId = error.field === "startDate" ? "slot-start-date-error" : "slot-end-date-error";
      this.setFieldError(inputId, errorId, error.message);
      return true;
    }

    if (error.code === "invalid_date_range") {
      this.setFieldError("slot-start-date", "slot-date-range-error", error.message);
      this.requireElement<HTMLInputElement>("#slot-end-date").setAttribute(
        "aria-invalid",
        "true",
      );
      return true;
    }

    return false;
  }

  private openDateResetDialog(slotId: string): void {
    const slot = this.controller.getSlot(slotId);
    const description = this.requireElement<HTMLElement>("#date-reset-description");
    description.textContent = `${slot?.name ?? "이 슬롯"}의 마지막 생성 시간이 새 날짜 범위를 벗어납니다. 날짜를 변경하면 마지막 생성 기록이 초기화됩니다.`;
    this.requireElement<HTMLDialogElement>("#date-reset-dialog").showModal();
  }

  private confirmDateReset(): void {
    if (this.pendingDateReset === null) {
      return;
    }

    const { slotId, input } = this.pendingDateReset;
    const result = this.controller.updateSlot(slotId, input, true);
    if (!result.ok) {
      this.showBanner(result.error.message);
      return;
    }

    this.pendingDateReset = null;
    this.requireElement<HTMLDialogElement>("#date-reset-dialog").close();
    this.render(slotId);
  }

  private openDeleteDialog(slot: Slot): void {
    const dialog = this.requireElement<HTMLDialogElement>("#delete-dialog");
    const details = this.requireElement<HTMLElement>("#delete-slot-details");
    const confirmButton = this.requireElement<HTMLButtonElement>("[data-confirm-delete]");
    details.textContent = `${slot.name} · ${slot.startDate}–${slot.endDate} · ${slot.timeZone}. 날짜 설정, 시간대와 마지막 생성 시간이 모두 삭제됩니다.`;
    confirmButton.dataset.slotId = slot.id;
    dialog.showModal();
  }

  private confirmDelete(): void {
    const confirmButton = this.requireElement<HTMLButtonElement>("[data-confirm-delete]");
    const slotId = confirmButton.dataset.slotId;
    if (slotId === undefined) {
      return;
    }

    const result = this.controller.deleteSlot(slotId);
    if (!result.ok) {
      this.showBanner(result.error.message);
      return;
    }

    this.requireElement<HTMLDialogElement>("#delete-dialog").close();
    this.render(this.controller.getSnapshot().selectedSlotId ?? undefined);
  }

  private generateTime(slotId: string): void {
    const result = this.controller.generateNextTime(slotId);
    if (!result.ok) {
      this.generationMessage = {
        slotId,
        message: result.error.message,
        tone: result.error.code === "no_available_time" ? "warning" : "error",
      };
      this.render(undefined, "[data-generate-time]");
      return;
    }

    this.generationMessage = null;
    this.copyMessage = null;
    this.render(undefined, "[data-generate-time]");
  }

  private async copyCommand(slotId: string, button: HTMLButtonElement): Promise<void> {
    const result = await this.controller.copyGitCommand(slotId);
    if (!result.ok) {
      this.copyMessage = { slotId, message: result.error.message, tone: "error" };
      this.render(undefined, "[data-copy-command]");
      return;
    }

    this.copyMessage = null;
    this.root.querySelector(".copy-message")?.remove();
    button.textContent = "복사됨";
    this.showToast("클립보드에 복사했습니다.");
    window.setTimeout(() => {
      if (button.isConnected) {
        button.textContent = "명령 복사";
      }
    }, 4_000);
  }

  private exportBackup(): void {
    const result = this.controller.exportBackup();
    if (!result.ok) {
      this.dataMessage = { message: result.error.message, tone: "error" };
      this.render(undefined, "[data-export-backup]");
      return;
    }

    this.dataMessage = null;
    this.showToast("백업 JSON 파일을 저장했습니다.");
  }

  private async prepareBackupImport(file: File): Promise<void> {
    const result = await this.controller.prepareBackupImport(file);
    if (!result.ok) {
      this.dataMessage = { message: result.error.message, tone: "error" };
      this.render(undefined, "[data-import-label]");
      return;
    }

    this.pendingBackupImport = result.value;
    const summary = this.requireElement<HTMLElement>("#import-summary");
    const shellLabel = getShellLabel(result.value.state.shellFormat);
    summary.textContent = `슬롯 ${result.value.state.slots.length}개 · 출력 형식 ${shellLabel}. 가져오면 현재 상태 전체를 교체합니다.`;
    const normalizedNotice = this.requireElement<HTMLElement>("#import-normalized-notice");
    normalizedNotice.hidden = !result.value.normalized;
    this.requireElement<HTMLElement>("#import-error").hidden = true;
    this.requireElement<HTMLDialogElement>("#import-dialog").showModal();
  }

  private confirmBackupImport(): void {
    if (this.pendingBackupImport === null) {
      return;
    }

    const normalized = this.pendingBackupImport.normalized;
    const result = this.controller.applyBackupImport(this.pendingBackupImport);
    if (!result.ok) {
      const error = this.requireElement<HTMLElement>("#import-error");
      error.textContent = result.error.message;
      error.hidden = false;
      return;
    }

    this.requireElement<HTMLDialogElement>("#import-dialog").close();
    this.pendingBackupImport = null;
    this.generationMessage = null;
    this.copyMessage = null;
    this.dataMessage = {
      message: normalized
        ? "백업을 가져오고 안전하게 정리할 값을 반영했습니다."
        : "백업을 가져왔습니다.",
      tone: "success",
    };
    this.render(this.controller.getSnapshot().selectedSlotId ?? undefined);
    this.showToast("백업 JSON을 가져왔습니다.");
  }

  private showToast(message: string): void {
    const toast = this.requireElement<HTMLElement>("#toast");
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => {
      if (toast.isConnected) {
        toast.hidden = true;
      }
    }, 4_000);
  }

  private setFieldError(inputId: string, errorId: string, message: string): void {
    const input = this.requireElement<HTMLInputElement>(`#${inputId}`);
    const error = this.requireElement<HTMLElement>(`#${errorId}`);
    input.setAttribute("aria-invalid", "true");
    error.textContent = message;
    error.hidden = false;
    input.focus();
  }

  private clearFormErrors(form: HTMLFormElement): void {
    form.querySelectorAll<HTMLElement>("[data-field-error]").forEach((element) => {
      element.hidden = true;
      element.textContent = "";
    });
    form.querySelectorAll<HTMLInputElement>("[aria-invalid]").forEach((input) => {
      input.removeAttribute("aria-invalid");
    });
  }

  private showBanner(message: string): void {
    this.statusMessage = { message, tone: "error" };
    const banner = this.requireElement<HTMLElement>("#status-banner");
    banner.textContent = message;
    banner.className = "status-banner status-banner--error";
    banner.hidden = false;
    banner.tabIndex = -1;
    banner.focus();
  }

  private requireElement<TElement extends Element>(selector: string): TElement {
    const element = this.root.querySelector<TElement>(selector);
    if (element === null) {
      throw new Error(`필수 UI 요소를 찾을 수 없습니다: ${selector}`);
    }
    return element;
  }
}

function renderStatusBanner(
  status: Readonly<{ message: string; tone: "warning" | "error" }> | null,
): string {
  if (status === null) {
    return '<div id="status-banner" class="status-banner" role="alert" hidden></div>';
  }

  return `
    <div
      id="status-banner"
      class="status-banner status-banner--${status.tone}"
      role="alert"
      tabindex="-1"
    >${escapeHtml(status.message)}</div>
  `;
}

function renderSlotPanel(slots: readonly Slot[], selectedSlotId: string | null): string {
  const atLimit = slots.length >= MAX_SLOT_COUNT;

  return `
    <section class="panel slot-panel" aria-labelledby="slot-panel-title">
      <header class="panel__header">
        <div class="panel__title-group">
          <h2 id="slot-panel-title">슬롯</h2>
          <span class="slot-count" aria-label="슬롯 ${slots.length}개, 최대 ${MAX_SLOT_COUNT}개">
            ${slots.length} / ${MAX_SLOT_COUNT}
          </span>
        </div>
        <button
          class="button ${slots.length === 0 ? "button--primary" : "button--secondary"}"
          type="button"
          data-add-slot
          ${atLimit ? "disabled" : ""}
        >슬롯 추가</button>
      </header>
      ${
        atLimit
          ? '<p class="limit-message">슬롯은 최대 5개까지 만들 수 있습니다.</p>'
          : ""
      }
      ${
        slots.length === 0
          ? renderEmptySlot()
          : `<div class="slot-rack">${slots
              .map((slot, index) => renderSlotRow(slot, index, selectedSlotId === slot.id))
              .join("")}</div>`
      }
    </section>
  `;
}

function renderEmptySlot(): string {
  return `
    <div class="empty-slot">
      <div class="empty-slot__track" aria-hidden="true">
        <span></span><i></i><span></span>
      </div>
      <h3>첫 슬롯을 만들어 시작하세요</h3>
      <p>날짜 범위와 이름을 정하면 다음 커밋 시간을 생성할 수 있습니다.</p>
    </div>
  `;
}

function renderSlotRow(slot: Slot, index: number, selected: boolean): string {
  const slotNumber = String(index + 1).padStart(2, "0");
  const hasValidWeekday = hasWeekday(slot.startDate, slot.endDate);
  const progress = getValidTimelineProgress(
    slot.startDate,
    slot.endDate,
    slot.lastGeneratedTime?.localDateTime ?? null,
  );
  const progressPercent = Math.max(0, Math.min(100, (progress ?? 0) * 100));
  const generatedDescription = slot.lastGeneratedTime?.localDateTime.replace("T", " ");
  const accessibleName = `SLOT ${slotNumber} ${slot.name}, ${slot.startDate}부터 ${slot.endDate}, ${generatedDescription === undefined ? "생성 기록 없음" : `마지막 ${generatedDescription}`}, ${slot.timeZone}`;

  return `
    <article class="slot-row${selected ? " slot-row--selected" : ""}">
      <button
        class="slot-row__select"
        type="button"
        data-select-slot="${escapeHtml(slot.id)}"
        aria-pressed="${selected}"
        aria-label="${escapeHtml(accessibleName)}"
      >
        <span class="slot-row__heading">
          <span class="slot-row__identity">
            <span class="slot-number">SLOT ${slotNumber}</span>
            <strong title="${escapeHtml(slot.name)}">${escapeHtml(slot.name)}</strong>
          </span>
          ${selected ? '<span class="selected-label">✓ 선택됨</span>' : ""}
        </span>
        <span class="time-track${hasValidWeekday ? "" : " time-track--disabled"}" aria-hidden="true">
          <span class="time-track__endpoint time-track__endpoint--start"></span>
          <span class="time-track__line">
            ${
              progress === null
                ? ""
                : `<span class="time-track__progress" style="width: ${progressPercent}%"></span>
                   <span class="time-track__marker" style="left: ${progressPercent}%"></span>`
            }
          </span>
          <span class="time-track__endpoint"></span>
        </span>
        <span class="slot-row__dates">
          <time datetime="${slot.startDate}">${slot.startDate}</time>
          <time datetime="${slot.endDate}">${slot.endDate}</time>
        </span>
        <span class="slot-row__meta">${
          hasValidWeekday
            ? generatedDescription === undefined
              ? "생성 기록 없음"
              : `마지막 ${generatedDescription}`
            : "생성 가능한 평일 없음"
        } · ${escapeHtml(slot.timeZone)}</span>
      </button>
      <div class="slot-row__actions">
        <button class="text-button" type="button" data-edit-slot="${escapeHtml(slot.id)}">편집</button>
        <button class="text-button text-button--danger" type="button" data-delete-slot="${escapeHtml(slot.id)}">삭제</button>
      </div>
    </article>
  `;
}

function renderWorkspace(
  slot: Slot | null,
  shellFormat: ShellFormat | null,
  gitCommand: string | null,
  generationMessage: Readonly<{ message: string; tone: "warning" | "error" }> | null,
  copyMessage: Readonly<{ message: string; tone: "error" }> | null,
): string {
  if (slot === null) {
    return `
      <section class="panel workspace-panel" aria-labelledby="workspace-title">
        <header class="panel__header">
          <div>
            <p class="panel__eyebrow">선택한 슬롯</p>
            <h2 id="workspace-title">시간 생성 준비</h2>
          </div>
        </header>
        <div class="workspace-empty">
          <p>슬롯을 만들면 다음 커밋 시간과 Git 명령을 이곳에서 확인할 수 있습니다.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel workspace-panel" aria-labelledby="workspace-title">
      <header class="workspace-heading">
        <div>
          <p class="panel__eyebrow">선택한 슬롯</p>
          <h2 id="workspace-title">${escapeHtml(slot.name)}</h2>
        </div>
        <span class="timezone-badge">${escapeHtml(slot.timeZone)}</span>
      </header>
      <p class="workspace-range">${slot.startDate} – ${slot.endDate}</p>

      <section class="generation-section" aria-labelledby="generation-title">
        <div>
          <h3 id="generation-title">다음 시간 생성</h3>
          <p>평일 09:00–23:00 · 간격 10분–3시간</p>
        </div>
        <button
          class="button button--primary button--wide"
          type="button"
          data-generate-time="${escapeHtml(slot.id)}"
        >
          시간 생성
        </button>
        ${
          generationMessage === null
            ? ""
            : `<p class="generation-message generation-message--${generationMessage.tone}" ${generationMessage.tone === "error" ? 'role="alert"' : ""}>${escapeHtml(generationMessage.message)}</p>`
        }
      </section>

      <section class="result-section" aria-labelledby="result-title">
        <h3 id="result-title">생성 결과</h3>
        ${renderGenerationResult(slot)}
      </section>

      ${renderCommandSection(slot, shellFormat, gitCommand, copyMessage)}
    </section>
  `;
}

function renderCommandSection(
  slot: Slot,
  shellFormat: ShellFormat | null,
  gitCommand: string | null,
  copyMessage: Readonly<{ message: string; tone: "error" }> | null,
): string {
  const instruction =
    slot.lastGeneratedTime === null
      ? "시간을 먼저 생성하세요."
      : shellFormat === null
        ? "사용할 셸을 선택하세요."
        : "";

  return `
    <section class="command-section" aria-labelledby="command-title">
      <fieldset class="shell-selector">
        <legend id="command-title">출력 형식</legend>
        <div class="shell-selector__options">
          ${renderShellOption("bash", "Bash", shellFormat)}
          ${renderShellOption("powershell", "PowerShell", shellFormat)}
          ${renderShellOption("cmd", "cmd.exe", shellFormat)}
        </div>
      </fieldset>
      ${shellFormat === null ? '<p class="shell-help">사용할 셸을 선택하세요.</p>' : ""}

      <div class="command-block">
        <div class="command-block__header">
          <span>Git 명령</span>
          <button
            class="button button--secondary copy-button"
            type="button"
            data-copy-command="${escapeHtml(slot.id)}"
            ${gitCommand === null ? "disabled" : ""}
          >명령 복사</button>
        </div>
        ${
          gitCommand === null
            ? `<p class="command-block__instruction">${instruction}</p>`
            : `<pre tabindex="0"><code>${escapeHtml(gitCommand)}</code></pre>`
        }
      </div>
      ${
        copyMessage === null
          ? ""
          : `<p class="copy-message" role="alert">${escapeHtml(copyMessage.message)}</p>`
      }
    </section>
  `;
}

function renderShellOption(
  value: ShellFormat,
  label: string,
  selected: ShellFormat | null,
): string {
  return `
    <label class="shell-option">
      <input
        type="radio"
        name="shellFormat"
        value="${value}"
        ${selected === value ? "checked" : ""}
      />
      <span>${label}${selected === value ? '<i aria-hidden="true">✓</i>' : ""}</span>
    </label>
  `;
}

function renderDataManagement(
  message: Readonly<{ message: string; tone: "success" | "error" }> | null,
): string {
  return `
    <section class="panel data-management" aria-labelledby="data-management-title">
      <div>
        <p class="panel__eyebrow">로컬 데이터</p>
        <h2 id="data-management-title">백업과 복원</h2>
        <p>현재 브라우저에 저장된 전체 상태를 JSON 파일로 옮길 수 있습니다.</p>
      </div>
      <div class="data-management__actions">
        <button class="button button--secondary" type="button" data-export-backup>
          JSON 내보내기
        </button>
        <label class="button button--secondary file-button" data-import-label tabindex="0">
          JSON 가져오기
          <input
            class="visually-hidden"
            type="file"
            accept="application/json,.json"
            data-import-backup
          />
        </label>
      </div>
      ${
        message === null
          ? ""
          : `<p class="data-message data-message--${message.tone}" ${message.tone === "error" ? 'role="alert"' : 'role="status"'}>${escapeHtml(message.message)}</p>`
      }
    </section>
  `;
}

function renderGenerationResult(slot: Slot): string {
  const generatedTime = slot.lastGeneratedTime;
  if (generatedTime === null) {
    return '<div class="result-placeholder" aria-live="polite">아직 생성된 시간이 없습니다.</div>';
  }

  const displayDateTime = generatedTime.localDateTime.replace("T", " ");
  return `
    <div class="generation-result" aria-live="polite">
      <time datetime="${generatedTime.localDateTime}${generatedTime.utcOffset}">
        ${displayDateTime}
      </time>
      <div class="generation-result__badges">
        <span>UTC${generatedTime.utcOffset}</span>
        <span>${escapeHtml(slot.timeZone)}</span>
      </div>
    </div>
  `;
}

function renderSlotFormDialog(timeZone: string | null): string {
  return `
    <dialog id="slot-form-dialog" class="dialog" aria-labelledby="slot-form-title">
      <form id="slot-form" class="dialog__form" novalidate>
        <div class="dialog__heading">
          <p class="panel__eyebrow">슬롯 설정</p>
          <h2 id="slot-form-title">새 슬롯 만들기</h2>
        </div>

        <div class="field">
          <label for="slot-name">슬롯 이름</label>
          <input id="slot-name" name="name" type="text" autocomplete="off" aria-describedby="slot-name-error" />
          <p id="slot-name-error" class="field-error" data-field-error hidden></p>
        </div>

        <div class="date-fields">
          <div class="field">
            <label for="slot-start-date">시작일</label>
            <input id="slot-start-date" name="startDate" type="date" aria-describedby="slot-start-date-error slot-date-range-error" />
            <p id="slot-start-date-error" class="field-error" data-field-error hidden></p>
          </div>
          <div class="field">
            <label for="slot-end-date">종료일</label>
            <input id="slot-end-date" name="endDate" type="date" aria-describedby="slot-end-date-error slot-date-range-error" />
            <p id="slot-end-date-error" class="field-error" data-field-error hidden></p>
          </div>
        </div>
        <p id="slot-date-range-error" class="field-error" data-field-error hidden></p>

        <div class="field">
          <span class="field__label">시간대</span>
          <output class="read-only-value">${escapeHtml(timeZone ?? "확인할 수 없음")}</output>
          <p class="field-help">슬롯을 만들 때 현재 브라우저의 IANA 시간대를 기록합니다.</p>
        </div>

        <div class="dialog__actions">
          <button class="button button--secondary" type="button" data-close-dialog>취소</button>
          <button id="slot-form-submit" class="button button--primary" type="submit">슬롯 만들기</button>
        </div>
      </form>
    </dialog>
  `;
}

function renderDateResetDialog(): string {
  return `
    <dialog id="date-reset-dialog" class="dialog" aria-labelledby="date-reset-title">
      <div class="dialog__form">
        <div class="dialog__heading">
          <p class="dialog__warning-label">생성 기록 초기화</p>
          <h2 id="date-reset-title">날짜 범위를 변경할까요?</h2>
        </div>
        <p id="date-reset-description" class="dialog__description"></p>
        <div class="dialog__actions">
          <button class="button button--secondary" type="button" data-close-dialog>취소</button>
          <button class="button button--primary" type="button" data-confirm-date-reset>기록 초기화 후 변경</button>
        </div>
      </div>
    </dialog>
  `;
}

function renderDeleteDialog(): string {
  return `
    <dialog id="delete-dialog" class="dialog" aria-labelledby="delete-title">
      <div class="dialog__form">
        <div class="dialog__heading">
          <p class="dialog__danger-label">되돌릴 수 없음</p>
          <h2 id="delete-title">이 슬롯을 삭제할까요?</h2>
        </div>
        <p id="delete-slot-details" class="dialog__description"></p>
        <div class="dialog__actions">
          <button class="button button--secondary" type="button" data-close-dialog>취소</button>
          <button class="button button--danger" type="button" data-confirm-delete>슬롯 삭제</button>
        </div>
      </div>
    </dialog>
  `;
}

function renderImportDialog(): string {
  return `
    <dialog id="import-dialog" class="dialog" aria-labelledby="import-title">
      <div class="dialog__form">
        <div class="dialog__heading">
          <p class="dialog__warning-label">전체 상태 교체</p>
          <h2 id="import-title">이 백업을 가져올까요?</h2>
        </div>
        <p id="import-summary" class="dialog__description"></p>
        <p id="import-normalized-notice" class="dialog__notice" hidden>
          가져오는 과정에서 안전하게 정리할 값이 있습니다.
        </p>
        <p id="import-error" class="field-error" role="alert" hidden></p>
        <div class="dialog__actions">
          <button class="button button--secondary" type="button" data-close-dialog>취소</button>
          <button class="button button--primary" type="button" data-confirm-import>백업 가져오기</button>
        </div>
      </div>
    </dialog>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeSelector(value: string): string {
  return CSS.escape(value);
}

function isShellFormat(value: string): value is ShellFormat {
  return value === "bash" || value === "powershell" || value === "cmd";
}

function getShellLabel(shellFormat: ShellFormat | null): string {
  switch (shellFormat) {
    case "bash":
      return "Bash";
    case "powershell":
      return "PowerShell";
    case "cmd":
      return "cmd.exe";
    case null:
      return "미선택";
  }
}
