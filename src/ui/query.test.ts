import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, parseSeatQuery } from "./query";

describe("parseSeatQuery", () => {
  it("沒有參數 → 預設值（demo-arena 演唱會 A1 第 1 排 16 號、座位視角）", () => {
    expect(parseSeatQuery("")).toEqual(DEFAULT_QUERY);
    expect(DEFAULT_QUERY.venueId).toBe("demo-arena");
  });

  it("全部參數都有", () => {
    expect(parseSeatQuery("?venue=taipei-dome&layout=baseball&section=B1&row=3&seat=7&mode=overview")).toEqual({
      venueId: "taipei-dome",
      layoutId: "baseball",
      sectionId: "B1",
      row: 3,
      seat: 7,
      mode: "overview",
    });
  });

  it("只給部分參數，其他用預設值", () => {
    expect(parseSeatQuery("?section=F1&seat=20")).toEqual({ ...DEFAULT_QUERY, sectionId: "F1", seat: 20 });
  });

  it("開頭沒有 ? 也可以", () => {
    expect(parseSeatQuery("row=5").row).toBe(5);
  });

  it("排號不是數字 → NaN（交給 core 回報 ROW_OUT_OF_RANGE）", () => {
    expect(parseSeatQuery("?row=abc").row).toBeNaN();
  });

  it("不認得的 mode → seat", () => {
    expect(parseSeatQuery("?mode=fly").mode).toBe("seat");
  });

  it("debug=overview → 鳥瞰（隱藏的除錯模式，UI 沒有入口）", () => {
    expect(parseSeatQuery("?debug=overview").mode).toBe("overview");
  });

  it("舊連結的 mode=overview 仍是 debug=overview 的別名", () => {
    expect(parseSeatQuery("?mode=overview").mode).toBe("overview");
  });

  it("其他 debug 值 → 座位視角", () => {
    expect(parseSeatQuery("?debug=fly").mode).toBe("seat");
  });
});
