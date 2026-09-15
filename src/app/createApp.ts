import { AppController } from "../application/appController";
import { BrowserKeyValueStorage } from "../infrastructure/browser/browserKeyValueStorage";
import { BrowserBackupFileAdapter } from "../infrastructure/browser/browserBackupFileAdapter";
import { BrowserClipboardAdapter } from "../infrastructure/browser/browserClipboardAdapter";
import { CryptoIdGenerator } from "../infrastructure/browser/cryptoIdGenerator";
import { CryptoRandomSource } from "../infrastructure/browser/cryptoRandomSource";
import { IntlTimeZoneAdapter } from "../infrastructure/browser/intlTimeZoneAdapter";
import { LocalStorageAppStateRepository } from "../infrastructure/storage/localStorageAppStateRepository";
import { mountApp } from "../ui/appView";

export function createApp(root: HTMLElement): void {
  const timeZoneAdapter = new IntlTimeZoneAdapter();
  const repository = new LocalStorageAppStateRepository(
    new BrowserKeyValueStorage(),
    timeZoneAdapter,
  );
  const loadResult = repository.load();
  const controller = new AppController(
    loadResult.state,
    repository,
    new CryptoIdGenerator(),
    new CryptoRandomSource(),
    timeZoneAdapter,
    new BrowserClipboardAdapter(),
    new BrowserBackupFileAdapter(),
  );

  mountApp(root, controller, loadResult.notices);
}
