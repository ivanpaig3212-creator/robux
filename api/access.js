const crypto = require("crypto");

const REDIS_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_URL;

const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_READ_ONLY_TOKEN;

const SITE_SESSION_SECRET =
  process.env.SITE_SESSION_SECRET;

const DEFAULT_DURATION_MS =
  30 * 24 * 60 * 60 * 1000;


/*
 * Base64 URL encode
 */

function base64UrlEncode(value) {

  return Buffer
    .from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

}


/*
 * Sign session payload
 *
 * This must match middleware.js.
 */

function sign(payload) {

  return crypto
    .createHash("sha256")
    .update(
      SITE_SESSION_SECRET +
      "|" +
      payload
    )
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

}


/*
 * Redis REST
 */

async function redisCommand(
  command
) {

  if (
    !REDIS_URL ||
    !REDIS_TOKEN
  ) {

    throw new Error(
      "Redis environment variables are missing."
    );

  }


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
          JSON.stringify(command)
      }
    );


  if (!response.ok) {

    throw new Error(
      `Redis error: ${response.status}`
    );

  }


  return response.json();

}


/*
 * Main handler
 */

module.exports = async (
  req,
  res
) => {

  if (
    req.method !== "POST"
  ) {

    return res.status(405).json({
      success: false,
      message:
        "Method not allowed"
    });

  }


  try {

    if (
      !SITE_SESSION_SECRET
    ) {

      return res.status(500).json({
        success: false,
        message:
          "SITE_SESSION_SECRET is not configured."
      });

    }


    const body =
      typeof req.body === "string"
        ? JSON.parse(
            req.body || "{}"
          )
        : req.body || {};


    const key =
      String(
        body.key || ""
      )
      .trim()
      .toUpperCase();


    if (!key) {

      return res.status(400).json({
        success: false,
        message:
          "Please enter an access key."
      });

    }


    const redisKey =
      `access:key:${key}`;


    /*
     * Atomically redeem the key.
     */

    const lua = `

local value =
    redis.call(
        "GET",
        KEYS[1]
    )


if not value then

    return {
        "NOT_FOUND"
    }

end


local record =
    cjson.decode(value)


if record.status ~= "unused" then

    return {
        "NOT_UNUSED"
    }

end


local durationMs =
    tonumber(
        record.durationMs
    )


if not durationMs or durationMs <= 0 then

    durationMs =
        ${DEFAULT_DURATION_MS}

end


local nowMs =
    tonumber(
        ARGV[1]
    )


local expiresAt =
    nowMs + durationMs


record.status =
    "used"


record.usedAt =
    ARGV[2]


record.expiresAt =
    expiresAt


redis.call(
    "SET",
    KEYS[1],
    cjson.encode(record)
)


return {
    "OK",
    tostring(expiresAt)
}

`;


    const nowMs =
      Date.now();


    const usedAt =
      new Date(
        nowMs
      ).toISOString();


    const result =
      await redisCommand([
        "EVAL",

        lua,

        "1",

        redisKey,

        String(nowMs),

        usedAt
      ]);


    const reply =
      result.result;


    if (
      !Array.isArray(reply)
    ) {

      return res.status(500).json({
        success: false,
        message:
          "Unexpected Redis response."
      });

    }


    if (
      reply[0] ===
      "NOT_FOUND"
    ) {

      return res.status(404).json({
        success: false,
        message:
          "Invalid access key."
      });

    }


    if (
      reply[0] ===
      "NOT_UNUSED"
    ) {

      return res.status(409).json({
        success: false,
        message:
          "This access key has already been used or revoked."
      });

    }


    if (
      reply[0] !==
      "OK"
    ) {

      return res.status(500).json({
        success: false,
        message:
          "Unable to redeem access key."
      });

    }


    const expiresAt =
      Number(
        reply[1]
      );


    if (
      !Number.isFinite(
        expiresAt
      ) ||
      expiresAt <= nowMs
    ) {

      return res.status(500).json({
        success: false,
        message:
          "Invalid access duration."
      });

    }


    /*
     * IMPORTANT
     *
     * The session payload now contains:
     *
     * expiration timestamp
     * +
     * access key
     *
     * Example:
     *
     * 1780000000000.RBX-ABC123-...
     *
     * This lets middleware identify
     * which key owns the session.
     */

    const payload =
      `${expiresAt}.${key}`;


    const encodedPayload =
      base64UrlEncode(
        payload
      );


    const signature =
      sign(
        payload
      );


    const session =
      `${encodedPayload}.${signature}`;


    const maxAge =
      Math.max(
        1,
        Math.floor(
          (
            expiresAt -
            Date.now()
          ) / 1000
        )
      );


    res.setHeader(
      "Set-Cookie",

      `site_access=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
    );


    return res.status(200).json({

      success: true,

      message:
        "Access granted.",

      expiresAt

    });


  } catch (error) {

    console.error(
      "Access error:",
      error
    );


    return res.status(500).json({

      success: false,

      message:
        "Server error while redeeming access key."

    });

  }

};
