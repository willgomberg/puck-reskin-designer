/*
 * MANUAL UPDATE CHECK
 * DESCRIPTION: Checks public releases and limits browser opening to a verified release.
 * PROCESS: Main
 */

// ---------- Release repository and version validation ----------

// NOTE: Change this location if the public repository moves before release.
export const RELEASE_REPOSITORY = "willgomberg/puck-reskin-designer";

function parseVersion(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("The update version is invalid. Expected a stable version such as 0.1.0.");
  }
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("The update version is invalid.");
  return parts;
}

function isNewerVersion(available, installed) {
  for (let index = 0; index < available.length; index += 1) {
    if (available[index] !== installed[index]) return available[index] > installed[index];
  }
  return false;
}

// ---------- Manual requests and controlled browser action ----------

// Tests can replace fetch and shorten the timeout; the renderer cannot set these options
export function createUpdateChecker(installedVersion, {
  fetchRelease = fetch,
  timeoutMs = 10000,
  openExternal,
} = {}) {
  let pendingCheck = null;
  let releasePage = null;

  async function checkLatestRelease() {
    releasePage = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const installed = parseVersion(installedVersion);
      let response;
      try {
        response = await fetchRelease(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Puck-Reskin-Designer",
          },
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new Error(controller.signal.aborted
          ? "The update check timed out. Please try again."
          : "Could not reach GitHub. Check your internet connection and try again.");
      }

      if (response.status === 404) {
        throw new Error("The public repository or a published release is not available yet. Please try again later.");
      }
      if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
        throw new Error("GitHub’s request limit was reached. Please try again later.");
      }
      if (!response.ok) throw new Error(`GitHub could not complete the update check (HTTP ${response.status}). Please try again later.`);

      let release;
      try {
        release = await response.json();
      } catch {
        throw new Error(controller.signal.aborted
          ? "The update check timed out. Please try again."
          : "GitHub returned unreadable release data. Please try again later.");
      }
      if (release?.draft !== false || release?.prerelease !== false ||
          typeof release?.tag_name !== "string" || !release.tag_name.startsWith("v") ||
          typeof release?.published_at !== "string" || !Number.isFinite(Date.parse(release.published_at))) {
        throw new Error("GitHub returned invalid published release data. Expected a stable vX.Y.Z release.");
      }
      const availableVersion = release.tag_name.slice(1);
      const available = parseVersion(availableVersion);
      const newer = isNewerVersion(available, installed);
      // Build the URL
      if (newer) releasePage = `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v${availableVersion}`;
      return { status: newer ? "available" : "current", installedVersion, availableVersion };
    } catch (error) {
      return { status: "error", installedVersion, message: error.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    check() {
      // All simultaneous callers share 1 request, including across renderer reloads
      if (!pendingCheck) {
        pendingCheck = checkLatestRelease().finally(() => { pendingCheck = null; });
      }
      return pendingCheck;
    },
    async openReleasePage() {
      if (!releasePage || pendingCheck) throw new Error("Check for a newer release before opening its page.");
      try {
        await openExternal(releasePage);
      } catch {
        throw new Error("The release page could not be opened. Please try again.");
      }
    },
  };
}
