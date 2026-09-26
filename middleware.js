import { NextResponse } from "next/server";

const SITE_SESSION_COOKIE = "site_access";
const ADMIN_SESSION_COOKIE = "robux_admin_session";

const SESSION_SECRET =
  process.env.SITE_SESSION_SECRET;

const REDIS_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_URL;

const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_READ_ONLY_TOKEN;


/*
 * Base64 URL decode
 */

function base64UrlDecode(value) {

  try {

    const padded =
      value +
      "=".repeat(
        (4 - (value.length % 4)) % 4
      );

    const base64 =
      padded
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    return atob(base64);

  } catch {

    return null;

  }

}


/*
 * Convert bytes to Base64 URL
 */

function base64UrlEncodeBytes(bytes) {

  let binary = "";

  for (
    const byte of bytes
  ) {

    binary +=
      String.fromCharCode(byte);

  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

}


/*
 * Create the same SHA-256
 * signature used by api/access.js
 */

async function createSignature(
  payload
) {

  const data =
    new TextEncoder().encode(
      `${SESSION_SECRET}|${payload}`
    );


  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );


  return base64UrlEncodeBytes(
    new Uint8Array(hash)
  );

}


/*
 * Constant-time string comparison
 */

function safeEqual(
  a,
  b
) {

  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {

    return false;

  }


  if (
    a.length !== b.length
  ) {

    return false;

  }


  let result = 0;


  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);

  }


  return result === 0;

}


/*
 * Check Redis
 */

async function getRedisRecord(
  key
) {

  if (
    !REDIS_URL ||
    !REDIS_TOKEN
  ) {

    return null;

  }


  try {

    const response =
      await fetch(
        REDIS_URL,
        {

          method: "POST",

          headers: {

            Authorization:
              `Bearer ${REDIS_TOKEN}`,

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify([
              "GET",
              `access:key:${key}`
            ])

        }
      );


    if (
      !response.ok
    ) {

      return null;

    }


    const data =
      await response.json();


    if (
      !data.result
    ) {

      return null;

    }


    return JSON.parse(
      data.result
    );

  } catch {

    return null;

  }

}


/*
 * Validate the user's site session
 */

async function validSiteSession(
  request
) {

  if (
    !SESSION_SECRET
  ) {

    return false;

  }


  const cookie =
    request.cookies.get(
      SITE_SESSION_COOKIE
    )?.value;


  if (!cookie) {

    return false;

  }


  let token;

  try {

    token =
      decodeURIComponent(
        cookie
      );

  } catch {

    return false;

  }


  const parts =
    token.split(".");


  /*
   * New session format:
   *
   * base64(expiresAt.key).signature
   */

  if (
    parts.length !== 2
  ) {

    return false;

  }


  const encodedPayload =
    parts[0];

  const suppliedSignature =
    parts[1];


  const payload =
    base64UrlDecode(
      encodedPayload
    );


  if (!payload) {

    return false;

  }


  /*
   * Verify signature
   */

  const expectedSignature =
    await createSignature(
      payload
    );


  if (
    !safeEqual(
      suppliedSignature,
      expectedSignature
    )
  ) {

    return false;

  }


  /*
   * Payload:
   *
   * expiresAt.ACCESSKEY
   */

  const separator =
    payload.indexOf(".");


  if (
    separator === -1
  ) {

    return false;

  }


  const expiresAt =
    Number(
      payload.slice(
        0,
        separator
      )
    );


  const accessKey =
    payload.slice(
      separator + 1
    );


  if (
    !Number.isFinite(
      expiresAt
    )
  ) {

    return false;

  }


  if (!accessKey) {

    return false;

  }


  /*
   * Check expiration
   */

  if (
    Date.now() >= expiresAt
  ) {

    return false;

  }


  /*
   * IMPORTANT:
   *
   * Check the actual Redis record.
   *
   * If the admin revoked the key,
   * this immediately invalidates
   * the person's current session.
   */

  const record =
    await getRedisRecord(
      accessKey
    );


  if (!record) {

    return false;

  }


  /*
   * Revoked = kicked out
   */

  if (
    record.status ===
    "revoked"
  ) {

    return false;

  }


  /*
   * If Redis says the key itself
   * has expired, also block it.
   */

  if (
    record.expiresAt &&
    Date.now() >=
      Number(record.expiresAt)
  ) {

    return false;

  }


  /*
   * The key must still be marked
   * as used.
   */

  if (
    record.status !==
    "used"
  ) {

    return false;

  }


  return true;

}


/*
 * Middleware
 */

export default async function middleware(
  request
) {

  const pathname =
    request.nextUrl.pathname;


  /*
   * Public pages/routes
   */

  if (
    pathname === "/unlock.html" ||
    pathname === "/api/access" ||
    pathname === "/favicon.ico"
  ) {

    return NextResponse.next();

  }


  /*
   * Admin panel is handled separately
   * by api/keys.js.
   */

  if (
    pathname === "/admin.html" ||
    pathname.startsWith("/api/keys")
  ) {

    return NextResponse.next();

  }


  /*
   * Roblox API requires valid access.
   */

  if (
    pathname.startsWith(
      "/api/roblox"
    )
  ) {

    const valid =
      await validSiteSession(
        request
      );


    if (!valid) {

      return NextResponse.json(
        {
          success: false,
          error:
            "Access expired or revoked."
        },
        {
          status: 401
        }
      );

    }


    return NextResponse.next();

  }


  /*
   * Normal website pages
   */

  const valid =
    await validSiteSession(
      request
    );


  if (!valid) {

    const url =
      request.nextUrl.clone();

    url.pathname =
      "/unlock.html";

    url.search = "";


    return NextResponse.redirect(
      url
    );

  }


  return NextResponse.next();

}


/*
 * Routes handled by middleware
 */

export const config = {

  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)"

  ]

};
