import { describe, expect, it } from "vitest";
import {
  applyStructuredAuthToConnectionString,
  readStructuredAuthFromConnectionString,
  stripPasswordFromConnectionString,
  supportsStructuredAuth,
} from "./connectionUrl";

describe("connectionUrl", () => {
  it("reads username and password from a URL connection string", () => {
    expect(
      readStructuredAuthFromConnectionString(
        "postgresql://postgres:supersecret@db.example.com:5432/app",
      ),
    ).toEqual({
      username: "postgres",
      password: "supersecret",
    });
  });

  it("applies explicit credentials back into a URL connection string", () => {
    expect(
      applyStructuredAuthToConnectionString(
        "postgresql://db.example.com:5432/app?sslmode=require",
        { username: "postgres", password: "supersecret" },
      ),
    ).toBe("postgresql://postgres:supersecret@db.example.com:5432/app?sslmode=require");
  });

  it("marks sqlite and pi historian as non-structured auth drivers", () => {
    expect(supportsStructuredAuth("postgres")).toBe(true);
    expect(supportsStructuredAuth("sqlite")).toBe(false);
    expect(supportsStructuredAuth("p_i_historian")).toBe(false);
  });

  it("strips password while leaving the database address visible", () => {
    expect(
      stripPasswordFromConnectionString(
        "postgresql://postgres:supersecret@db.example.com:5432/app?sslmode=require",
      ),
    ).toBe("postgresql://postgres@db.example.com:5432/app?sslmode=require");
  });
});
