import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const SLOT_ID = "123e4567-e89b-42d3-a456-426614174000";
const IMPORTED_SLOT_ID = "123e4567-e89b-42d3-a456-426614174001";

function stateWithGeneratedTime() {
  return {
    schemaVersion: 1,
    slots: [
      {
        id: SLOT_ID,
        name: "브라우저 프로젝트",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        timeZone: "UTC",
        lastGeneratedTime: {
          localDateTime: "2026-09-15T14:20:00",
          utcOffset: "+00:00",
        },
      },
    ],
    shellFormat: null,
  } as const;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("슬롯 생성, 검증, 편집, 제한, 삭제와 새로고침 복구", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "첫 슬롯을 만들어 시작하세요" })).toBeVisible();
  await page.getByRole("button", { name: "슬롯 추가" }).click();
  const dialog = page.getByRole("dialog", { name: "새 슬롯 만들기" });
  await dialog.getByRole("button", { name: "슬롯 만들기" }).click();
  await expect(dialog.getByText("슬롯 이름을 입력해야 합니다.")).toBeVisible();

  await dialog.getByLabel("슬롯 이름").fill("  메인 프로젝트  ");
  await dialog.getByLabel("시작일").fill("2026-09-21");
  await dialog.getByLabel("종료일").fill("2026-09-25");
  await dialog.getByRole("button", { name: "슬롯 만들기" }).click();
  await expect(page.getByRole("heading", { name: "메인 프로젝트" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /SLOT 01 메인 프로젝트/ })).toBeVisible();
  await page.getByRole("button", { name: "편집" }).click();
  await page.getByLabel("슬롯 이름").fill("이름 변경");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("heading", { name: "이름 변경" })).toBeVisible();

  for (let index = 2; index <= 5; index += 1) {
    await page.getByRole("button", { name: "슬롯 추가" }).click();
    await page.getByLabel("슬롯 이름").fill(`프로젝트 ${index}`);
    await page.getByLabel("시작일").fill("2026-09-21");
    await page.getByLabel("종료일").fill("2026-09-25");
    await page.getByRole("button", { name: "슬롯 만들기" }).click();
  }

  await expect(page.getByLabel("슬롯 5개, 최대 5개")).toBeVisible();
  await expect(page.getByRole("button", { name: "슬롯 추가" })).toBeDisabled();
  await expect(page.getByText("슬롯은 최대 5개까지 만들 수 있습니다.")).toBeVisible();

  await page.getByRole("button", { name: /SLOT 01 이름 변경/ }).click();
  await page.getByRole("button", { name: "삭제" }).first().click();
  await expect(page.getByRole("dialog", { name: "이 슬롯을 삭제할까요?" })).toBeVisible();
  await page.getByRole("button", { name: "슬롯 삭제" }).click();
  await expect(page.getByRole("button", { name: "슬롯 추가" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /SLOT 01 프로젝트 2/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("세 셸 출력과 클립보드 성공·거부를 처리한다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((state) => {
    localStorage.setItem("time-generator.app-state", JSON.stringify(state));
  }, stateWithGeneratedTime());
  await page.reload();

  const expected = {
    bash: "GIT_AUTHOR_DATE='2026-09-15T14:20:00+00:00' GIT_COMMITTER_DATE='2026-09-15T14:20:00+00:00' git commit -m '<커밋 메시지>'",
    powershell:
      "$env:GIT_AUTHOR_DATE = '2026-09-15T14:20:00+00:00'; $env:GIT_COMMITTER_DATE = '2026-09-15T14:20:00+00:00'; git commit -m '<커밋 메시지>'",
    cmd: 'set "GIT_AUTHOR_DATE=2026-09-15T14:20:00+00:00" && set "GIT_COMMITTER_DATE=2026-09-15T14:20:00+00:00" && git commit -m "<커밋 메시지>"',
  } as const;

  for (const shell of ["bash", "powershell", "cmd"] as const) {
    await page.locator(`input[name="shellFormat"][value="${shell}"]`).check();
    await expect(page.locator(".command-block code")).toHaveText(expected[shell]);
  }

  await page.getByRole("button", { name: "명령 복사" }).click();
  await expect(page.getByRole("status")).toContainText("클립보드에 복사했습니다.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected.cmd);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.getByRole("button", { name: /명령 복사|복사됨/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "자동 복사에 실패했습니다. 명령을 직접 선택해 복사하세요.",
  );
  await expect(page.locator(".command-block code")).toHaveText(expected.cmd);
});

test("JSON 내보내기, 확인 전 보존, 정규화 가져오기와 오류를 처리한다", async ({ page }) => {
  const currentState = stateWithGeneratedTime();
  await page.evaluate((state) => {
    localStorage.setItem("time-generator.app-state", JSON.stringify(state));
  }, currentState);
  await page.reload();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("time-generator-backup.json");
  expect(JSON.parse(await readFile(await download.path(), "utf8"))).toEqual(currentState);

  const importedState = {
    schemaVersion: 1,
    slots: [
      {
        ...currentState.slots[0],
        id: IMPORTED_SLOT_ID,
        name: "  가져온 프로젝트  ",
        lastGeneratedTime: null,
      },
    ],
    shellFormat: "powershell",
  };
  await page.locator("[data-import-backup]").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedState)),
  });
  const importDialog = page.getByRole("dialog", { name: "이 백업을 가져올까요?" });
  await expect(importDialog).toBeVisible();
  await expect(importDialog.getByText("안전하게 정리할 값이 있습니다.")).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("time-generator.app-state")!)),
  ).toEqual(currentState);

  await importDialog.getByRole("button", { name: "백업 가져오기" }).click();
  await expect(page.getByRole("heading", { name: "가져온 프로젝트" })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("time-generator.app-state")!)),
  ).toMatchObject({ slots: [{ name: "가져온 프로젝트" }], shellFormat: "powershell" });

  await page.locator("[data-import-backup]").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("alert")).toContainText("JSON 파일 또는 저장 데이터의 형식이 올바르지 않습니다.");
  await expect(page.getByRole("heading", { name: "가져온 프로젝트" })).toBeVisible();
});

test("손상 저장소 복구와 모바일 키보드 흐름이 유지된다", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("time-generator.app-state", "{broken");
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("빈 상태로 초기화했습니다.");
  expect(await page.evaluate(() => localStorage.getItem("time-generator.app-state.recovery"))).toBe(
    "{broken",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const addButton = page.getByRole("button", { name: "슬롯 추가" });
  await addButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "새 슬롯 만들기" })).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const label = page.locator("[data-import-label]");
  await label.focus();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "mobile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, slots: [], shellFormat: null })),
  });
  await expect(page.getByRole("dialog", { name: "이 백업을 가져올까요?" })).toBeVisible();
});
