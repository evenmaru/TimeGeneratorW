import { describe, expect, it } from "vitest";
import {
  escapeCmdValue,
  formatGitCommand,
  formatGitDate,
  quoteBash,
  quotePowerShell,
} from "../../src/domain/git/gitCommandFormatter";

describe("Git 명령 포매터", () => {
  const generatedTime = {
    localDateTime: "2026-09-15T14:20:00",
    utcOffset: "+09:00",
  };
  const date = "2026-09-15T14:20:00+09:00";

  it("저장된 로컬 시간과 오프셋을 그대로 조합한다", () => {
    expect(formatGitDate(generatedTime)).toBe(date);
  });

  it("Bash 명령을 만든다", () => {
    expect(formatGitCommand(generatedTime, "bash")).toBe(
      `GIT_AUTHOR_DATE='${date}' GIT_COMMITTER_DATE='${date}' git commit -m '<커밋 메시지>'`,
    );
  });

  it("PowerShell 명령을 만든다", () => {
    expect(formatGitCommand(generatedTime, "powershell")).toBe(
      `$env:GIT_AUTHOR_DATE = '${date}'; $env:GIT_COMMITTER_DATE = '${date}'; git commit -m '<커밋 메시지>'`,
    );
  });

  it("cmd.exe 명령을 만든다", () => {
    expect(formatGitCommand(generatedTime, "cmd")).toBe(
      `set "GIT_AUTHOR_DATE=${date}" && set "GIT_COMMITTER_DATE=${date}" && git commit -m "<커밋 메시지>"`,
    );
  });

  it("셸별 인용 문자를 이스케이프한다", () => {
    expect(quoteBash("a'b")).toBe(`'a'"'"'b'`);
    expect(quotePowerShell("a'b")).toBe("'a''b'");
    expect(escapeCmdValue('100%"')).toBe('100%%""');
  });
});
