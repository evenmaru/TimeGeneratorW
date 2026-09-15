import type {
  ClipboardError,
  ClipboardPort,
} from "../../application/ports/clipboardPort";
import { failure, success, type Result } from "../../domain/result";

export class BrowserClipboardAdapter implements ClipboardPort {
  public async writeText(value: string): Promise<Result<void, ClipboardError>> {
    try {
      if (navigator.clipboard === undefined) {
        return failure(clipboardError());
      }
      await navigator.clipboard.writeText(value);
      return success(undefined);
    } catch (cause) {
      return failure({ ...clipboardError(), cause });
    }
  }
}

function clipboardError(): ClipboardError {
  return {
    code: "clipboard_failed",
    message: "자동 복사에 실패했습니다. 명령을 직접 선택해 복사하세요.",
  };
}
