import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { hashCanonicalValue } from "../src/content-production/content-production-rebase";
import { parseLegacyProductionSourceAllowlist } from "./content-production-rebase-plan";

const ARTIFACT = resolve(
  __dirname,
  "../testdata/content-production/legacy-source-2026-08-11-to-2026-09-09.json",
);
const EXPECTED_DAY_HASHES = {
  "2026-08-11": "ac8802eff326738246ea87764e15ada96e14ade1c50ad2f0c0bd6e23c235755b",
  "2026-08-12": "1b336773b9ab233de4a467dddb284021551fdb56e1ff1ee301aba1b49428721e",
  "2026-08-13": "5b094d8f42cf4ca640f12f7902abf49f984e4530eb1061a135a7589d4377fb9d",
  "2026-08-14": "776972b9d90b5d1d2fab6541222e82ab95144202842f9f0aff5997ec5358e8d8",
  "2026-08-15": "0c60a94a651cc822dd8c2899ad5887be13d27634cd56f11efe57191de995e21b",
  "2026-08-16": "518af696a6960ac859e81aedc1ec3673cff4cf82b5a65f257b050a6f67f19440",
  "2026-08-17": "07bb5ab71b8599bda7a135a2f1696c5e08a5415809005437758dbfcc6925fda1",
  "2026-08-18": "c98ff370f417159899fb2d5f6f3b2b809f4cf2c365fc764d3c2484e9fe433918",
  "2026-08-19": "576f4de8835f2475cf52005120acd22875facde7e04fd944ce0257253f0f3643",
  "2026-08-20": "1dc07d2cb44af4a8d12297a023232b57c697f1401beb6e7648b2db2f00613e4e",
  "2026-08-21": "56b56abaeb258aecf66e25c2f14e34a374ee5bd7fe9de5b56d5a4953787e5132",
  "2026-08-22": "d16eaec0576e5244f87f0f3e67031ac15348a1eeab94eb1457a1eb23925dda61",
  "2026-08-23": "c9941b849f96c9e25ebb934126a5a3670e625265caa4b25bf49adcbcfbe704db",
  "2026-08-24": "b99b27eb991c4bd396951816200201b3626e028de827fec71a7c815cead5f441",
  "2026-08-25": "d2ff03a4a604b1095c15d1c54f979c77b05e15e59c637ee9ec78d00a1e5ecf13",
  "2026-08-26": "a3a644b715011670982d64d2cae110edc8e0d378f0324430592e7ec371e36e3b",
  "2026-08-27": "77e7ca4544135d0d1aa3b279376e02b855f541f3b86d04eea2d27030576784a3",
  "2026-08-28": "9d7eee46fe68aa80c0afb6dc31f01bc8a21b9a95b85a95e1e4ee31299844b587",
  "2026-08-29": "ebc0765c37259e073e638a3b6cd325606c1eb00e0944f5e36a7433c477850ab6",
  "2026-08-30": "0f59c7d4b7de6f272c44878b99be96ae8c54d7cb1176fd5ace3cf08819d62e48",
  "2026-08-31": "eb40960af1434afdc86b2690eb63253d5a970c91dd8b23e26936aa618d1419cd",
  "2026-09-01": "726834b11d2423e177ae9f6ad107b1ce9bae25472446f4accff3f853458e1383",
  "2026-09-02": "13d320697be08afeed546bf3c65101b03c17b764a293c1c17aa997b9f36a4fcb",
  "2026-09-03": "267ec33960b6b3f5d2b98c3f84d9b29cf56ce5ee4fd3d869e4a3805543a90ecc",
  "2026-09-04": "e9f5f9453b32a7bd5ebd868db84d1c6c06b62095275260f9aa2afc37006f3b0b",
  "2026-09-05": "5ae5c1d6943a27fb3d8670d5c588e769053131ce96306c9fe142643168ee56eb",
  "2026-09-06": "df9c2eb7aad5a9aa43796afafbe362232d12e53f8ff148b608ee0ac3ac379ead",
  "2026-09-07": "9a4f429ce895ffecae96f22f61a4790a10f3138016bb38f6bfc6ce6986d1829b",
  "2026-09-08": "32433ee9bebacc0563da3bbc4116e43443bdd5fd2c0f1da643381ddbc0362232",
  "2026-09-09": "a544eb434a896c8246a3b78d499b6a5fdb0471c04c2f2162b99bd35b2618e5e0",
} as const;

describe("legacy production source allowlist artifact", () => {
  it("recomputes every full-module hash and the code-unit manifest from frozen evidence", async () => {
    const raw = JSON.parse(await readFile(ARTIFACT, "utf8")) as unknown;
    const parsed = parseLegacyProductionSourceAllowlist(raw, { expectedDayCount: 30 });
    const actualHashes = Object.fromEntries(
      parsed.days.map((day) => [day.fortuneDate, day.source.canonicalSha256]),
    );

    expect(actualHashes).toEqual(EXPECTED_DAY_HASHES);
    expect(parsed.sourceModuleManifestSha256).toBe(
      "55bd913ad559c96663980213b05a3bc6fb9f45948f114756e69d01741e57d77b",
    );
    expect(parsed.sourceModuleManifestSha256).toBe(hashCanonicalValue(actualHashes));
    expect(parsed).toMatchObject({
      legacyBlobOidAggregate: "3f639ec2f2b6b625f0be08c6b50a092b23cd10dbc2a9481da90c47819fee997b",
      legacyDemoBlob: "41c2aff7e63e6c2f9ae35c578a2454418cf2566b",
      legacyGeneratorBlob: "4f3a4b479aa88c9eaf4827420cf14a0726f79d8a",
      sourceGeneratorFingerprint:
        "84a30ccbaecc43b4109d0ed07a1b8dc461a3f9a2f9dfbc1501331a7631b03e0e",
      sourceBuildId: "fabc5018212d92b10449c669104c2d58682af91d",
      sourceTree: "fabc5018212d92b10449c669104c2d58682af91d",
    });
    expect(parsed.sourceGeneratorFingerprint).toBe(
      hashCanonicalValue({ files: parsed.runtimeFiles }),
    );
  });
});
