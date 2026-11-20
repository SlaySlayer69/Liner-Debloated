#!/usr/bin/env node
// picks the version for the next fork release: the package.json version while it is
// newer than every release so far, otherwise one patch above the newest release.
// a strictly growing version lets each installer replace the one before it.
//
// usage: node scripts/next-release-version.mjs <package version> [tag ...]
// tags may come with or without a leading "v"; anything that is not x.y.z is ignored.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(value) {
  const match = SEMVER.exec(String(value).trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function nextReleaseVersion(packageVersion, tags) {
  const base = parseVersion(packageVersion);
  if (!base) throw new Error(`package version is not x.y.z: ${packageVersion}`);
  const released = tags
    .map(parseVersion)
    .filter(Boolean)
    .sort(compareVersions)
    .at(-1);
  if (!released || compareVersions(base, released) > 0) return base.join(".");
  return [released[0], released[1], released[2] + 1].join(".");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [packageVersion, ...tags] = process.argv.slice(2);
  console.log(nextReleaseVersion(packageVersion, tags));
}
