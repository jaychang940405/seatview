import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, parseSeatQuery } from "./query";

describe("parseSeatQuery", () => {
  it("沒有參數 → 預設值（演唱會 A1 第 1 排 16 號、座位視角）", () => {
    expect(parseSeatQuery("")).toEqual(DEFAULT_QUERY);
  });

  it("全部參數都有", () => {
    expect(parseSeatQuery("?layout=baseball&section=B1&row=3&seat=7&mode=overview")).toEqual({
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
});
