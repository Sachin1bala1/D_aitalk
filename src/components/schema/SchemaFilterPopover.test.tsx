import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SchemaFilterPopover } from "./SchemaFilterPopover";

describe("SchemaFilterPopover", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const allSchemas = ["public", "auth", "storage", "analytics"];
  const onChange = vi.fn();

  const render = (visible = ["public"]) => {
    act(() => {
      root.render(
        <SchemaFilterPopover
          open={true}
          allSchemas={allSchemas}
          visibleSchemas={visible}
          onChange={onChange}
          onClose={vi.fn()}
        />
      );
    });
  };

  it("renders a checkbox for each schema", () => {
    render();
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(4);
  });

  it("public is checked, others unchecked by default", () => {
    render(["public"]);
    const checkboxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]')
    ) as HTMLInputElement[];
    const publicBox = checkboxes.find((cb) => cb.dataset.schema === "public");
    const authBox = checkboxes.find((cb) => cb.dataset.schema === "auth");
    expect(publicBox?.checked).toBe(true);
    expect(authBox?.checked).toBe(false);
  });

  it("clicking a checkbox calls onChange with updated list", () => {
    render(["public"]);
    const authBox = container.querySelector(
      'input[data-schema="auth"]'
    ) as HTMLInputElement;
    act(() => {
      authBox.click();
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining(["public", "auth"])
    );
  });

  it("Public only button resets to [public]", () => {
    render(["public", "auth", "storage"]);
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => /public only/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(onChange).toHaveBeenCalledWith(["public"]);
  });

  it("Show all button checks every schema", () => {
    render(["public"]);
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => /show all/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(onChange).toHaveBeenCalledWith(allSchemas);
  });
});
