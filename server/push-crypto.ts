/**
 * Web Push crypto: RFC 8291 (aes128gcm) payload encryption + VAPID JWT (ES256).
 */
import type { Env } from "./env";
import { b64url, b64urlBytes } from "./util";

export async function encryptPayload(
	plaintext: Uint8Array,
	uaPublicB64Url: string,
	authSecretB64Url: string,
): Promise<Uint8Array> {
	const uaPublicRaw = base64UrlToBytes(uaPublicB64Url);
	const authSecret = base64UrlToBytes(authSecretB64Url);

	const asKeyPair = (await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		["deriveBits"],
	)) as CryptoKeyPair;
	const asPublicRaw = new Uint8Array(
		(await crypto.subtle.exportKey("raw", asKeyPair.publicKey)) as ArrayBuffer,
	);

	const uaPublicKey = await crypto.subtle.importKey(
		"raw",
		uaPublicRaw,
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[],
	);
	// `public` is a reserved word in Cloudflare's workers-types, surfaced as `$public`.
	// The runtime accepts the standard `public` field per the WebCrypto spec.
	const ecdhSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: uaPublicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
			asKeyPair.privateKey,
			256,
		),
	);

	// RFC 8291 §3.4: PRK_key = HMAC(auth_secret, ecdh_secret); IKM = HKDF-Expand(PRK_key, key_info, 32)
	const prkKey = await hmacSha256(authSecret, ecdhSecret);
	const keyInfo = concatBytes(
		new TextEncoder().encode("WebPush: info\0"),
		uaPublicRaw,
		asPublicRaw,
	);
	const ikm = await hkdfExpand(prkKey, keyInfo, 32);

	const salt = crypto.getRandomValues(new Uint8Array(16));
	const prk = await hmacSha256(salt, ikm);
	const cek = await hkdfExpand(
		prk,
		new TextEncoder().encode("Content-Encoding: aes128gcm\0"),
		16,
	);
	const nonce = await hkdfExpand(
		prk,
		new TextEncoder().encode("Content-Encoding: nonce\0"),
		12,
	);

	// Single (last) record: append 0x02 delimiter, then AES-128-GCM encrypt.
	const padded = new Uint8Array(plaintext.length + 1);
	padded.set(plaintext, 0);
	padded[plaintext.length] = 0x02;

	const cekKey = await crypto.subtle.importKey(
		"raw",
		cek,
		{ name: "AES-GCM" },
		false,
		["encrypt"],
	);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded),
	);

	// Record header: salt(16) || rs(4 BE) || idlen(1) || keyid(asPublicRaw, 65 bytes)
	const header = new Uint8Array(16 + 4 + 1 + 65);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, 4096, false);
	header[20] = 65;
	header.set(asPublicRaw, 21);

	return concatBytes(header, ciphertext);
}

export async function buildVapidJwt(env: Env, endpoint: string, publicKeyB64Url: string): Promise<string> {
	const privateKeyB64Url = (env.PUSH_VAPID_PRIVATE_KEY ?? "").trim();
	const privateKey = await importEcPrivateKey(privateKeyB64Url, publicKeyB64Url);
	const header = { typ: "JWT", alg: "ES256" };
	const now = Math.floor(Date.now() / 1000);
	const claim = {
		aud: new URL(endpoint).origin,
		exp: now + 60 * 60,
		sub: env.PUSH_SUBJECT || "mailto:no-reply@example.com",
	};
	const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
	const sigRaw = new Uint8Array(
		await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			privateKey,
			new TextEncoder().encode(unsigned),
		),
	);
	return `${unsigned}.${b64urlBytes(derToJose(sigRaw, 32))}`;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

// Single-block HKDF-Expand. Outputs <= 32 bytes only (sufficient for CEK/nonce/IKM).
async function hkdfExpand(
	prk: Uint8Array,
	info: Uint8Array,
	length: number,
): Promise<Uint8Array> {
	const data = new Uint8Array(info.length + 1);
	data.set(info, 0);
	data[info.length] = 0x01;
	const t = await hmacSha256(prk, data);
	return t.slice(0, length);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const a of arrays) total += a.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const a of arrays) {
		out.set(a, off);
		off += a.length;
	}
	return out;
}

async function importEcPrivateKey(
	privateKeyB64Url: string,
	publicKeyB64Url: string,
): Promise<CryptoKey> {
	const { x, y } = splitVapidPublicKey(publicKeyB64Url);
	const jwk = {
		kty: "EC",
		crv: "P-256",
		d: privateKeyB64Url,
		x,
		y,
		ext: true,
		key_ops: ["sign"],
	};
	return crypto.subtle.importKey(
		"jwk",
		jwk,
		{
			name: "ECDSA",
			namedCurve: "P-256",
		},
		false,
		["sign"],
	);
}

function splitVapidPublicKey(publicKeyB64Url: string): { x: string; y: string } {
	const raw = base64UrlToBytes(publicKeyB64Url);
	// Uncompressed P-256 point: 0x04 || X(32) || Y(32)
	if (raw.length !== 65 || raw[0] !== 0x04) {
		throw new Error("Invalid VAPID public key format");
	}
	const x = b64urlBytes(raw.slice(1, 33));
	const y = b64urlBytes(raw.slice(33, 65));
	return { x, y };
}

function derToJose(der: Uint8Array, size: number): Uint8Array {
	// Some runtimes already return JOSE-compatible raw signatures (r||s).
	if (der.length === size * 2) return der;
	// ECDSA signature from SubtleCrypto is ASN.1 DER sequence. Web Push JWT needs
	// raw JOSE format (r||s).
	if (der.length < 8 || der[0] !== 0x30) {
		throw new Error("Unexpected DER signature");
	}
	let offset = 2;
	if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
	if (der[offset] !== 0x02) throw new Error("Invalid DER signature (r)");
	const rLen = der[offset + 1];
	const rStart = offset + 2;
	const r = der.slice(rStart, rStart + rLen);
	const sOffset = rStart + rLen;
	if (der[sOffset] !== 0x02) throw new Error("Invalid DER signature (s)");
	const sLen = der[sOffset + 1];
	const sStart = sOffset + 2;
	const s = der.slice(sStart, sStart + sLen);
	const out = new Uint8Array(size * 2);
	out.set(trimAndPad(r, size), 0);
	out.set(trimAndPad(s, size), size);
	return out;
}

function trimAndPad(input: Uint8Array, size: number): Uint8Array {
	let data = input;
	while (data.length > 0 && data[0] === 0x00) data = data.slice(1);
	if (data.length > size) return data.slice(data.length - size);
	if (data.length === size) return data;
	const out = new Uint8Array(size);
	out.set(data, size - data.length);
	return out;
}

function base64UrlToBytes(value: string): Uint8Array {
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
	return Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0);
}
