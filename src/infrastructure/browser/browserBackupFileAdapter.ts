import type {
  BackupFileError,
  BackupFilePort,
} from "../../application/ports/backupFilePort";
import { failure, success, type Result } from "../../domain/result";

export class BrowserBackupFileAdapter implements BackupFilePort {
  public async readText(file: unknown): Promise<Result<string, BackupFileError>> {
    if (!(file instanceof Blob)) {
      return failure({
        code: "file_read_failed",
        message: "선택한 파일을 읽을 수 없습니다.",
      });
    }

    try {
      return success(await file.text());
    } catch (cause) {
      return failure({
        code: "file_read_failed",
        message: "선택한 JSON 파일을 읽지 못했습니다.",
        cause,
      });
    }
  }

  public downloadText(
    fileName: string,
    content: string,
  ): Result<void, BackupFileError> {
    let objectUrl: string | null = null;
    try {
      const blob = new Blob([content], { type: "application/json;charset=utf-8" });
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl ?? ""), 0);
      return success(undefined);
    } catch (cause) {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
      return failure({
        code: "file_download_failed",
        message: "백업 JSON 파일을 다운로드하지 못했습니다.",
        cause,
      });
    }
  }
}
