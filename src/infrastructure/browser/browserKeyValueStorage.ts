import type { KeyValueStorage } from "../storage/keyValueStorage";

export class BrowserKeyValueStorage implements KeyValueStorage {
  public getItem(key: string): string | null {
    return window.localStorage.getItem(key);
  }

  public setItem(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }
}
