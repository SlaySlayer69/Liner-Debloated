import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDeferredJSONStorage, debouncedStorage } from "./storage";

describe("createDeferredJSONStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes only the latest state, once per flush", () => {
    const storage = createDeferredJSONStorage<{ positionMs: number }>();
    const stringify = vi.spyOn(JSON, "stringify");

    for (let i = 1; i <= 20; i++) storage.setItem("player", { state: { positionMs: i * 250 }, version: 0 });
    expect(stringify).not.toHaveBeenCalled();
    // reads see the pending state before it is written
    expect(storage.getItem("player")).toEqual({ state: { positionMs: 5000 }, version: 0 });
    expect(localStorage.getItem("player")).toBeNull();

    vi.advanceTimersByTime(1000);
    expect(stringify).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("player")!)).toEqual({ state: { positionMs: 5000 }, version: 0 });
    stringify.mockRestore();
  });

  it("drops a pending value on remove and flushes on demand", () => {
    const storage = createDeferredJSONStorage<{ a: number }>();
    storage.setItem("k", { state: { a: 1 }, version: 0 });
    storage.removeItem("k");
    debouncedStorage.flush();
    expect(localStorage.getItem("k")).toBeNull();

    storage.setItem("k", { state: { a: 2 }, version: 0 });
    debouncedStorage.flush();
    expect(JSON.parse(localStorage.getItem("k")!)).toEqual({ state: { a: 2 }, version: 0 });
  });
});
