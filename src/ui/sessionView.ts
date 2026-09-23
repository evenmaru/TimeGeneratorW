import { type AppSession, type AppSessionSnapshot } from "../application/appSession";
import type { AppController } from "../application/appController";
import type { SyncStatusUpdate } from "../application/synchronizedAppStateWriter";
import { mountApp, type AppViewHandle } from "./appView";

export function mountSessionApp(root: HTMLElement, session: AppSession): void {
  new SessionView(root, session).mount();
}

class SessionView {
  private readyView: AppViewHandle | null = null;
  private readyController: AppController | null = null;

  public constructor(
    private readonly root: HTMLElement,
    private readonly session: AppSession,
  ) {}

  public mount(): void {
    this.session.subscribe(() => this.render());
    this.render();
    this.session.start();
  }

  private render(): void {
    const snapshot = this.session.getSnapshot();
    if (snapshot.phase === "ready") {
      if (this.readyView !== null && this.readyController === snapshot.controller) {
        this.readyView.refresh();
        return;
      }
      this.readyController = snapshot.controller;
      this.readyView = mountApp(this.root, snapshot.controller, snapshot.notices, {
        user: snapshot.user,
        getSyncStatus: (): SyncStatusUpdate => {
          const current = this.session.getSnapshot();
          return current.phase === "ready"
            ? { status: current.syncStatus, message: current.message }
            : { status: "sync_error", message: "로그인 상태가 변경되었습니다." };
        },
        onSignOut: () => this.session.signOut(),
      });
      return;
    }

    this.readyController = null;
    this.readyView = null;
    this.root.innerHTML = renderSessionState(snapshot);
    this.bindEvents(snapshot);

    if (snapshot.phase === "migration") {
      queueMicrotask(() => this.root.querySelector<HTMLDialogElement>("#migration-dialog")?.showModal());
    }
  }

  private bindEvents(snapshot: AppSessionSnapshot): void {
    this.root.querySelector<HTMLButtonElement>("[data-sign-in]")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "로그인 중…";
      void this.session.signIn();
    });
    this.root.querySelector<HTMLButtonElement>("[data-retry]")?.addEventListener("click", () => {
      void this.session.retry();
    });
    this.root.querySelector<HTMLButtonElement>("[data-sign-out]")?.addEventListener("click", () => {
      void this.session.signOut();
    });
    this.root.querySelector<HTMLButtonElement>("[data-use-local]")?.addEventListener("click", () => {
      this.disableMigrationActions();
      void this.session.resolveMigration(true);
    });
    this.root.querySelector<HTMLButtonElement>("[data-use-empty]")?.addEventListener("click", () => {
      this.disableMigrationActions();
      void this.session.resolveMigration(false);
    });

    if (snapshot.phase === "error") {
      this.root.querySelector<HTMLElement>("[data-error-panel]")?.focus();
    }
  }

  private disableMigrationActions(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-use-local], [data-use-empty]")
      .forEach((button) => {
        button.disabled = true;
      });
  }
}

function renderSessionState(snapshot: AppSessionSnapshot): string {
  const content = renderSessionContent(snapshot);
  return `
    <div class="app-shell app-shell--session">
      <header class="app-header session-header">
        <div class="app-header__copy">
          <p class="app-header__eyebrow"><span aria-hidden="true">↗</span> 개인용 커밋 시간 도구</p>
          <h1>Time-Generator<span aria-hidden="true">.</span></h1>
          <p class="app-header__description">
            Google 계정으로 로그인하면 여러 기기에서 같은 데이터를 사용할 수 있습니다.
          </p>
        </div>
      </header>
      ${content}
    </div>
  `;
}

function renderSessionContent(snapshot: AppSessionSnapshot): string {
  switch (snapshot.phase) {
    case "checking_auth":
      return renderGatePanel("로그인 상태 확인 중", "저장된 로그인 정보를 확인하고 있습니다.");
    case "signed_out":
      return `
        <main class="panel session-panel" aria-labelledby="session-title">
          <p class="panel__eyebrow">Firebase 동기화</p>
          <h2 id="session-title">Google 계정으로 시작하세요</h2>
          <p>로그인한 한 계정의 데이터만 Firestore에 저장하고 다른 기기와 자동으로 동기화합니다.</p>
          ${renderInlineError(snapshot.message)}
          <button class="button button--primary" type="button" data-sign-in>Google로 로그인</button>
        </main>
      `;
    case "loading":
      return renderGatePanel("Firebase 데이터 불러오는 중", "계정 데이터를 안전하게 확인하고 있습니다.");
    case "error":
      return `
        <main class="panel session-panel" data-error-panel tabindex="-1" aria-labelledby="session-title">
          <p class="panel__eyebrow">연결 확인 필요</p>
          <h2 id="session-title">Firebase에 연결하지 못했습니다</h2>
          ${renderInlineError(snapshot.message)}
          <p class="session-panel__uid">현재 UID <code>${escapeHtml(snapshot.user.uid)}</code></p>
          <div class="session-panel__actions">
            <button class="button button--primary" type="button" data-retry>다시 시도</button>
            <button class="button button--secondary" type="button" data-sign-out>로그아웃</button>
          </div>
        </main>
      `;
    case "migration":
      return `
        ${renderGatePanel("기존 데이터 확인", "이 브라우저의 기존 데이터를 어떻게 처리할지 선택해 주세요.")}
        <dialog id="migration-dialog" class="dialog" aria-labelledby="migration-title">
          <div class="dialog__form">
            <div class="dialog__heading">
              <p class="dialog__warning-label">최초 동기화</p>
              <h2 id="migration-title">기존 로컬 데이터를 가져올까요?</h2>
            </div>
            <p class="dialog__description">
              이 브라우저에 슬롯 ${snapshot.localState.slots.length}개가 있습니다. Firebase로 올리면 다른 기기에서도 이어서 사용할 수 있습니다.
            </p>
            <div class="dialog__actions dialog__actions--stack-mobile">
              <button class="button button--secondary" type="button" data-use-empty>빈 데이터로 시작</button>
              <button class="button button--primary" type="button" data-use-local>기존 데이터 가져오기</button>
            </div>
          </div>
        </dialog>
      `;
    case "ready":
      return "";
  }
}

function renderGatePanel(title: string, description: string): string {
  return `
    <main class="panel session-panel" aria-live="polite">
      <p class="panel__eyebrow">Firebase 동기화</p>
      <h2>${title}</h2>
      <p>${description}</p>
      <span class="session-loader" aria-hidden="true"></span>
    </main>
  `;
}

function renderInlineError(message: string | null): string {
  return message === null ? "" : `<p class="session-panel__error" role="alert">${escapeHtml(message)}</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
