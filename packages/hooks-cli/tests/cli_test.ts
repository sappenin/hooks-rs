import { assert } from "jsr:@std/assert";
import * as path from "jsr:@std/path";
import { build, check, deploy, newProject, uninstall, up } from "../cli.ts";
import { DependenciesManager } from "../dependencies_manager/mod.ts";
import { Account } from "../account/mod.ts";
import { getRpcUrl, Network } from "../misc/network.ts";

// The tests need to be run in a fresh docker environment,
// because it tests against dependencies installation

// The tests must be run sequentially, in the order in
// which they are laid out here in this file because
// dependencies installation is shared across test cases

Deno.test(`[new] command should create a new template project`, async () => {
  const templateProjectEntries = new Set([
    `.cargo`,
    `src`,
    `tests`,
    `Cargo.toml`,
    `README.md`,
    `jest.config.js`,
    `package.json`,
    `package-lock.json`,
    `.nvmrc`,
    `rust-toolchain.toml`,
  ]);
  const dirEntires = new Set<string>();

  const tmpDir = await Deno.makeTempDir();
  Deno.chdir(tmpDir);
  await newProject(undefined, `example-project-name`);
  const templateProjectPath = path.join(tmpDir, `example-project-name`);
  for await (const dirEntry of Deno.readDir(templateProjectPath)) {
    dirEntires.add(dirEntry.name);
  }

  assert(
    templateProjectEntries.isSubsetOf(dirEntires),
    `There are missing entries`,
  );

  await Deno.remove(templateProjectPath, {
    recursive: true,
  });
});

Deno.test(`[check] command should return false if not all dependencies are installed`, async () => {
  await uninstall();
  const checksPassing = await check();
  assert(!checksPassing);
});

Deno.test(`[up] command should install all missing dependencies`, async () => {
  await up();
  const checksPassing = await check();
  assert(checksPassing);
});

Deno.test(`[uninstall] command should uninstall all dependencies except git, cargo and wasm-pack`, async () => {
  await uninstall();
  const prerequisitesInstallationStatus = await DependenciesManager
    .checkPrerequisitesInstalled();

  const shouldBeInstalled = new Set([
    `git`,
    `cargo`,
    `wasm-pack`,
  ]);

  Object.entries(prerequisitesInstallationStatus).forEach(
    ([prerequisiteName, isInstalled]) => {
      if (shouldBeInstalled.has(prerequisiteName)) {
        assert(isInstalled, `${prerequisiteName} is not installed`);
      } else {
        assert(!isInstalled, `${prerequisiteName} is installed`);
      }
    },
  );
});

Deno.test(`[up] command should install partially missing dependencies`, async () => {
  const prerequisitesInstallationStatus = await DependenciesManager
    .checkPrerequisitesInstalled();

  assert(
    Object.values(prerequisitesInstallationStatus).some((isInstalled) => {
      return !isInstalled;
    }),
  );

  await up();
  const checksPassing = await check();
  assert(checksPassing);
});

Deno.test(`[build] command should build hooks-rs project`, async () => {
  await up();

  const templateProjectEntries = new Set([
    `.cargo`,
    `src`,
    `tests`,
    `Cargo.toml`,
    `README.md`,
    `jest.config.js`,
    `package.json`,
    `package-lock.json`,
    `.nvmrc`,
    `rust-toolchain.toml`,
  ]);
  const dirEntires = new Set<string>();

  const tmpDir = await Deno.makeTempDir();
  Deno.chdir(tmpDir);
  await newProject(undefined, `example-project-name`);
  const templateProjectPath = path.join(tmpDir, `example-project-name`);
  for await (const dirEntry of Deno.readDir(templateProjectPath)) {
    dirEntires.add(dirEntry.name);
  }

  assert(
    templateProjectEntries.isSubsetOf(dirEntires),
    `There are missing entries`,
  );

  Deno.chdir(templateProjectPath);

  await build();
});

Deno.test(`[deploy] command should deploy a hook`, async () => {
  const templateProjectEntries = new Set([
    `.cargo`,
    `src`,
    `tests`,
    `Cargo.toml`,
    `README.md`,
    `jest.config.js`,
    `package.json`,
    `package-lock.json`,
    `.nvmrc`,
    `rust-toolchain.toml`,
  ]);
  const dirEntires = new Set<string>();

  const tmpDir = await Deno.makeTempDir();
  Deno.chdir(tmpDir);
  await newProject(undefined, `example-project-name`);
  const templateProjectPath = path.join(tmpDir, `example-project-name`);
  for await (const dirEntry of Deno.readDir(templateProjectPath)) {
    dirEntires.add(dirEntry.name);
  }

  assert(
    templateProjectEntries.isSubsetOf(dirEntires),
    `There are missing entries`,
  );

  Deno.chdir(templateProjectPath);

  await up();
  const checksPassing = await check();
  assert(checksPassing);

  await Account.create();

  await deploy({
    rpc: getRpcUrl(Network.XahauTestnet, true),
    hookOn: [`INVOKE`],
  });
});
