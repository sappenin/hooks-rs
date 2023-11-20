import * as path from "https://deno.land/std@0.207.0/path/mod.ts";
import * as xrpl from "npm:@transia/xrpl";
import { getFeeEstimateXrp } from "npm:@transia/xrpl/dist/npm/sugar/index.js";
import { Hex } from "../misc/mod.ts";
import { Sha256 } from "https://deno.land/std@0.119.0/hash/sha256.ts";
import { HookGrant, HookParameter, HookPayload } from "../types/hooks.ts";

function hexNamespace(hookNamespaceSeed: string): string {
  return new Sha256().update(hookNamespaceSeed).hex().toUpperCase();
}

function hexHookParameters(data: HookParameter[]): HookParameter[] {
  const hookParameters: HookParameter[] = [];
  for (const parameter of data) {
    let hookPName = parameter.HookParameter.HookParameterName;
    let hookPValue = parameter.HookParameter.HookParameterValue;

    if (!Hex.isHex(hookPName)) {
      hookPName = Hex.stringToHexString(hookPName);
    }

    if (!Hex.isHex(hookPValue)) {
      hookPValue = Hex.stringToHexString(hookPValue);
    }

    hookParameters.push({
      HookParameter: {
        HookParameterName: hookPName,
        HookParameterValue: hookPValue,
      },
    });
  }
  return hookParameters;
}

function createHookPayload(
  version?: number | null,
  namespace?: string | null,
  flags?: number | 0,
  hookOn = `0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbfffff`,
  hookParams?: HookParameter[] | null,
  hookGrants?: HookGrant[] | null,
): HookPayload {
  const hook = {
    hookOn,
  } as HookPayload;
  if (typeof version === "number") {
    hook.HookApiVersion = version;
  }
  if (namespace) {
    hook.HookNamespace = hexNamespace(namespace);
  }
  if (flags) {
    hook.Flags = flags;
  }
  if (hookParams) {
    hook.HookParameters = hexHookParameters(hookParams);
  }
  if (hookGrants) {
    hook.HookGrants = hookGrants;
  }
  return hook;
}

function handleOutput(output: Deno.CommandOutput) {
  if (output.success) {
    console.log(output.stdout);
  } else {
    console.error(output.stderr);
  }
}

export async function buildHook(hookName: string): Promise<HookPayload> {
  const cargoBuildOutput = await new Deno.Command(`cargo`, {
    args: [
      "+nightly",
      "build",
      "--release",
    ],
  }).output();
  handleOutput(cargoBuildOutput);
  const hook = createHookPayload(
    0,
    `${hookName}namespace`,
    undefined,
  );
  const wasmDir = path.join(
    Deno.cwd(),
    `target`,
    `wasm32-unknown-unknown`,
    `release`,
  );
  const debugDir = path.join(Deno.cwd(), "target");
  const wasmInFile = path.join(wasmDir, `${hookName}.wasm`);
  const wasmOutFlattened = path.join(
    wasmDir,
    `${hookName}-flattened.wasm`,
  );
  // Maximum allowable depth of blocks reached is 16 levels in hooks GuardCheck.
  // Otherwise, the node will not validate the SetHook transaction.
  // Therefore, flatten it using wasm-opt.
  const wasmOptOutput = await new Deno.Command(
    `wasm-opt`,
    {
      args: [
        wasmInFile,
        `--flatten`,
        `--rereloop`,
        `-Oz`,
        `-Oz`,
        `-o`,
        wasmOutFlattened,
      ],
    },
  ).output();
  handleOutput(wasmOptOutput);
  const wasmOutCleaned = path.join(wasmDir, `${hookName}-cleaned.wasm`);
  const hookCleanerOut = await new Deno.Command(
    `hook-cleaner`,
    {
      args: [
        wasmOutFlattened,
        wasmOutCleaned,
      ],
    },
  ).output();
  console.log(JSON.stringify(hookCleanerOut, null, 2));
  await Promise.all([
    new Deno.Command(
      `wasm2wat`,
      {
        args: [
          wasmInFile,
          `-o`,
          path.join(
            debugDir,
            `${hookName}.wat`,
          ),
        ],
      },
    ).output(),
    new Deno.Command(
      `wasm2wat`,
      {
        args: [
          wasmOutCleaned,
          `-o`,
          path.join(
            debugDir,
            `${hookName}-cleaned.wat`,
          ),
        ],
      },
    ).output(),
    new Deno.Command(
      `wasm2wat`,
      {
        // ${wasmOutFlattened} -o ${path.join(
        //   debugDir,
        //   `${hookName}-flattened.wat`,
        // )}
        args: [
          wasmOutFlattened,
          `-o`,
          path.join(
            debugDir,
            `${hookName}-flattened.wat`,
          ),
        ],
      },
    ).output(),
  ]);
  const guardCheckerOut = await new Deno.Command(`guard_checker`, {
    args: [
      wasmOutCleaned,
    ],
  }).output();
  handleOutput(guardCheckerOut);

  const wasm = await Deno.readFile(wasmOutCleaned);
  const wasmHex = Hex.uint8ArrayToHexString(wasm).toUpperCase();
  hook.CreateCode = wasmHex;

  return hook;
}

export async function getTransactionFee(
  client: xrpl.Client,
  transaction: xrpl.Transaction,
): Promise<string> {
  const copyTx = JSON.parse(JSON.stringify(transaction));
  copyTx.Fee = `0`;
  copyTx.SigningPubKey = ``;

  const preparedTx = await client.autofill(copyTx);

  const tx_blob = xrpl.encode(preparedTx);

  const result = await getFeeEstimateXrp(client, tx_blob);

  return result;
}

export async function submitAndWaitWithRetries(
  client: xrpl.Client,
  ...params: Parameters<xrpl.Client["submitAndWait"]>
) {
  let tries = 0;
  while (tries < 3) {
    try {
      const result = await client.submitAndWait(...params);
      return result;
    } catch (e) {
      console.error(`${e} - retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      tries++;
      continue;
    }
  }

  throw new Error(`Could not submit transaction after ${tries} tries`);
}

export async function setHook(
  client: xrpl.Client,
  secret: string,
  hook: HookPayload,
) {
  const wallet = xrpl.Wallet.fromSecret(secret);
  const tx: xrpl.SetHook = {
    TransactionType: `SetHook`,
    Account: wallet.address,
    Hooks: [{ Hook: hook }],
  };

  const fee = await getTransactionFee(client, tx);
  tx.Fee = fee;

  const submitResponse = await submitAndWaitWithRetries(
    client,
    tx,
    {
      wallet,
      failHard: true,
      autofill: true,
    },
  );

  return submitResponse;
}