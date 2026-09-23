import { AppController } from "../application/appController";
import { AppSession } from "../application/appSession";
import type { AppStateWriter } from "../application/ports/appStateWriter";
import type { AppState } from "../domain/models";
import { BrowserKeyValueStorage } from "../infrastructure/browser/browserKeyValueStorage";
import { BrowserBackupFileAdapter } from "../infrastructure/browser/browserBackupFileAdapter";
import { BrowserClipboardAdapter } from "../infrastructure/browser/browserClipboardAdapter";
import { CryptoIdGenerator } from "../infrastructure/browser/cryptoIdGenerator";
import { CryptoRandomSource } from "../infrastructure/browser/cryptoRandomSource";
import { IntlTimeZoneAdapter } from "../infrastructure/browser/intlTimeZoneAdapter";
import { LocalStorageAppStateRepository } from "../infrastructure/storage/localStorageAppStateRepository";
import { FirebaseAuthGateway } from "../infrastructure/firebase/firebaseAuthGateway";
import { FirestoreAppStateRepository } from "../infrastructure/firebase/firestoreAppStateRepository";
import { mountApp } from "../ui/appView";
import { mountSessionApp } from "../ui/sessionView";

export function createApp(root: HTMLElement): void {
  const timeZoneAdapter = new IntlTimeZoneAdapter();
  const repository = new LocalStorageAppStateRepository(
    new BrowserKeyValueStorage(),
    timeZoneAdapter,
  );
  const createController = (state: AppState, writer: AppStateWriter) =>
    new AppController(
      state,
      writer,
      new CryptoIdGenerator(),
      new CryptoRandomSource(),
      timeZoneAdapter,
      new BrowserClipboardAdapter(),
      new BrowserBackupFileAdapter(),
    );

  if (import.meta.env.VITE_USE_LOCAL_SESSION === "1") {
    const loadResult = repository.load();
    const controller = createController(loadResult.state, repository);
    mountApp(root, controller, loadResult.notices, {
      user: {
        uid: "e2e-local-user",
        email: "local-test@example.com",
        displayName: "로컬 테스트",
        photoUrl: null,
      },
      getSyncStatus: () => ({ status: "synced", message: null }),
      onSignOut: async () => undefined,
    });
    return;
  }

  const session = new AppSession(
    new FirebaseAuthGateway(),
    new FirestoreAppStateRepository(timeZoneAdapter),
    repository,
    createController,
  );
  mountSessionApp(root, session);
}
