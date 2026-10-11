import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "vpn-keepalive-release-"));
const releaseCli = join(root, "node_modules/release-it/bin/release-it.js");
const commitlintCli = join(root, "node_modules/@commitlint/cli/cli.js");
const env = { ...process.env, CI: "", HUSKY: "1", NODE_ENV: "development" };

function run(command, args, { success = true, ...options } = {}) {
  const result = spawnSync(command, args, {
    cwd: directory,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    ...options,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout}${result.stderr}`;
  if (success) assert.equal(result.status, 0, output);
  else assert.notEqual(result.status, 0, output);
  return output;
}

const git = (...args) => run("git", args).trim();
const release = (...args) =>
  run(process.execPath, [releaseCli, "--ci", ...args]);

try {
  await symlink(
    join(root, "node_modules"),
    join(directory, "node_modules"),
    "junction",
  );
  for (const file of [
    "commitlint.config.cjs",
    ".prettierrc.json",
    ".gitignore",
    "CHANGELOG.md",
  ]) {
    await copyFile(join(root, file), join(directory, file));
  }
  await mkdir(join(directory, ".husky"));
  await copyFile(
    join(root, ".husky/commit-msg"),
    join(directory, ".husky/commit-msg"),
  );
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "vpn-keepalive-release-test",
      version: "0.2.0",
      packageManager: "pnpm@10.24.0",
      scripts: { verify: "node verify.mjs" },
    }),
  );
  await writeFile(
    join(directory, "verify.mjs"),
    'if (process.env.RELEASE_TEST_FAIL === "1") process.exit(1);\n',
  );

  const config = JSON.parse(
    await readFile(join(root, ".release-it.json"), "utf8"),
  );
  config.git.push = false;
  config.git.requireUpstream = false;
  await writeFile(join(directory, ".release-it.json"), JSON.stringify(config));
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "core.autocrlf", "false");
  run(process.execPath, [join(root, "scripts/prepare.mjs")]);
  assert.equal(git("config", "core.hooksPath"), ".husky/_");

  for (const message of [
    "feat(web): add a URL",
    "fix: 修复超时",
    "docs: Update README",
    "feat(cli)!: change flags",
    "chore(release): 0.3.0",
  ]) {
    run(process.execPath, [commitlintCli], { input: message });
  }
  for (const message of [
    "update things",
    "unknown: change",
    "fix:",
    `fix: ${"x".repeat(100)}`,
  ]) {
    run(process.execPath, [commitlintCli], { input: message, success: false });
  }

  git("add", ".");
  git("commit", "-m", "chore: initialize release fixture");
  git("tag", "v0.2.0");
  const head = git("rev-parse", "HEAD");
  run("git", ["commit", "--allow-empty", "-m", "invalid message"], {
    success: false,
  });
  assert.equal(
    git("rev-parse", "HEAD"),
    head,
    "Invalid commits must be rejected by the hook",
  );

  git("commit", "--allow-empty", "-m", "feat(web): add a URL");
  const before = await readFile(join(directory, "package.json"), "utf8");
  run(process.execPath, [releaseCli, "--ci"], {
    success: false,
    env: { ...env, RELEASE_TEST_FAIL: "1" },
  });
  assert.equal(await readFile(join(directory, "package.json"), "utf8"), before);
  assert.equal(git("tag", "--list"), "v0.2.0");

  release("--dry-run");
  assert.equal(await readFile(join(directory, "package.json"), "utf8"), before);
  assert.equal(
    git("status", "--porcelain"),
    "",
    "Dry runs must leave the worktree clean",
  );
  assert.equal(git("tag", "--list"), "v0.2.0");

  for (const [message, version] of [
    [null, "0.3.0"],
    ["fix(engine): fix timeout", "0.3.1"],
    ["feat(cli)!: change flags", "1.0.0"],
  ]) {
    if (message) git("commit", "--allow-empty", "-m", message);
    release();
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    assert.equal(manifest.version, version);
    assert.equal(git("log", "-1", "--format=%s"), `chore(release): ${version}`);
    assert.equal(git("describe", "--tags", "--exact-match"), `v${version}`);
    assert.equal(
      git("status", "--porcelain"),
      "",
      "Formatted changelogs must be committed",
    );
  }

  const changelog = await readFile(join(directory, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /0\.3\.0/);
  assert.match(changelog, /0\.3\.1/);
  assert.match(changelog, /1\.0\.0/);
  assert.match(changelog, /BREAKING CHANGES/);
  assert.equal(
    changelog.match(/add a URL/g)?.length,
    1,
    "Old entries must not be duplicated",
  );
  assert.equal(changelog.match(/fix timeout/g)?.length, 1);
  console.log(
    "Release checks passed: commit hooks, failed checks, dry run, version bumps, tags and changelog.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
