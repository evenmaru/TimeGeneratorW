import type { AppStateWriter } from "../../application/ports/appStateWriter";
import type { AppState } from "../../domain/models";
import { success, type Result } from "../../domain/result";

export class MemoryAppStateWriter implements AppStateWriter {
  private state: AppState | null = null;

  public async save(state: AppState): Promise<Result<void, never>> {
    this.state = state;
    return success(undefined);
  }

  public getState(): AppState | null {
    return this.state;
  }
}
