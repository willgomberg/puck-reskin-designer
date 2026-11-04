/*
 * UPDATE CHECK TESTS
 * DESCRIPTION: Tests release validation, numerical ordering, failures, and browser safety.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateChecker, RELEASE_REPOSITORY } from "../src/main/update-check.js";

function release(tag_name = "v0.2.0", changes = {}) {
  return { tag_name, draft: false, prerelease: false, published_at: "2026-10-09T12:00:00Z", ...changes };
}

function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

function abortableRequest(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

// ---------- Release versions and request contract ----------

test("stable versions compare numerically across all three components", async () => {
  for (const [installed, tag, status] of [
    ["0.1.0", "v0.2.0", "available"],
    ["0.1.0", "v0.1.0", "current"],
    ["0.2.0", "v0.1.0", "current"],
    ["0.9.0", "v0.10.0", "available"],
    ["0.10.0", "v0.9.0", "current"],
    ["0.1.9", "v0.1.10", "available"],
    ["1.9.9", "v2.0.0", "available"],
  ]) {
    const checker = createUpdateChecker(installed, { fetchRelease: async () => response(release(tag)) });
    assert.deepEqual(await checker.check(), { status, installedVersion: installed, availableVersion: tag.slice(1) });
  }
});

test("request uses only the configured public latest-release endpoint without credentials", async () => {
  let requests = 0;
  const checker = createUpdateChecker("0.1.0", {
    fetchRelease: async (url, options) => {
      requests += 1;
      assert.equal(url, `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`);
      assert.equal(options.headers.Accept, "application/vnd.github+json");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return response(release());
    },
  });
  assert.equal(requests, 0);
  await checker.check();
  assert.equal(requests, 1);
});

test("invalid release and installed versions fail instead of reporting current", async () => {
  for (const data of [
    null, {}, [], release("0.2.0"), release("v0.2"), release("v0.2.0-beta.1"),
    release("v0.2.0+build"), release("v00.2.0"), release("v-1.2.0"),
    release("v9007199254740992.0.0"), release("v0.2.0 "),
    release("v0.2.0", { draft: true }), release("v0.2.0", { prerelease: true }),
    release("v0.2.0", { published_at: null }), release("v0.2.0", { published_at: "invalid" }),
  ]) {
    const checker = createUpdateChecker("0.1.0", { fetchRelease: async () => response(data) });
    assert.equal((await checker.check()).status, "error", JSON.stringify(data));
  }
  const checker = createUpdateChecker("0.1.0-beta", { fetchRelease: () => assert.fail("must validate installed version first") });
  assert.equal((await checker.check()).status, "error");
});

// ---------- Failures, retries, and concurrent requests ----------

test("missing releases, rate limits, denied requests, and server failures stay distinct", async () => {
  for (const [status, headers, message] of [
    [404, {}, /repository or a published release/],
    [403, { "x-ratelimit-remaining": "0" }, /request limit/],
    [429, {}, /request limit/],
    [403, {}, /HTTP 403/],
    [500, {}, /HTTP 500/],
  ]) {
    const checker = createUpdateChecker("0.1.0", { fetchRelease: async () => response({}, status, headers) });
    const result = await checker.check();
    assert.equal(result.status, "error");
    assert.match(result.message, message);
  }
});

test("unreadable responses and network failures allow a later retry", async () => {
  for (const fail of [
    async () => { throw new TypeError("offline"); },
    async () => new Response("not JSON"),
  ]) {
    let requests = 0;
    const checker = createUpdateChecker("0.1.0", {
      fetchRelease: (...args) => ++requests === 1 ? fail(...args) : Promise.resolve(response(release())),
    });
    assert.equal((await checker.check()).status, "error");
    assert.equal((await checker.check()).status, "available");
    assert.equal(requests, 2);
  }
});

test("timeout covers both the connection and the response body, then allows retry", async () => {
  for (const bodyTimeout of [false, true]) {
    let requests = 0;
    let signal;
    const checker = createUpdateChecker("0.1.0", {
      timeoutMs: 10,
      fetchRelease: async (_url, options) => {
        requests += 1;
        signal = options.signal;
        if (requests > 1) return response(release());
        if (!bodyTimeout) return abortableRequest(signal);
        return { ok: true, status: 200, json: () => abortableRequest(signal) };
      },
    });
    const result = await checker.check();
    assert.equal(result.status, "error");
    assert.match(result.message, /timed out/);
    assert.equal(signal.aborted, true);
    assert.equal((await checker.check()).status, "available");
  }
});

test("simultaneous checks share one request and browser opening is limited to a newer verified tag", async () => {
  let complete;
  let requests = 0;
  const opened = [];
  const checker = createUpdateChecker("0.1.0", {
    fetchRelease: () => { requests += 1; return new Promise((resolve) => { complete = resolve; }); },
    openExternal: async (url) => opened.push(url),
  });
  await assert.rejects(checker.openReleasePage(), /Check for a newer/);
  const first = checker.check();
  const second = checker.check();
  assert.equal(first, second);
  assert.equal(requests, 1);
  await assert.rejects(checker.openReleasePage(), /Check for a newer/);
  complete(response(release("v0.2.0", { html_url: "https://evil.example/" })));
  await first;
  await checker.openReleasePage();
  assert.deepEqual(opened, [`https://github.com/${RELEASE_REPOSITORY}/releases/tag/v0.2.0`]);

  const retry = checker.check();
  await assert.rejects(checker.openReleasePage(), /Check for a newer/);
  complete(response({}, 404));
  await retry;
  await assert.rejects(checker.openReleasePage(), /Check for a newer/);
});

test("equal or older releases cannot be opened and browser failures allow retry", async () => {
  for (const tag of ["v0.1.0", "v0.0.9"]) {
    const checker = createUpdateChecker("0.1.0", { fetchRelease: async () => response(release(tag)) });
    await checker.check();
    await assert.rejects(checker.openReleasePage(), /Check for a newer/);
  }
  let opens = 0;
  const checker = createUpdateChecker("0.1.0", {
    fetchRelease: async () => response(release()),
    openExternal: async () => { if (++opens === 1) throw new Error("browser failed"); },
  });
  await checker.check();
  await assert.rejects(checker.openReleasePage(), /could not be opened/);
  await checker.openReleasePage();
  assert.equal(opens, 2);
});
