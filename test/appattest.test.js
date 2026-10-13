import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, createSign, generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { newChallenge, nonceFromCertificate, verifyAssertion, verifyAttestation } from "../lib/appattest.js";
import { store } from "../lib/store.js";
import { encodeCbor } from "./helpers.js";

const sha256 = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest();
const appId = sha256(Buffer.from("J72XXRT45L.com.treesable.fotothis"));
const point = (publicKey) => {
  const jwk = publicKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
};

beforeEach(() => store._clearMemory());

// MARK: Assertions

function assertionAuthData(counter, rpIdHash = appId) {
  const data = Buffer.alloc(37);
  rpIdHash.copy(data, 0);
  data[32] = 0x40;
  data.writeUInt32BE(counter, 33);
  return data;
}

function sign(privateKey, authenticatorData, body) {
  const nonce = sha256(authenticatorData, sha256(body));
  const signature = createSign("SHA256").update(nonce).sign(privateKey);
  return encodeCbor({ signature, authenticatorData }).toString("base64");
}

async function registeredKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keyId = sha256(point(publicKey)).toString("base64");
  await store.set(`attest:key:${keyId}`, JSON.stringify({
    publicKey: publicKey.export({ type: "spki", format: "pem" }), counter: 0, environment: "development",
  }));
  return { privateKey, keyId };
}

test("a valid assertion passes and moves the counter on", async () => {
  const { privateKey, keyId } = await registeredKey();
  const body = Buffer.from('{"image":"abc"}');
  assert.deepEqual(await verifyAssertion({ keyId, body, assertion: sign(privateKey, assertionAuthData(1), body) }),
    { environment: "development" });
  assert.equal(JSON.parse(await store.get(`attest:key:${keyId}`)).counter, 1);
});

test("replays, other bodies, other apps and unknown keys fail", async () => {
  const { privateKey, keyId } = await registeredKey();
  const body = Buffer.from('{"image":"abc"}');
  const first = sign(privateKey, assertionAuthData(1), body);
  await verifyAssertion({ keyId, body, assertion: first });
  await assert.rejects(verifyAssertion({ keyId, body, assertion: first }), /Replayed/);
  await assert.rejects(verifyAssertion({ keyId, body: Buffer.from("{}"), assertion: sign(privateKey, assertionAuthData(2), body) }),
    /Bad signature/, "Signed a different body");
  await assert.rejects(verifyAssertion({ keyId, body, assertion: sign(privateKey, assertionAuthData(3, sha256(Buffer.from("x"))), body) }),
    /Different app/);
  await assert.rejects(verifyAssertion({ keyId: "nope", body, assertion: first }), /attest first/);
});

// MARK: Attestation, with a throwaway chain standing in for Apple's

function openssl(dir, ...args) {
  execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
}

function makeAttestation(challenge, { aaguid = "appattestdevelop", counter = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "attest-"));
  for (const name of ["root", "int", "leaf"]) openssl(dir, "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${name}.key`);
  writeFileSync(join(dir, "ca.cnf"), "[ca]\nbasicConstraints=critical,CA:true\n");
  openssl(dir, "req", "-x509", "-new", "-key", "root.key", "-subj", "/CN=Test Root", "-days", "2", "-out", "root.pem");
  openssl(dir, "req", "-new", "-key", "int.key", "-subj", "/CN=Test Intermediate", "-out", "int.csr");
  openssl(dir, "x509", "-req", "-in", "int.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-days", "2",
    "-extfile", "ca.cnf", "-extensions", "ca", "-out", "int.pem");

  const leafKey = createPublicKey(readFileSync(join(dir, "leaf.key")));
  const keyIdBytes = sha256(point(leafKey));
  const authData = Buffer.concat([
    appId, Buffer.from([0x41]), Buffer.from([0, 0, 0, counter]), Buffer.from(aaguid.padEnd(16, "\0")),
    Buffer.from([0, 32]), keyIdBytes, Buffer.from([0xa0]),
  ]);
  const nonce = sha256(authData, sha256(Buffer.from(challenge, "utf8")));
  writeFileSync(join(dir, "leaf.cnf"), `[leaf]\n1.2.840.113635.100.8.2=DER:3022A1200420${nonce.toString("hex")}\n`);
  openssl(dir, "req", "-new", "-key", "leaf.key", "-subj", "/CN=Test Leaf", "-out", "leaf.csr");
  openssl(dir, "x509", "-req", "-in", "leaf.csr", "-CA", "int.pem", "-CAkey", "int.key", "-CAcreateserial", "-days", "2",
    "-extfile", "leaf.cnf", "-extensions", "leaf", "-out", "leaf.pem");

  const der = (name) => Buffer.from(new X509Certificate(readFileSync(join(dir, name))).raw);
  const attestation = encodeCbor({
    fmt: "apple-appattest",
    attStmt: { x5c: [der("leaf.pem"), der("int.pem")], receipt: Buffer.from("receipt") },
    authData,
  }).toString("base64");
  return { attestation, keyId: keyIdBytes.toString("base64"), root: new X509Certificate(readFileSync(join(dir, "root.pem"))),
    leafDer: der("leaf.pem"), nonce };
}

test("reads the nonce from the certificate extension", async () => {
  const { leafDer, nonce } = makeAttestation("c");
  assert.deepEqual(nonceFromCertificate(leafDer), nonce);
});

test("a valid attestation stores the key; the challenge works only once", async () => {
  const challenge = await newChallenge();
  const { attestation, keyId, root } = makeAttestation(challenge);
  assert.deepEqual(await verifyAttestation({ keyId, attestation, challenge }, { root }), { environment: "development" });
  assert.ok(await store.get(`attest:key:${keyId}`));
  await assert.rejects(verifyAttestation({ keyId, attestation, challenge }, { root }), /Unknown or used challenge/);
});

test("refuses a chain that isn't Apple's, a wrong challenge, a used key and a wrong key id", async () => {
  let challenge = await newChallenge();
  let made = makeAttestation(challenge);
  await assert.rejects(verifyAttestation({ keyId: made.keyId, attestation: made.attestation, challenge }),
    /doesn't lead to Apple/, "Real Apple root");

  challenge = await newChallenge();
  made = makeAttestation("another challenge");
  await assert.rejects(verifyAttestation({ keyId: made.keyId, attestation: made.attestation, challenge }, { root: made.root }),
    /Nonce mismatch/);

  challenge = await newChallenge();
  made = makeAttestation(challenge, { counter: 1 });
  await assert.rejects(verifyAttestation({ keyId: made.keyId, attestation: made.attestation, challenge }, { root: made.root }),
    /Counter/);

  challenge = await newChallenge();
  made = makeAttestation(challenge, { aaguid: "somethingelse" });
  await assert.rejects(verifyAttestation({ keyId: made.keyId, attestation: made.attestation, challenge }, { root: made.root }),
    /environment/);

  challenge = await newChallenge();
  made = makeAttestation(challenge);
  await assert.rejects(verifyAttestation({ keyId: Buffer.alloc(32).toString("base64"), attestation: made.attestation, challenge },
    { root: made.root }), /Key id mismatch/);
});
